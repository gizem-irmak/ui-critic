import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

/**
 * A2 Focus Visibility — Borderline Classification Logic
 * 
 * Extracts the classification logic from analyze-zip post-processing
 * to test that subtle/borderline focus patterns are correctly detected.
 */

interface A2ClassificationResult {
  isBorderline: boolean;
  isConfirmed: boolean;
  confidenceRange: [number, number]; // [min, max]
}

/**
 * Classifies A2 focus visibility findings based on evidence text.
 * Mirrors the exact regex logic used in the analyze-zip post-processing.
 */
function classifyA2Finding(evidence: string, diagnosis: string = ''): A2ClassificationResult | 'skip' | 'pass' {
  const combined = (evidence + ' ' + diagnosis).toLowerCase();

  // PREREQUISITE: Must mention outline removal or ring/border zeroing
  const mentionsOutlineRemoval = /outline-none|focus:outline-none|focus-visible:outline-none|ring-0|focus:ring-0|focus-visible:ring-0|focus:border-0|focus-visible:border-0/.test(combined);
  if (!mentionsOutlineRemoval) {
    return 'skip';
  }

  // Extract focus-related class tokens
  const focusClassTokens: string[] = evidence.match(/focus(?:-visible)?:(?:ring(?:-\w+)?|border(?:-\w+)?|shadow(?:-\w+)?|outline(?:-\w+)?|bg-\w+|text-\w+)/gi) || [];

  // Check for STRONG visible focus replacement (PASS)
  const hasStrongRingToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:ring-[2-9]/i.test(t));
  const hasBorderToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:border(?!-0)/i.test(t));
  const hasShadowToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:shadow-(?!none|sm\b)/i.test(t));
  const hasOutlineToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:outline-(?!none)/i.test(t));

  const hasStrongRingInDiagnosis = /focus(?:-visible)?:ring-[2-9]|ring-offset-[2-9]/.test(combined);
  const hasBorderInDiagnosis = /focus(?:-visible)?:border-(?!0)/.test(combined);
  const hasShadowInDiagnosis = /focus(?:-visible)?:shadow-(?!none|sm\b)/.test(combined);

  const hasVisibleReplacement = hasStrongRingToken || hasBorderToken || hasShadowToken || hasOutlineToken ||
                                 hasStrongRingInDiagnosis || hasBorderInDiagnosis || hasShadowInDiagnosis;

  if (hasVisibleReplacement) {
    return 'pass';
  }

  // Borderline detection
  const hasBgToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:bg-/i.test(t));
  const hasTextToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:text-/i.test(t));
  const hasBackgroundOnlyFocus = (hasBgToken || hasTextToken || /focus:bg-|focus-visible:bg-|focus:text-|focus-visible:text-/.test(combined)) &&
                                  !hasStrongRingToken && !hasBorderToken && !hasShadowToken && !hasOutlineToken;

  const hasRing1Only = /(?:focus(?:-visible)?:)?ring-1\b/.test(combined) && !/focus(?:-visible)?:ring-[2-9]/.test(combined);
  const hasMutedRingColor = /ring-(?:gray|slate|zinc)-(?:100|200)\b/.test(combined);
  const hasShadowSmOnly = /focus(?:-visible)?:shadow-sm\b/.test(combined) &&
                           !hasStrongRingToken && !hasBorderToken && !hasOutlineToken;
  const hasFocusOnlyStyles = /\bfocus:(?:ring-[^0]|border-(?!0)|shadow-(?!none)|outline-(?!none))/.test(combined) && !/focus-visible:/.test(combined);

  const hasAnySubtleFocusStyling = hasBackgroundOnlyFocus || hasRing1Only || hasMutedRingColor || hasShadowSmOnly || hasFocusOnlyStyles;
  const isBorderline = hasAnySubtleFocusStyling;
  const isConfirmed = !isBorderline;

  return {
    isBorderline,
    isConfirmed,
    confidenceRange: isBorderline ? [0.60, 0.75] : [0.90, 0.95],
  };
}

// ============================================================
// TEST CASES
// ============================================================

Deno.test("A2: ring-1 + gray-200 + ring-offset-0 → Potential Risk (Borderline)", () => {
  const evidence = "focus:outline-none focus:ring-1 focus:ring-gray-200 ring-offset-0";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isBorderline, true, "Should be classified as borderline");
    assertEquals(result.isConfirmed, false, "Should NOT be confirmed");
    assertEquals(result.confidenceRange[0] >= 0.60, true, "Confidence min >= 60%");
    assertEquals(result.confidenceRange[1] <= 0.75, true, "Confidence max <= 75%");
  }
});

Deno.test("A2: outline-none + ring-0 → Confirmed (Blocking)", () => {
  const evidence = "focus:outline-none focus:ring-0";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Should be confirmed");
    assertEquals(result.isBorderline, false, "Should NOT be borderline");
    assertEquals(result.confidenceRange[0] >= 0.90, true, "Confidence min >= 90%");
  }
});

Deno.test("A2: outline-none + no replacement → Confirmed (Blocking)", () => {
  const evidence = "outline-none applied to button element";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Should be confirmed");
    assertEquals(result.isBorderline, false, "Should NOT be borderline");
  }
});

Deno.test("A2: outline-none + focus-visible:ring-2 → PASS", () => {
  const evidence = "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Should PASS with ring-2 replacement");
});

Deno.test("A2: outline-none + focus:bg-accent only → Borderline", () => {
  const evidence = "focus:outline-none focus:bg-accent";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isBorderline, true, "Background-only focus should be borderline");
  }
});

Deno.test("A2: outline-none + focus:shadow-sm only → Borderline", () => {
  const evidence = "focus:outline-none focus:shadow-sm";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isBorderline, true, "Shadow-sm only should be borderline");
  }
});

Deno.test("A2: outline-none + ring-slate-200 → Borderline", () => {
  const evidence = "focus:outline-none focus:ring-1 ring-slate-200";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isBorderline, true, "Muted ring color should be borderline");
  }
});

Deno.test("A2: no outline removal mentioned → SKIP", () => {
  const evidence = "button has focus:ring-2 styling";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'skip', "Should skip when no outline removal");
});

Deno.test("A2: outline-none + focus:shadow-md → PASS", () => {
  const evidence = "focus:outline-none focus:shadow-md";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Shadow-md should be a strong replacement (PASS)");
});

Deno.test("A2: focus:border-0 + ring-1 + ring-zinc-200 → Borderline", () => {
  const evidence = "focus:border-0 focus:ring-1 ring-zinc-200";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isBorderline, true, "border-0 + ring-1 + muted color should be borderline");
  }
});

Deno.test("A2: :focus without :focus-visible (subtle ring) → Borderline", () => {
  // focus:ring-1 (not ring-2+) with :focus only, no :focus-visible → borderline
  const evidence = "outline-none focus:ring-1 focus:ring-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isBorderline, true, "focus: ring-1 without focus-visible: should be borderline");
  }
});
