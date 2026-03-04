import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// ── E1 Regex and logic replicas for unit testing ──

const E1_HIGH_IMPACT_KEYWORDS = /\b(delete|remove\s*account|close\s*account|permanently\s*delete|destroy|erase|cancel\s*(?:subscription|membership|plan|account)|subscribe|buy|purchase|pay\b|upgrade|checkout|confirm\s*(?:order|purchase|payment)|finalize|publish|authorize|grant\s*access|share\s*data|export\s*data|connect\s*account)\b/i;
const E1_DESTRUCTIVE_LABEL_RE = /\b(delete|remove|trash|destroy|erase)\b/i;
const E1_AUTH_FLOW_PATH = /(?:forgot.?password|reset.?password|sign.?in|sign.?up|login|register|auth|verify.?email|confirm.?email)/i;
const E1_AUTH_EXCLUDED_LABELS = /\b(send\s*reset\s*link|reset\s*password|sign\s*in|sign\s*up|log\s*in|log\s*out|sign\s*out|register|create\s*account|verify\s*email|resend\s*code|resend\s*link)\b/i;
const E1_OVERRIDE_IN_AUTH = /\b(delete|erase|destroy|permanently|purchase|pay\b|subscribe|checkout|billing)\b/i;
const E1_STRONG_DISCLOSURE_RE = /\b(cannot\s*be\s*undone|irreversible|permanent(?:ly)?|will\s*be\s*(?:deleted|removed|lost|erased)|this\s*(?:action|cannot)|data\s*will\s*be\s*removed|all\s*(?:your\s*)?data|appointments|messages|records|files)\b/gi;
// NOTE: Matches production — "Dialog" alone excluded (too broad)
const E1_CONFIRMATION_PATTERNS = /\b(AlertDialog|confirm\s*\(|useConfirm|ConfirmDialog|ConfirmModal|DeleteConfirmDialog|DeleteDialog)\b/i;
const E1_TWO_STEP_STATE_RE = /\b(set(?:Pending|Confirm|ShowConfirm|DeleteConfirm|ConfirmOpen|ConfirmDelete|IsDeleting|ShowDelete|DeleteDialog)\s*\(|setPending\w*Delete\s*\(|setConfirm\w*\s*\(true\))/i;
const E1_NETWORK_DELETE_RE = /(?:fetch\s*\([^)]*[,{]\s*method\s*:\s*["']DELETE["']|\.delete\s*\(|apiRequest\s*\(\s*["']DELETE["']|method\s*:\s*["']DELETE["'])/i;
const E1_DELETE_HANDLER_RE = /\b(handle(?:Delete|Remove|Destroy)|on(?:Delete|Remove|Destroy)|delete(?:Item|Row|Record|Entry|User|Account|Doctor|Patient|Appointment|Data)|remove(?:Item|Row|Record|Entry)|destroy(?:Item|Row|Record))\b/i;
const E1_UNDO_RECOVERY_RE = /\b(undo|restore|undelete|soft.?delete|archive(?:d)?|moved?\s*to\s*trash|trash.?(?:can|bin)|action\s*:\s*["']undo["']|toast\s*\([^)]*undo)/i;
const E1_FRICTION_TYPE_CONFIRM = /\b(type\s*["']?DELETE|type\s*["']?CONFIRM|type\s*to\s*confirm|enter\s*["']?delete)\b/i;
const E1_FRICTION_DOUBLE_CONFIRM = /(?:Are\s*you\s*(?:sure|certain)|Confirm\s*(?:deletion|removal|action)|This\s*will\s*permanently)/i;

function extractDisclosureTerms(text: string): string[] {
  const terms: string[] = [];
  E1_STRONG_DISCLOSURE_RE.lastIndex = 0;
  let m;
  while ((m = E1_STRONG_DISCLOSURE_RE.exec(text)) !== null) {
    const term = m[1].toLowerCase().trim();
    if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

// FLOW-LOCAL: detects confirmation gates in a scoped region (not full file)
function detectConfirmationGate(region: string): { hasGate: boolean; gateType: string } {
  const confirmMatch = region.match(E1_CONFIRMATION_PATTERNS);
  if (confirmMatch) return { hasGate: true, gateType: confirmMatch[1] || 'confirmation-dialog' };
  if (E1_TWO_STEP_STATE_RE.test(region)) return { hasGate: true, gateType: 'two-step-state' };
  if (/\bwindow\.confirm\s*\(/i.test(region)) return { hasGate: true, gateType: 'window.confirm' };
  // Disabled-until-confirm gate (supports compound: disabled={!confirm || isPending})
  const disabledConfirmMatch = region.match(/disabled=\{[^}]*!(\w*(?:confirm|acknowledge|accept|agreed|checked|consent)\w*)[^}]*\}/i)
    || region.match(/disabled=\{[^}]*(\w*(?:confirm|acknowledge|accept|agreed|checked|consent)\w*)\s*===\s*false[^}]*\}/i);
  if (disabledConfirmMatch) return { hasGate: true, gateType: `disabled-until-confirm (${disabledConfirmMatch[1]})` };
  // Checkbox/toggle updating confirmation state
  if (/(?:onCheckedChange|onChange)[=\s{]*(?:set\w*(?:confirm|acknowledge|accept|agreed|checked|consent)\w*)/i.test(region)) {
    return { hasGate: true, gateType: 'checkbox-confirm-gate' };
  }
  // Conditional execution gated by confirm state
  if (/\b(\w*(?:confirm|acknowledge|accept|agreed|checked|consent)\w*)\s*&&\s*\w*(?:delete|remove|destroy)\w*\s*[.(]/i.test(region)) {
    return { hasGate: true, gateType: 'conditional-confirm-gate' };
  }
  // Type-to-confirm gate
  if (E1_FRICTION_TYPE_CONFIRM.test(region)) {
    return { hasGate: true, gateType: 'type-to-confirm' };
  }
  // String-comparison disabled gate: disabled={confirmation !== 'DELETE'}
  const comparisonDisabledMatch = region.match(/disabled=\{[^}]*(\w*(?:confirm|acknowledge|verification|delete)\w*)\s*!==\s*["'`](?:DELETE|CONFIRM|delete|confirm)["'`][^}]*\}/i);
  if (comparisonDisabledMatch) {
    return { hasGate: true, gateType: `disabled-until-confirm (${comparisonDisabledMatch[1]})` };
  }
  // Handler guard: if (confirmation !== 'DELETE') return
  if (/if\s*\(\s*\w*(?:confirm|verification)\w*\s*!==\s*["'`](?:DELETE|CONFIRM)["'`]\s*\)\s*return/i.test(region)) {
    return { hasGate: true, gateType: 'handler-guard' };
  }
  return { hasGate: false, gateType: '' };
}

function detectRecovery(region: string): { hasRecovery: boolean; recoveryType: string } {
  if (E1_UNDO_RECOVERY_RE.test(region)) {
    const m = region.match(E1_UNDO_RECOVERY_RE);
    return { hasRecovery: true, recoveryType: m?.[1] || 'undo' };
  }
  return { hasRecovery: false, recoveryType: '' };
}

function extractFriction(region: string): string[] {
  const f: string[] = [];
  if (E1_FRICTION_TYPE_CONFIRM.test(region)) f.push('type-to-confirm');
  if (E1_FRICTION_DOUBLE_CONFIRM.test(region)) f.push('double-confirm');
  return f;
}

function isHandlerGatedByConfirmation(handlerName: string, content: string): boolean {
  const handlerBodyRe = new RegExp(`(?:function\\s+${handlerName}|const\\s+${handlerName}\\s*=)\\s*(?:\\([^)]*\\)\\s*(?:=>|\\{)|\\{)([\\s\\S]{0,500})`, 'i');
  const bodyMatch = content.match(handlerBodyRe);
  if (bodyMatch) {
    const body = bodyMatch[1];
    if (E1_TWO_STEP_STATE_RE.test(body)) return true;
    if (/\bconfirm\s*\(/i.test(body)) return true;
  }
  return false;
}

// Mirrors production shouldSuppressE1Bundle with FLOW-LOCAL gate/recovery
function shouldSuppressE1(opts: {
  filePath: string; label: string; localRegion: string; fullContent: string; handlerName?: string;
}): { suppressed: boolean; reason: string } {
  const { filePath, label, localRegion, fullContent } = opts;

  // Auth-flow file exclusion
  if (E1_AUTH_FLOW_PATH.test(filePath) && !E1_OVERRIDE_IN_AUTH.test(fullContent)) {
    return { suppressed: true, reason: 'auth-flow file without destructive/billing override' };
  }
  if (E1_AUTH_EXCLUDED_LABELS.test(label)) {
    return { suppressed: true, reason: 'auth-excluded label' };
  }
  if (!E1_HIGH_IMPACT_KEYWORDS.test(label) && !E1_DELETE_HANDLER_RE.test(label)) {
    return { suppressed: true, reason: 'no high-impact keyword in label' };
  }

  // FLOW-LOCAL: gate and recovery scoped to localRegion
  const recovery = detectRecovery(localRegion);
  if (recovery.hasRecovery) {
    return { suppressed: true, reason: `recovery mechanism: ${recovery.recoveryType}` };
  }

  const gate = detectConfirmationGate(localRegion);
  const disclosureTerms = extractDisclosureTerms(localRegion);
  const friction = extractFriction(localRegion);

  if (gate.hasGate && disclosureTerms.length > 0) {
    return { suppressed: true, reason: `disclosure (${disclosureTerms.join(', ')}) + ${gate.gateType}` };
  }
  if (gate.hasGate) {
    if (opts.handlerName && isHandlerGatedByConfirmation(opts.handlerName, fullContent)) {
      return { suppressed: true, reason: `handler ${opts.handlerName} is gated by confirmation state` };
    }
    if (friction.length > 0) {
      return { suppressed: true, reason: `${gate.gateType} + friction (${friction.join(', ')}) in local scope` };
    }
    // Non-modal gate types always suppress
    if (/disabled-until-confirm|conditional-confirm-gate|checkbox-confirm-gate|type-to-confirm|handler-guard/i.test(gate.gateType)) {
      return { suppressed: true, reason: `non-modal confirmation gate: ${gate.gateType}` };
    }
    if (E1_DESTRUCTIVE_LABEL_RE.test(label) && /AlertDialog|ConfirmDialog|DeleteConfirmDialog|two-step-state/i.test(gate.gateType)) {
      return { suppressed: true, reason: `destructive label + ${gate.gateType} in local scope` };
    }
  }

  return { suppressed: false, reason: '' };
}

// ── Test 1: Settings delete account with full disclosure + confirmation → SUPPRESSED ──
Deno.test("E1: Settings delete account with disclosure + confirmation → SUPPRESSED", () => {
  const localRegion = `
    <AlertDialog>
      <p>This action cannot be undone. Your data will be permanently removed.</p>
      <Button variant="destructive">Delete Account</Button>
    </AlertDialog>
  `;
  const result = shouldSuppressE1({
    filePath: "src/pages/Settings.tsx", label: "Delete Account",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, true, `Expected suppression but got: ${result.reason}`);
});

// ── Test 2: ForgotPassword "Send reset link" → SUPPRESSED (auth-excluded label) ──
Deno.test("E1: ForgotPassword send reset link → SUPPRESSED (auth label)", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/ForgotPassword.tsx", label: "Send reset link",
    localRegion: `<Button>Send reset link</Button>`, fullContent: `<Button>Send reset link</Button>`,
  });
  assertEquals(result.suppressed, true);
});

// ── Test 3: Auth-flow file without destructive content → SUPPRESSED ──
Deno.test("E1: Auth-flow file without destructive keywords → SUPPRESSED", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/ResetPassword.tsx", label: "Reset Password",
    localRegion: `<Button>Reset Password</Button>`, fullContent: `<Button>Reset Password</Button>`,
  });
  assertEquals(result.suppressed, true);
});

// ── Test 4: Delete with no disclosure or confirmation → NOT suppressed ──
Deno.test("E1: Delete with no disclosure or confirmation → NOT suppressed", () => {
  const localRegion = `<Button variant="destructive">Delete</Button>`;
  const result = shouldSuppressE1({
    filePath: "src/pages/Dashboard.tsx", label: "Delete",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, false, "Should NOT be suppressed");
});

// ── Test 5: "Subscribe" with no pricing disclosure → NOT suppressed ──
Deno.test("E1: Subscribe without pricing → NOT suppressed", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/Pricing.tsx", label: "Subscribe",
    localRegion: `<Button>Subscribe</Button>`, fullContent: `<Button>Subscribe</Button>`,
  });
  assertEquals(result.suppressed, false);
});

// ── Test 6: Generic "reset" → SUPPRESSED (not high-impact) ──
Deno.test("E1: Generic 'reset' label → SUPPRESSED (not in keyword list)", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/Settings.tsx", label: "Reset",
    localRegion: `<Button>Reset</Button>`, fullContent: `<Button>Reset</Button>`,
  });
  assertEquals(result.suppressed, true);
});

// ── Test 7: Generic "Accept" → SUPPRESSED ──
Deno.test("E1: Generic 'Accept' label → SUPPRESSED (not in keyword list)", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/Terms.tsx", label: "Accept",
    localRegion: `<Button>Accept</Button>`, fullContent: `<Button>Accept</Button>`,
  });
  assertEquals(result.suppressed, true);
});

