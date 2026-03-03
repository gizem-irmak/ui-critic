import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// ── E1 Regex and logic replicas for unit testing ──

const E1_HIGH_IMPACT_KEYWORDS = /\b(delete|remove\s*account|close\s*account|permanently\s*delete|destroy|erase|cancel\s*(?:subscription|membership|plan|account)|subscribe|buy|purchase|pay\b|upgrade|checkout|confirm\s*(?:order|purchase|payment)|finalize|publish|authorize|grant\s*access|share\s*data|export\s*data|connect\s*account)\b/i;
const E1_DESTRUCTIVE_LABEL_RE = /\b(delete|remove|trash|destroy|erase)\b/i;
const E1_AUTH_FLOW_PATH = /(?:forgot.?password|reset.?password|sign.?in|sign.?up|login|register|auth|verify.?email|confirm.?email)/i;
const E1_AUTH_EXCLUDED_LABELS = /\b(send\s*reset\s*link|reset\s*password|sign\s*in|sign\s*up|log\s*in|log\s*out|sign\s*out|register|create\s*account|verify\s*email|resend\s*code|resend\s*link)\b/i;
const E1_OVERRIDE_IN_AUTH = /\b(delete|erase|destroy|permanently|purchase|pay\b|subscribe|checkout|billing)\b/i;
const E1_STRONG_DISCLOSURE_RE = /\b(cannot\s*be\s*undone|irreversible|permanent(?:ly)?|will\s*be\s*(?:deleted|removed|lost|erased)|this\s*(?:action|cannot)|data\s*will\s*be\s*removed|all\s*(?:your\s*)?data|appointments|messages|records|files)\b/gi;
const E1_CONFIRMATION_PATTERNS = /\b(AlertDialog|confirm\s*\(|useConfirm|ConfirmDialog|ConfirmModal|confirmation|modal|Dialog)\b/i;
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

function detectConfirmationGate(content: string): { hasGate: boolean; gateType: string } {
  if (E1_CONFIRMATION_PATTERNS.test(content)) return { hasGate: true, gateType: 'confirmation-dialog' };
  if (E1_TWO_STEP_STATE_RE.test(content)) return { hasGate: true, gateType: 'two-step-state' };
  if (/\bwindow\.confirm\s*\(/i.test(content)) return { hasGate: true, gateType: 'window.confirm' };
  return { hasGate: false, gateType: '' };
}

function detectRecovery(content: string): { hasRecovery: boolean; recoveryType: string } {
  if (E1_UNDO_RECOVERY_RE.test(content)) {
    const m = content.match(E1_UNDO_RECOVERY_RE);
    return { hasRecovery: true, recoveryType: m?.[1] || 'undo' };
  }
  return { hasRecovery: false, recoveryType: '' };
}

function shouldSuppressE1(opts: {
  filePath: string; label: string; fileContent: string; handlerName?: string;
}): { suppressed: boolean; reason: string } {
  const { filePath, label, fileContent } = opts;

  // Auth-flow file exclusion
  if (E1_AUTH_FLOW_PATH.test(filePath) && !E1_OVERRIDE_IN_AUTH.test(fileContent)) {
    return { suppressed: true, reason: 'auth-flow file without destructive/billing override' };
  }
  // Auth-excluded label
  if (E1_AUTH_EXCLUDED_LABELS.test(label)) {
    return { suppressed: true, reason: 'auth-excluded label' };
  }
  // Not a high-impact keyword (for label-based detection)
  if (!E1_HIGH_IMPACT_KEYWORDS.test(label) && !E1_DELETE_HANDLER_RE.test(label)) {
    return { suppressed: true, reason: 'no high-impact keyword in label' };
  }

  // Recovery suppression
  const recovery = detectRecovery(fileContent);
  if (recovery.hasRecovery) {
    return { suppressed: true, reason: `recovery mechanism: ${recovery.recoveryType}` };
  }

  // Confirmation gate + disclosure pass-through
  const gate = detectConfirmationGate(fileContent);
  const disclosureTerms = extractDisclosureTerms(fileContent);
  if (gate.hasGate && disclosureTerms.length > 0) {
    return { suppressed: true, reason: `disclosure (${disclosureTerms.join(', ')}) + ${gate.gateType}` };
  }
  // Confirmation gate alone for destructive labels
  if (gate.hasGate && E1_DESTRUCTIVE_LABEL_RE.test(label)) {
    return { suppressed: true, reason: `destructive label + ${gate.gateType}` };
  }

  return { suppressed: false, reason: '' };
}

// ── Test 1: Settings delete account with full disclosure + confirmation ──
Deno.test("E1: Settings delete account with disclosure + confirmation → SUPPRESSED", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/Settings.tsx",
    label: "Delete Account",
    fileContent: `
      <AlertDialog>
        <p>This action cannot be undone. Your data will be permanently removed.</p>
        <Button variant="destructive">Delete Account</Button>
      </AlertDialog>
    `,
  });
  assertEquals(result.suppressed, true, `Expected suppression but got: ${result.reason}`);
});

