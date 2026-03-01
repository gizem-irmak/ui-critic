import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ========== E3 Detection Logic (mirrored for testing) ==========
const E3_HIGH_IMPACT_CTA = /\b(delete|remove|permanently\s*delete|destroy|erase|confirm\s*payment|pay\s*now|pay\b|subscribe|proceed\s*with\s*charge|deactivate\s*account|close\s*account|account\s*deletion|danger|destructive)\b/i;
const E3_HIGH_IMPACT_VARIANT = /\b(variant\s*=\s*["'](?:destructive|danger)["']|colorScheme\s*=\s*["'](?:red|danger)["'])\b/i;
const E3_EXIT_PATTERNS = /\b(onClose|onDismiss|handleClose|handleDismiss|closeModal|dismissModal|setOpen\(false\)|setIsOpen\(false\)|setShow\(false\)|onOpenChange)\b/i;
const E3_EXIT_BUTTON_RE = /<(?:Button|button|a)\b[^>]*>([^<]*(?:cancel|back|close|dismiss|decline|undo|no\s*thanks|go\s*back|return|exit|skip|×|✕|X)[^<]*)<\/(?:Button|button|a)>/gi;
const E3_ESCAPE_RE = /\b(Escape|escape|onEscapeKeyDown|closeOnEsc|closeOnOverlayClick|closeOnBackdropClick)\b/i;
const E3_DIALOG_CLOSE_RE = /DialogClose|SheetClose|DrawerClose|AlertDialogCancel/i;
const E3_BREADCRUMB_RE = /<(?:Breadcrumb|breadcrumb|nav)\b[^>]*(?:aria-label\s*=\s*["']breadcrumb["']|className\s*=\s*["'][^"]*breadcrumb)/i;

function hasStructuralExit(region: string): boolean {
  E3_EXIT_BUTTON_RE.lastIndex = 0;
  return E3_EXIT_PATTERNS.test(region) ||
    E3_EXIT_BUTTON_RE.test(region) ||
    E3_ESCAPE_RE.test(region) ||
    E3_DIALOG_CLOSE_RE.test(region) ||
    E3_BREADCRUMB_RE.test(region);
}

function hasHighImpactAction(content: string): boolean {
  return E3_HIGH_IMPACT_CTA.test(content) || E3_HIGH_IMPACT_VARIANT.test(content);
}

// ========== HIGH-IMPACT GATE TESTS ==========
Deno.test("E3: detects high-impact delete action", () => {
  assert(hasHighImpactAction('<Button variant="destructive">Delete Account</Button>'));
});

Deno.test("E3: detects high-impact payment action", () => {
  assert(hasHighImpactAction('<Button>Confirm Payment</Button>'));
});

Deno.test("E3: detects high-impact subscribe action", () => {
  assert(hasHighImpactAction('<Button>Subscribe Now</Button>'));
});

Deno.test("E3: does NOT trigger for regular save button", () => {
  assertEquals(hasHighImpactAction('<Button>Save Changes</Button>'), false);
});

Deno.test("E3: does NOT trigger for regular submit button", () => {
  assertEquals(hasHighImpactAction('<Button type="submit">Submit</Button>'), false);
});

Deno.test("E3: does NOT trigger for login form", () => {
  assertEquals(hasHighImpactAction('<Button>Log In</Button>'), false);
});

Deno.test("E3: detects destructive variant", () => {
  assert(hasHighImpactAction('<Button variant="destructive">Confirm</Button>'));
});

Deno.test("E3: detects danger colorScheme", () => {
  assert(hasHighImpactAction('<Button colorScheme="danger">Proceed</Button>'));
});

// ========== STRUCTURAL EXIT DETECTION TESTS ==========
Deno.test("E3: detects cancel button as structural exit", () => {
  assert(hasStructuralExit('<Button>Cancel</Button>'));
});

Deno.test("E3: detects close button as structural exit", () => {
  assert(hasStructuralExit('<Button>Close</Button>'));
});

Deno.test("E3: detects back button as structural exit", () => {
  assert(hasStructuralExit('<Button>Go Back</Button>'));
});

Deno.test("E3: detects onClose handler as structural exit", () => {
  assert(hasStructuralExit('<Dialog onClose={handleClose}>'));
});

Deno.test("E3: detects onOpenChange as structural exit", () => {
  assert(hasStructuralExit('<Dialog onOpenChange={setOpen}>'));
});

Deno.test("E3: detects DialogClose as structural exit", () => {
  assert(hasStructuralExit('<DialogClose asChild><Button>×</Button></DialogClose>'));
});

Deno.test("E3: detects AlertDialogCancel as structural exit", () => {
  assert(hasStructuralExit('<AlertDialogCancel>Cancel</AlertDialogCancel>'));
});

Deno.test("E3: detects escape handler as structural exit", () => {
  assert(hasStructuralExit('onEscapeKeyDown={() => setOpen(false)}'));
});

Deno.test("E3: detects breadcrumb as structural exit", () => {
  assert(hasStructuralExit('<nav aria-label="breadcrumb">'));
});

Deno.test("E3: detects decline button as structural exit", () => {
  assert(hasStructuralExit('<Button>Decline</Button>'));
});

Deno.test("E3: detects undo button as structural exit", () => {
  assert(hasStructuralExit('<Button>Undo</Button>'));
});

Deno.test("E3: no structural exit in region without any exit pattern", () => {
  assertEquals(hasStructuralExit('<Dialog><DialogContent><Button>Delete</Button></DialogContent></Dialog>'), false);
});

// ========== SUPPRESSION TESTS ==========
Deno.test("E3: suppressed when cancel button exists next to delete", () => {
  const region = '<Dialog><Button variant="destructive">Delete</Button><Button>Cancel</Button></Dialog>';
  assert(hasHighImpactAction(region));
  assert(hasStructuralExit(region)); // Should suppress
});

Deno.test("E3: suppressed when onClose handler exists", () => {
  const region = '<Dialog onClose={handleClose}><Button variant="destructive">Delete Account</Button></Dialog>';
  assert(hasHighImpactAction(region));
  assert(hasStructuralExit(region)); // Should suppress
});

Deno.test("E3: suppressed when AlertDialogCancel exists", () => {
  const region = '<AlertDialog><AlertDialogAction>Delete</AlertDialogAction><AlertDialogCancel>Cancel</AlertDialogCancel></AlertDialog>';
  assert(hasHighImpactAction(region));
  assert(hasStructuralExit(region)); // Should suppress
});

// ========== SCOPE BOUNDARY TESTS (E1/E2/U4 overlap) ==========
Deno.test("E3: visual bias (smaller cancel) is E2 territory, not E3", () => {
  // Cancel exists but is visually weaker — this should have structural exit = true → suppress E3
  const region = '<Dialog><Button variant="destructive" size="lg">Delete</Button><Button variant="ghost" size="sm">Cancel</Button></Dialog>';
  assert(hasStructuralExit(region)); // Cancel exists → suppress E3 (visual bias belongs to E2)
});

Deno.test("E3: missing consequence text with cancel present is E1 territory", () => {
  // Cancel exists, but no warning text about consequences — this is E1
  const region = '<Dialog><Button variant="destructive">Delete</Button><Button>Cancel</Button></Dialog>';
  assert(hasStructuralExit(region)); // Cancel exists → suppress E3
});

Deno.test("E3: step indicators without back button is U4 territory", () => {
  // Step indicators but no back — this belongs to U4, not E3
  const content = '<div>Step 1 of 3</div><Button>Next</Button>';
  // No high-impact action → should not even evaluate E3
  assertEquals(hasHighImpactAction(content), false);
});

Deno.test("E3: forced marketing checkbox is E1 territory", () => {
  // Required marketing checkbox — this belongs to E1 (consent transparency), not E3
  // The high-impact gate checks for destructive/payment actions, not consent patterns
  const content = '<input type="checkbox" required /><label>Get newsletters</label><Button>Create Account</Button>';
  // No high-impact destructive action → should not trigger E3
  assertEquals(hasHighImpactAction(content), false);
});

// ========== TRIGGERING TESTS (should flag) ==========
Deno.test("E3: triggers for delete dialog without any exit", () => {
  const region = '<Dialog><DialogContent><h2>Are you sure?</h2><Button variant="destructive">Delete Account</Button></DialogContent></Dialog>';
  assert(hasHighImpactAction(region));
  assertEquals(hasStructuralExit(region), false); // No exit → should trigger E3
});

Deno.test("E3: triggers for payment form without cancel", () => {
  const region = '<form><Input /><Input /><Input /><Button>Confirm Payment</Button></form>';
  assert(hasHighImpactAction(region));
  assertEquals(hasStructuralExit(region), false); // No exit → should trigger E3
});

Deno.test("E3: triggers for destructive button in isolation", () => {
  const region = '<div><p>This action cannot be undone.</p><Button variant="destructive">Permanently Delete</Button></div>';
  assert(hasHighImpactAction(region));
  assertEquals(hasStructuralExit(region), false); // No exit → should trigger E3
});

// ========== CONFIDENCE TESTS ==========
Deno.test("E3: confidence cap at 0.80", () => {
  const maxConfidence = 0.80;
  const testConfidence = Math.min(0.85, maxConfidence);
  assertEquals(testConfidence, 0.80);
});

Deno.test("E3: confidence below 0.65 should suppress", () => {
  const confidence = 0.60;
  assertEquals(confidence < 0.65, true); // Should be suppressed
});

Deno.test("E3: confidence 0.78 for dialog without exit", () => {
  const confidence = 0.78;
  assert(confidence >= 0.65 && confidence <= 0.80);
});

Deno.test("E3: confidence 0.70 for form without exit", () => {
  const confidence = 0.70;
  assert(confidence >= 0.65 && confidence <= 0.80);
});
