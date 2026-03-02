import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// ── E1 Regex and logic replicas for unit testing ──

const E1_HIGH_IMPACT_KEYWORDS = /\b(delete|remove\s*account|close\s*account|permanently\s*delete|destroy|erase|cancel\s*(?:subscription|membership|plan|account)|subscribe|buy|purchase|pay\b|upgrade|checkout|confirm\s*(?:order|purchase|payment)|finalize|publish|authorize|grant\s*access|share\s*data|export\s*data|connect\s*account)\b/i;
const E1_AUTH_FLOW_PATH = /(?:forgot.?password|reset.?password|sign.?in|sign.?up|login|register|auth|verify.?email|confirm.?email)/i;
const E1_AUTH_EXCLUDED_LABELS = /\b(send\s*reset\s*link|reset\s*password|sign\s*in|sign\s*up|log\s*in|log\s*out|sign\s*out|register|create\s*account|verify\s*email|resend\s*code|resend\s*link)\b/i;
const E1_OVERRIDE_IN_AUTH = /\b(delete|erase|destroy|permanently|purchase|pay\b|subscribe|checkout|billing)\b/i;
const E1_STRONG_DISCLOSURE_RE = /\b(cannot\s*be\s*undone|irreversible|permanent(?:ly)?|will\s*be\s*(?:deleted|removed|lost|erased)|this\s*(?:action|cannot)|data\s*will\s*be\s*removed|all\s*(?:your\s*)?data|appointments|messages|records|files)\b/gi;
const E1_CONFIRMATION_PATTERNS = /\b(AlertDialog|confirm\s*\(|useConfirm|ConfirmDialog|ConfirmModal|confirmation|modal|Dialog)\b/i;
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

function shouldSuppressE1(filePath: string, label: string, fileContent: string): { suppressed: boolean; reason: string } {
  // Auth-flow file exclusion
  if (E1_AUTH_FLOW_PATH.test(filePath) && !E1_OVERRIDE_IN_AUTH.test(fileContent)) {
    return { suppressed: true, reason: 'auth-flow file without destructive/billing override' };
  }
  // Auth-excluded label
  if (E1_AUTH_EXCLUDED_LABELS.test(label)) {
    return { suppressed: true, reason: 'auth-excluded label' };
  }
  // Not a high-impact keyword
  if (!E1_HIGH_IMPACT_KEYWORDS.test(label)) {
    return { suppressed: true, reason: 'no high-impact keyword in label' };
  }
  // Disclosure + confirmation pass-through
  const disclosureTerms = extractDisclosureTerms(fileContent);
  const hasConfirmation = E1_CONFIRMATION_PATTERNS.test(fileContent);
  if (disclosureTerms.length > 0 && hasConfirmation) {
    return { suppressed: true, reason: `disclosure pass-through: ${disclosureTerms.join(', ')} + confirmation` };
  }
  return { suppressed: false, reason: '' };
}

// ── Test 1: Settings delete account with full disclosure + confirmation ──
Deno.test("E1: Settings delete account with disclosure + confirmation → SUPPRESSED", () => {
  const filePath = "src/pages/Settings.tsx";
  const label = "Delete Account";
  const content = `
    <div>
      <h2>Delete Account</h2>
      <p>This action cannot be undone. Your data will be permanently removed, including appointments, messages, and records.</p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">Delete Account</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <p>Are you sure? Type DELETE to confirm.</p>
          <input placeholder="type DELETE to confirm" />
          <Checkbox>I understand this action is irreversible</Checkbox>
          <Button variant="destructive">Confirm Deletion</Button>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  `;
  const result = shouldSuppressE1(filePath, label, content);
  assertEquals(result.suppressed, true, `Expected suppression but got: ${result.reason}`);
});

// ── Test 2: ForgotPassword "Send reset link" → SUPPRESSED (auth-excluded label) ──
Deno.test("E1: ForgotPassword send reset link → SUPPRESSED (auth label)", () => {
  const filePath = "src/pages/ForgotPassword.tsx";
  const label = "Send reset link";
  const content = `
    <div>
      <h1>Forgot Password</h1>
      <p>Enter your email and we'll send you a reset link.</p>
      <Button>Send reset link</Button>
    </div>
  `;
  const result = shouldSuppressE1(filePath, label, content);
  assertEquals(result.suppressed, true);
});

// ── Test 3: ForgotPassword file with no destructive content → SUPPRESSED (auth-flow path) ──
Deno.test("E1: Auth-flow file without destructive keywords → SUPPRESSED", () => {
  const filePath = "src/pages/ResetPassword.tsx";
  const label = "Reset Password";
  const content = `
    <div>
      <h1>Reset Password</h1>
      <Button>Reset Password</Button>
    </div>
  `;
  const result = shouldSuppressE1(filePath, label, content);
  assertEquals(result.suppressed, true);
});

// ── Test 4: True positive — "Confirm" for destructive action with no disclosure ──
Deno.test("E1: Delete with no disclosure or confirmation → NOT suppressed (true positive)", () => {
  const filePath = "src/pages/Dashboard.tsx";
  const label = "Delete";
  const content = `
    <div>
      <h2>Manage Items</h2>
      <Button variant="destructive">Delete</Button>
    </div>
  `;
  const result = shouldSuppressE1(filePath, label, content);
  assertEquals(result.suppressed, false, "Should NOT be suppressed — no disclosure, no confirmation");
});

// ── Test 5: "Subscribe" with no pricing disclosure → NOT suppressed ──
Deno.test("E1: Subscribe without pricing → NOT suppressed", () => {
  const filePath = "src/pages/Pricing.tsx";
  const label = "Subscribe";
  const content = `
    <div>
      <h2>Choose a Plan</h2>
      <Button>Subscribe</Button>
    </div>
  `;
  const result = shouldSuppressE1(filePath, label, content);
  assertEquals(result.suppressed, false);
});

// ── Test 6: "reset" alone no longer triggers (removed from keywords) ──
Deno.test("E1: Generic 'reset' label → SUPPRESSED (not in keyword list)", () => {
  const filePath = "src/pages/Settings.tsx";
  const label = "Reset";
  const content = `<Button>Reset</Button>`;
  const result = shouldSuppressE1(filePath, label, content);
  assertEquals(result.suppressed, true, "Generic 'reset' should not be a high-impact keyword");
});

// ── Test 7: "accept" alone no longer triggers ──
Deno.test("E1: Generic 'Accept' label → SUPPRESSED (not in keyword list)", () => {
  const filePath = "src/pages/Terms.tsx";
  const label = "Accept";
  const content = `<Button>Accept</Button>`;
  const result = shouldSuppressE1(filePath, label, content);
  assertEquals(result.suppressed, true);
});

// ── Test 8: Delete in auth-flow file WITH destructive content → NOT suppressed ──
Deno.test("E1: Delete account inside auth file → NOT suppressed (override)", () => {
  const filePath = "src/pages/auth/AccountSettings.tsx";
  const label = "Delete Account";
  const content = `
    <div>
      <h2>Delete your account</h2>
      <Button variant="destructive">Delete Account</Button>
    </div>
  `;
  // Auth path matches, but "delete" is in content → override applies → not excluded by auth gate
  // However, no disclosure/confirmation → should NOT be suppressed
  const result = shouldSuppressE1(filePath, label, content);
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