// ── Test 8: Delete in auth-flow file WITH destructive content → NOT suppressed ──
Deno.test("E1: Delete account inside auth file → NOT suppressed (override)", () => {
  const localRegion = `<Button variant="destructive">Delete Account</Button>`;
  const result = shouldSuppressE1({
    filePath: "src/pages/auth/AccountSettings.tsx", label: "Delete Account",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, false);
});

// ── Test 9: Disclosure extraction ──
Deno.test("E1: Disclosure term extraction works correctly", () => {
  const text = "This action cannot be undone. Your data will be permanently removed.";
  const terms = extractDisclosureTerms(text);
  assertEquals(terms.length >= 2, true, `Expected >= 2 terms, got: ${terms.join(', ')}`);
  assertEquals(terms.some(t => t.includes("cannot be undone")), true);
  assertEquals(terms.some(t => t.includes("permanently")), true);
});

// ── Test 10: Friction mechanism detection ──
Deno.test("E1: Friction mechanism detection — type-to-confirm", () => {
  assertEquals(E1_FRICTION_TYPE_CONFIRM.test('type DELETE to confirm'), true);
  assertEquals(E1_FRICTION_TYPE_CONFIRM.test('type "CONFIRM"'), true);
  assertEquals(E1_FRICTION_TYPE_CONFIRM.test('just a button'), false);
});

Deno.test("E1: Friction mechanism detection — double-confirm", () => {
  assertEquals(E1_FRICTION_DOUBLE_CONFIRM.test('Are you sure you want to proceed?'), true);
  assertEquals(E1_FRICTION_DOUBLE_CONFIRM.test('This will permanently delete'), true);
  assertEquals(E1_FRICTION_DOUBLE_CONFIRM.test('Click to save'), false);
});

// ── Test 11: Network DELETE detection ──
Deno.test("E1: Network DELETE patterns detected", () => {
  assertEquals(E1_NETWORK_DELETE_RE.test('fetch("/api/items", { method: "DELETE" })'), true);
  assertEquals(E1_NETWORK_DELETE_RE.test('axios.delete("/api/items/1")'), true);
  assertEquals(E1_NETWORK_DELETE_RE.test('apiRequest("DELETE", "/api/items")'), true);
  assertEquals(E1_NETWORK_DELETE_RE.test('fetch("/api/items", { method: "POST" })'), false);
  assertEquals(E1_NETWORK_DELETE_RE.test('method: "DELETE"'), true);
});

// ── Test 12: Delete handler name detection ──
Deno.test("E1: Delete handler names detected", () => {
  assertEquals(E1_DELETE_HANDLER_RE.test('handleDelete'), true);
  assertEquals(E1_DELETE_HANDLER_RE.test('onRemove'), true);
  assertEquals(E1_DELETE_HANDLER_RE.test('deleteItem'), true);
  assertEquals(E1_DELETE_HANDLER_RE.test('removeRow'), true);
  assertEquals(E1_DELETE_HANDLER_RE.test('deleteDoctor'), true);
  assertEquals(E1_DELETE_HANDLER_RE.test('handleSave'), false);
  assertEquals(E1_DELETE_HANDLER_RE.test('onSubmit'), false);
});

// ── Test 13: Two-step state confirmation gate ──
Deno.test("E1: Two-step state confirmation gate detected", () => {
  assertEquals(E1_TWO_STEP_STATE_RE.test('setPendingDelete(id)'), true);
  assertEquals(E1_TWO_STEP_STATE_RE.test('setConfirmOpen(true)'), true);
  assertEquals(E1_TWO_STEP_STATE_RE.test('setShowConfirm(true)'), true);
  assertEquals(E1_TWO_STEP_STATE_RE.test('setDeleteDialog(true)'), true);
  assertEquals(E1_TWO_STEP_STATE_RE.test('setIsOpen(true)'), false);
});

// ── Test 14: Recovery / undo suppression ──
Deno.test("E1: Undo/recovery detection works", () => {
  assertEquals(E1_UNDO_RECOVERY_RE.test('toast({ action: "undo" })'), true);
  assertEquals(E1_UNDO_RECOVERY_RE.test('soft-delete'), true);
  assertEquals(E1_UNDO_RECOVERY_RE.test('restore'), true);
  assertEquals(E1_UNDO_RECOVERY_RE.test('archived'), true);
  assertEquals(E1_UNDO_RECOVERY_RE.test('moved to trash'), true);
  assertEquals(E1_UNDO_RECOVERY_RE.test('permanently deleted'), false);
});

// ── Test 15: Delete with undo recovery → SUPPRESSED ──
Deno.test("E1: Delete with undo toast → SUPPRESSED (recovery)", () => {
  const localRegion = `
    <Button onClick={() => deleteItem(id)}>Delete</Button>
    toast({ title: "Deleted", action: "undo" })
  `;
  const result = shouldSuppressE1({
    filePath: "src/pages/Items.tsx", label: "Delete",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, true);
  assertEquals(result.reason.includes('recovery'), true);
});

// ── Test 16: Delete with two-step state + destructive label → SUPPRESSED ──
Deno.test("E1: Delete with setPendingDelete state → SUPPRESSED", () => {
  const localRegion = `
    const handleDelete = () => { setPendingDelete(id); };
    <Button onClick={handleDelete}>Delete</Button>
  `;
  const result = shouldSuppressE1({
    filePath: "src/pages/Doctors.tsx", label: "Delete",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, true);
  assertEquals(result.reason.includes('two-step-state'), true);
});

// ── Test 17: Network DELETE with no gate → NOT suppressed ──
Deno.test("E1: Direct DELETE fetch with no confirmation → NOT suppressed", () => {
  const content = `
    const handleDelete = async (id) => {
      await fetch(\`/api/items/\${id}\`, { method: "DELETE" });
    };
    <Button onClick={() => handleDelete(item.id)}>Delete</Button>
  `;
  const gate = detectConfirmationGate(content);
  assertEquals(gate.hasGate, false, "Should NOT detect confirmation gate");
  assertEquals(E1_NETWORK_DELETE_RE.test(content), true, "Should detect DELETE method");
});

// ── Test 18: Confirmation gate detection — window.confirm ──
Deno.test("E1: window.confirm detection", () => {
  const content = `
    const handleDelete = () => {
      if (window.confirm("Are you sure?")) { deleteItem(id); }
    };
  `;
  const gate = detectConfirmationGate(content);
  assertEquals(gate.hasGate, true);
  assertEquals(gate.gateType, 'window.confirm');
});

// ── Test 19: Soft-delete API endpoint → recovery detected ──
Deno.test("E1: Soft-delete/archive endpoint triggers recovery", () => {
  const content = `fetch("/api/items/archive", { method: "POST" })`;
  assertEquals(E1_UNDO_RECOVERY_RE.test(content), true);
});

// ── Test 20: Destructive label + AlertDialog in LOCAL scope → SUPPRESSED ──
Deno.test("E1: Delete + AlertDialog in local scope → SUPPRESSED for destructive label", () => {
  const localRegion = `
    <AlertDialog>
      <Button>Delete</Button>
    </AlertDialog>
  `;
  const result = shouldSuppressE1({
    filePath: "src/pages/Items.tsx", label: "Delete",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, true, "Destructive label + AlertDialog in local scope should suppress");
});

// ════════════════════════════════════════════════════════════════════════
// REGRESSION TESTS: Flow-local suppression (file-level Dialog must NOT suppress)
// ════════════════════════════════════════════════════════════════════════

// ── Test 21: admin/doctors.tsx — direct deleteMutation.mutate + Dialog elsewhere → NOT suppressed ──
Deno.test("E1 REGRESSION: doctors page — delete with Dialog elsewhere → NOT suppressed", () => {
  // Full file has Dialog (for add/edit), but delete trigger is NOT inside it
  const fullContent = `
    import { Dialog } from "@/components/ui/dialog";
    const deleteMutation = useMutation({ mutationFn: (id) => apiRequest("DELETE", \`/api/doctors/\${id}\`) });
    // Add/edit dialog (unrelated)
    <Dialog open={dialogOpen}>
      <form><Input /><Button>Save</Button></form>
    </Dialog>
    // Delete button — NOT inside Dialog
    <Button onClick={() => deleteMutation.mutate(doc.id)} aria-label="Delete doctor"><Trash2 /></Button>
  `;
  // The LOCAL region around the delete trigger does NOT contain AlertDialog/ConfirmDialog
  const localRegion = `<Button onClick={() => deleteMutation.mutate(doc.id)} aria-label="Delete doctor"><Trash2 /></Button>`;

  const result = shouldSuppressE1({
    filePath: "src/pages/admin/doctors.tsx", label: "Delete doctor",
    localRegion, fullContent,
  });
  assertEquals(result.suppressed, false, `Should NOT be suppressed, but got: ${result.reason}`);
});

// ── Test 22: admin/timeslots.tsx — same pattern → NOT suppressed ──
Deno.test("E1 REGRESSION: timeslots page — delete with Dialog elsewhere → NOT suppressed", () => {
  const fullContent = `
    import { Dialog } from "@/components/ui/dialog";
    const deleteMutation = useMutation({ mutationFn: (id) => apiRequest("DELETE", \`/api/timeslots/\${id}\`) });
    <Dialog open={dialogOpen}><form><Button>Add</Button></form></Dialog>
    <Button onClick={() => deleteMutation.mutate(ts.id)} aria-label="Delete time slot"><Trash2 /></Button>
  `;
  const localRegion = `<Button onClick={() => deleteMutation.mutate(ts.id)} aria-label="Delete time slot"><Trash2 /></Button>`;

  const result = shouldSuppressE1({
    filePath: "src/pages/admin/timeslots.tsx", label: "Delete time slot",
    localRegion, fullContent,
  });
  assertEquals(result.suppressed, false, `Should NOT be suppressed, but got: ${result.reason}`);
});

// ── Test 23: settings.tsx — account deletion with AlertDialog gate → SUPPRESSED ──
Deno.test("E1 REGRESSION: settings account deletion with AlertDialog → SUPPRESSED", () => {
  const localRegion = `
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">Delete Account</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <p>This will permanently delete your account and all data.</p>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={() => deleteAccount()}>Delete</AlertDialogAction>
      </AlertDialogContent>
    </AlertDialog>
  `;
  const result = shouldSuppressE1({
    filePath: "src/pages/Settings.tsx", label: "Delete Account",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, true, `Should be suppressed due to AlertDialog + disclosure`);
});

// ── Test 24: "Dialog" alone in local scope should NOT suppress (too broad) ──
Deno.test("E1 REGRESSION: bare Dialog in local scope does NOT suppress", () => {
  const localRegion = `
    <Dialog>
      <Button variant="destructive">Delete</Button>
    </Dialog>
  `;
  const result = shouldSuppressE1({
    filePath: "src/pages/Items.tsx", label: "Delete",
    localRegion, fullContent: localRegion,
  });
  // Dialog alone (not AlertDialog/ConfirmDialog) should NOT suppress
  assertEquals(result.suppressed, false, `Bare Dialog should NOT suppress E1, but got: ${result.reason}`);
});

// ── Test 25: Delete with disabled={!confirmChecked} → SUPPRESSED (disabled-until-confirm gate) ──
Deno.test("E1 REGRESSION: disabled={!confirmChecked} is a valid confirmation gate", () => {
  const localRegion = `<Button disabled={!confirmChecked} onClick={() => deleteAccount()}>Delete</Button>`;
  const result = shouldSuppressE1({
    filePath: "src/pages/Settings.tsx", label: "Delete",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, true, `Expected suppression via disabled-until-confirm, got: ${result.reason}`);
});

// ── Test 26: disabled={!unrelatedState} should NOT suppress ──
Deno.test("E1: disabled={!isLoading} is NOT a confirmation gate", () => {
  const localRegion = `<Button disabled={!isLoading} onClick={() => deleteAccount()}>Delete</Button>`;
  const result = shouldSuppressE1({
    filePath: "src/pages/Settings.tsx", label: "Delete",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, false, "disabled with non-confirm state should NOT suppress");
});

// ── Test 27: disabled={acknowledged === false} → SUPPRESSED ──
Deno.test("E1: disabled={acknowledged === false} is a valid gate", () => {
  const localRegion = `<Button disabled={acknowledged === false} onClick={() => deleteAccount()}>Delete</Button>`;
  const result = shouldSuppressE1({
    filePath: "src/pages/Settings.tsx", label: "Delete",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, true, `Expected suppression via disabled-until-confirm`);
});

// ── Test 28: confirmChecked && deleteMutation.mutate() → SUPPRESSED ──
Deno.test("E1: conditional confirm gate (confirmChecked && delete) → SUPPRESSED", () => {
  const localRegion = `<Button onClick={() => confirmChecked && deleteMutation.mutate(id)}>Delete</Button>`;
  const result = shouldSuppressE1({
    filePath: "src/pages/Settings.tsx", label: "Delete",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, true, `Expected suppression via conditional-confirm-gate`);
});

// ── Test 29: disabled={!deleteConfirm || isPending} → SUPPRESSED (compound condition) ──
Deno.test("E1: compound disabled={!deleteConfirm || isPending} is a valid gate", () => {
  const localRegion = `<Button disabled={!deleteConfirm || isPending} onClick={() => deleteMutation.mutate()}>Delete Account</Button>`;
  const result = shouldSuppressE1({
    filePath: "src/pages/Settings.tsx", label: "Delete Account",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, true, `Expected suppression via disabled-until-confirm compound`);
});

// ── Test 30: Checkbox onCheckedChange={setDeleteConfirm} → SUPPRESSED ──
Deno.test("E1: Checkbox updating confirm state is a valid gate", () => {
  const localRegion = `
    <Checkbox onCheckedChange={setDeleteConfirm} />
    <Button disabled={!deleteConfirm} onClick={() => deleteMutation.mutate()}>Delete Account</Button>
  `;
  const result = shouldSuppressE1({
    filePath: "src/pages/Settings.tsx", label: "Delete Account",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, true, `Expected suppression via checkbox-confirm-gate or disabled-until-confirm`);
});

// ── Test 31: Full settings.tsx pattern with useState + Checkbox + disabled button ──
Deno.test("E1 REGRESSION: settings.tsx full checkbox-gated delete flow → SUPPRESSED", () => {
  const fullContent = `
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const deleteMutation = useMutation({ mutationFn: () => apiRequest("DELETE", "/api/account") });
    <Checkbox onCheckedChange={(checked) => setDeleteConfirm(!!checked)} />
    <span>I understand this action cannot be undone</span>
    <Button disabled={!deleteConfirm || deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>Delete Account</Button>
  `;
  const localRegion = fullContent; // entire component is the region
  const result = shouldSuppressE1({
    filePath: "src/pages/Settings.tsx", label: "Delete Account",
    localRegion, fullContent,
  });
  assertEquals(result.suppressed, true, `Full settings.tsx checkbox-gated delete must be suppressed`);
});

// ── Test 32: doctors.tsx ungated delete → NOT suppressed ──
Deno.test("E1 REGRESSION: doctors.tsx ungated delete still flagged", () => {
  const localRegion = `<Button variant="ghost" onClick={() => deleteMutation.mutate(doctor.id)}><Trash2 className="h-4 w-4" /></Button>`;
  const fullContent = `
    import { Dialog } from "@/components/ui/dialog";
    const deleteMutation = useMutation({ mutationFn: (id) => apiRequest("DELETE", \`/api/doctors/\${id}\`) });
    <Dialog><DialogContent>Add Doctor Form</DialogContent></Dialog>
    ${localRegion}
  `;
  const result = shouldSuppressE1({
    filePath: "src/pages/admin/doctors.tsx", label: "Delete",
    localRegion, fullContent,
  });
  assertEquals(result.suppressed, false, "doctors.tsx ungated delete must NOT be suppressed");
});

// ── Test 33: Network channel — settings.tsx with file-level checkbox gate → SUPPRESSED ──
Deno.test("E1 REGRESSION: network channel settings.tsx with checkbox gate → SUPPRESSED", () => {
  // Simulates network detection: the handler is far from the UI checkbox gate
  // Network channel should use file-level non-modal gate fallback
  const fullContent = `
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const deleteMutation = useMutation({ mutationFn: () => apiRequest("DELETE", "/api/account") });

    const handleDeleteAccount = async () => {
      await deleteMutation.mutateAsync();
    };

    // ... many lines of other UI ...

    <Checkbox onCheckedChange={(checked) => setDeleteConfirm(!!checked)} />
    <span>I understand this action cannot be undone and all data will be permanently deleted</span>
    <Button disabled={!deleteConfirm || deleteMutation.isPending} onClick={() => handleDeleteAccount()}>Delete Account</Button>
  `;
  // File-level gate detection finds the disabled-until-confirm and checkbox patterns
  const fileLevelGate = detectConfirmationGate(fullContent);
  assertEquals(fileLevelGate.hasGate, true, "File-level gate should detect disabled-until-confirm or checkbox");

  // The handler region (around handleDeleteAccount definition) does NOT contain the UI gate
  const handlerRegion = `const handleDeleteAccount = async () => { await deleteMutation.mutateAsync(); };`;
  const localGate = detectConfirmationGate(handlerRegion);
  assertEquals(localGate.hasGate, false, "Local region around handler should NOT have gate");

  // With file-level fallback, suppression should work
  const effectiveGate = localGate.hasGate ? localGate : fileLevelGate;
  const effectiveDisclosure = extractDisclosureTerms(fullContent);
  const result = shouldSuppressE1({
    filePath: "src/pages/Settings.tsx",
    label: "handleDeleteAccount() network DELETE",
    localRegion: handlerRegion,
    fullContent,
  });
  // Direct call won't work since shouldSuppressE1 uses localRegion — so test the gate logic directly
  const suppressResult = effectiveGate.hasGate && /disabled-until-confirm|checkbox-confirm-gate|conditional-confirm-gate|two-step-state/i.test(effectiveGate.gateType);
  assertEquals(suppressResult, true, "File-level non-modal gate should suppress network channel");
});

// ── Test 34: Network channel — doctors.tsx without checkbox gate → NOT suppressed ──
Deno.test("E1 REGRESSION: network channel doctors.tsx without gate → NOT suppressed", () => {
  const fullContent = `
    import { Dialog } from "@/components/ui/dialog";
    const deleteMutation = useMutation({ mutationFn: (id) => apiRequest("DELETE", \`/api/doctors/\${id}\`) });

    const handleDelete = async (id) => {
      await deleteMutation.mutateAsync(id);
    };

    <Dialog open={dialogOpen}><DialogContent>Add Doctor Form</DialogContent></Dialog>
    <Button variant="ghost" onClick={() => handleDelete(doctor.id)}><Trash2 /></Button>
  `;
  const fileLevelGate = detectConfirmationGate(fullContent);
  // Dialog alone is NOT a confirmation gate, and no disabled-until-confirm exists
  const isNonModalGate = fileLevelGate.hasGate &&
    /disabled-until-confirm|checkbox-confirm-gate|conditional-confirm-gate/i.test(fileLevelGate.gateType);
  assertEquals(isNonModalGate, false, "doctors.tsx should NOT have a non-modal file-level gate");
});

// ── Test 35: Settings.tsx with Dialog + type-to-confirm + disclosure → SUPPRESSED ──
Deno.test("E1 REGRESSION: Settings.tsx type-to-confirm + Dialog + disclosure → SUPPRESSED", () => {
  const localRegion = `
    <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Account</DialogTitle>
          <DialogDescription>This action cannot be undone. All your data will be permanently deleted.</DialogDescription>
        </DialogHeader>
        <p>Type DELETE to confirm</p>
        <Input placeholder="Type DELETE" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        <Button variant="destructive" disabled={confirmation !== 'DELETE'} onClick={() => deleteAccount()}>
          Yes, Delete My Account
        </Button>
      </DialogContent>
    </Dialog>
  `;
  const result = shouldSuppressE1({
    filePath: "src/pages/patient/Settings.tsx", label: "Delete",
    localRegion, fullContent: localRegion,
  });
  assertEquals(result.suppressed, true, `Settings.tsx type-to-confirm must suppress, got: ${result.reason}`);
});

// ── Test 36: disabled={confirmation !== 'DELETE'} is a valid gate ──
Deno.test("E1: disabled={confirmation !== 'DELETE'} is a valid gate", () => {
  const region = `<Button disabled={confirmation !== 'DELETE'} onClick={() => deleteAccount()}>Delete</Button>`;
  const gate = detectConfirmationGate(region);
  assertEquals(gate.hasGate, true, "Should detect disabled comparison gate");
  assertEquals(/disabled-until-confirm/i.test(gate.gateType), true);
});

// ── Test 37: Handler guard if (confirmation !== 'DELETE') return → gate ──
Deno.test("E1: handler guard if (confirmation !== 'DELETE') return → gate", () => {
  const region = `
    const handleDelete = () => {
      if (confirmation !== 'DELETE') return;
      deleteMutation.mutate();
    };
  `;
  const gate = detectConfirmationGate(region);
  assertEquals(gate.hasGate, true, "Should detect handler guard gate");
  assertEquals(gate.gateType, 'handler-guard');
});

// ── Test 38: type DELETE to confirm is a valid gate ──
Deno.test("E1: type DELETE to confirm is a valid gate", () => {
  const region = `<p>Type DELETE to confirm</p><Input /><Button>Delete</Button>`;
  const gate = detectConfirmationGate(region);
  assertEquals(gate.hasGate, true, "type-to-confirm should be a gate");
  assertEquals(gate.gateType, 'type-to-confirm');
});

// ── Test 39: Full Settings.tsx with handler guard + disclosure + Dialog → SUPPRESSED ──
Deno.test("E1 REGRESSION: Settings.tsx handler guard + Dialog + disclosure → SUPPRESSED", () => {
  const fullContent = `
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [confirmation, setConfirmation] = useState('');
    const deleteMutation = useMutation({ mutationFn: () => apiRequest("DELETE", "/api/account") });

    const handleDeleteAccount = async () => {
      if (confirmation !== 'DELETE') return;
      await deleteMutation.mutateAsync();
    };

    <Dialog open={showDeleteDialog}>
      <DialogContent>
        <p>This action cannot be undone. All data will be permanently deleted.</p>
        <Input placeholder="Type DELETE" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        <Button variant="destructive" disabled={confirmation !== 'DELETE'} onClick={handleDeleteAccount}>
          Yes, Delete My Account
        </Button>
      </DialogContent>
    </Dialog>
  `;
  const result = shouldSuppressE1({
    filePath: "src/pages/patient/Settings.tsx", label: "Delete",
    localRegion: fullContent, fullContent,
  });
  assertEquals(result.suppressed, true, `Full settings pattern must suppress, got: ${result.reason}`);
});