// ── Test 2: ForgotPassword "Send reset link" → SUPPRESSED (auth-excluded label) ──
Deno.test("E1: ForgotPassword send reset link → SUPPRESSED (auth label)", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/ForgotPassword.tsx",
    label: "Send reset link",
    fileContent: `<Button>Send reset link</Button>`,
  });
  assertEquals(result.suppressed, true);
});

// ── Test 3: Auth-flow file without destructive content → SUPPRESSED ──
Deno.test("E1: Auth-flow file without destructive keywords → SUPPRESSED", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/ResetPassword.tsx",
    label: "Reset Password",
    fileContent: `<Button>Reset Password</Button>`,
  });
  assertEquals(result.suppressed, true);
});

// ── Test 4: Delete with no disclosure or confirmation → NOT suppressed ──
Deno.test("E1: Delete with no disclosure or confirmation → NOT suppressed", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/Dashboard.tsx",
    label: "Delete",
    fileContent: `<Button variant="destructive">Delete</Button>`,
  });
  assertEquals(result.suppressed, false, "Should NOT be suppressed");
});

// ── Test 5: "Subscribe" with no pricing disclosure → NOT suppressed ──
Deno.test("E1: Subscribe without pricing → NOT suppressed", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/Pricing.tsx",
    label: "Subscribe",
    fileContent: `<Button>Subscribe</Button>`,
  });
  assertEquals(result.suppressed, false);
});

// ── Test 6: Generic "reset" → SUPPRESSED (not high-impact) ──
Deno.test("E1: Generic 'reset' label → SUPPRESSED (not in keyword list)", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/Settings.tsx",
    label: "Reset",
    fileContent: `<Button>Reset</Button>`,
  });
  assertEquals(result.suppressed, true);
});

// ── Test 7: Generic "Accept" → SUPPRESSED ──
Deno.test("E1: Generic 'Accept' label → SUPPRESSED (not in keyword list)", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/Terms.tsx",
    label: "Accept",
    fileContent: `<Button>Accept</Button>`,
  });
  assertEquals(result.suppressed, true);
});

// ── Test 8: Delete in auth-flow file WITH destructive content → NOT suppressed ──
Deno.test("E1: Delete account inside auth file → NOT suppressed (override)", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/auth/AccountSettings.tsx",
    label: "Delete Account",
    fileContent: `<Button variant="destructive">Delete Account</Button>`,
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
  const result = shouldSuppressE1({
    filePath: "src/pages/Items.tsx",
    label: "Delete",
    fileContent: `
      <Button onClick={() => deleteItem(id)}>Delete</Button>
      toast({ title: "Deleted", action: "undo" })
    `,
  });
  assertEquals(result.suppressed, true);
  assertEquals(result.reason.includes('recovery'), true);
});

// ── Test 16: Delete with two-step state + destructive label → SUPPRESSED ──
Deno.test("E1: Delete with setPendingDelete state → SUPPRESSED", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/Doctors.tsx",
    label: "Delete",
    fileContent: `
      const handleDelete = () => { setPendingDelete(id); };
      <Button onClick={handleDelete}>Delete</Button>
    `,
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
  // Has high-impact keyword, has DELETE, no confirmation gate
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
  const recovery = detectRecovery(content);
  // Note: archive keyword triggers recovery
  assertEquals(E1_UNDO_RECOVERY_RE.test(content), true);
});

// ── Test 20: Destructive label + confirmation dialog (no disclosure) → SUPPRESSED ──
Deno.test("E1: Delete + Dialog (no disclosure) → SUPPRESSED for destructive label", () => {
  const result = shouldSuppressE1({
    filePath: "src/pages/Items.tsx",
    label: "Delete",
    fileContent: `
      <Dialog>
        <Button>Delete</Button>
      </Dialog>
    `,
  });
  assertEquals(result.suppressed, true, "Destructive label + confirmation dialog should suppress");
});
