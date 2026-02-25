import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

/**
 * A2 Focus Visibility — Classification Logic (Refined)
 * 
 * Tests the refined A2 classification:
 * - Confirmed: suppression + NO valid replacement
 * - Potential: suppression + replacement exists but perceptibility unverifiable
 * - Pass: no suppression, or strong replacement (ring-2+, border, outline, shadow-md+)
 * - Skip: no outline removal mentioned
 * 
 * Valid replacements (prevent confirmed): focus:ring-*, focus:border-*, focus:shadow-*, focus:bg-*
 */

interface A2ClassificationResult {
  isConfirmed: boolean;
  isPotential: boolean;
  confidenceRange: [number, number];
  potentialReason?: string;
}

function classifyA2Finding(evidence: string, diagnosis: string = ''): A2ClassificationResult | 'skip' | 'pass' {
  const combined = (evidence + ' ' + diagnosis).toLowerCase();

  // PREREQUISITE: Must mention focus suppression
  const hasSuppression = /outline-none|focus:outline-none|focus-visible:outline-none|ring-0|focus:ring-0|focus-visible:ring-0|focus:border-0|focus-visible:border-0/.test(combined);
  if (!hasSuppression) {
    return 'skip';
  }

  // Extract focus-related class tokens
  const focusClassTokens: string[] = evidence.match(/focus(?:-visible)?:(?:ring(?:-\w+)?|border(?:-\w+)?|shadow(?:-\w+)?|outline(?:-\w+)?|bg-\w+|text-\w+)/gi) || [];

  // Check for STRONG visible replacement → PASS
  const hasStrongRing = focusClassTokens.some((t: string) => /focus(?:-visible)?:ring-[2-9]/i.test(t));
  const hasBorder = focusClassTokens.some((t: string) => /focus(?:-visible)?:border(?!-0)/i.test(t));
  const hasStrongShadow = focusClassTokens.some((t: string) => /focus(?:-visible)?:shadow-(?!none|sm\b)/i.test(t));
  const hasOutline = focusClassTokens.some((t: string) => /focus(?:-visible)?:outline-(?!none)/i.test(t));

  const hasStrongRingInDiag = /focus(?:-visible)?:ring-[2-9]|ring-offset-[2-9]/.test(combined);
  const hasBorderInDiag = /focus(?:-visible)?:border-(?!0)/.test(combined);
  const hasStrongShadowInDiag = /focus(?:-visible)?:shadow-(?!none|sm\b)/.test(combined);

  const hasStrongReplacement = hasStrongRing || hasBorder || hasStrongShadow || hasOutline ||
                                hasStrongRingInDiag || hasBorderInDiag || hasStrongShadowInDiag;

  if (hasStrongReplacement) {
    return 'pass';
  }

  // Check for WEAK/AMBIGUOUS focus styling → Potential (Borderline)
  // Includes: focus:bg-*, focus:text-*, focus:underline, focus:opacity-*, focus:font-*
  const hasWeakFocusStyle = /focus(?:-visible)?:(?:bg-|text-|underline|opacity-|font-)/.test(combined);

  const hasBgToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:bg-/i.test(t));
  const hasTextToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:text-/i.test(t));
  const hasRing1 = /(?:focus(?:-visible)?:)?ring-1\b/.test(combined) && !/focus(?:-visible)?:ring-[2-9]/.test(combined);
  const hasMutedRingColor = /ring-(?:gray|slate|zinc)-(?:100|200)\b/.test(combined);
  const hasShadowSmOnly = /focus(?:-visible)?:shadow-sm\b/.test(combined);

  const hasAnyWeakReplacement = hasWeakFocusStyle || hasBgToken || hasTextToken || hasRing1 || hasMutedRingColor || hasShadowSmOnly;

  if (hasAnyWeakReplacement) {
    return {
      isConfirmed: false,
      isPotential: true,
      confidenceRange: [0.60, 0.75],
      potentialReason: 'Custom focus styles exist but perceptibility cannot be statically verified.',
    };
  }

  // No replacement at all → Confirmed
  return {
    isConfirmed: true,
    isPotential: false,
    confidenceRange: [0.90, 0.95],
  };
}

// ============================================================
// TEST CASES
// ============================================================

Deno.test("A2: ring-1 + gray-200 + ring-offset-0 → Potential (replacement exists, perceptibility unverifiable)", () => {
  const evidence = "focus:outline-none focus:ring-1 focus:ring-gray-200 ring-offset-0";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "Should be potential");
    assertEquals(result.isConfirmed, false, "Should NOT be confirmed");
    assertEquals(result.confidenceRange[0] >= 0.60, true, "Confidence min >= 60%");
    assertEquals(result.confidenceRange[1] <= 0.75, true, "Confidence max <= 75%");
  }
});

Deno.test("A2: outline-none + ring-0 → Confirmed (no replacement)", () => {
  const evidence = "focus:outline-none focus:ring-0";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Should be confirmed");
    assertEquals(result.isPotential, false, "Should NOT be potential");
    assertEquals(result.confidenceRange[0] >= 0.90, true, "Confidence min >= 90%");
  }
});

Deno.test("A2: outline-none + no replacement → Confirmed", () => {
  const evidence = "outline-none applied to button element";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Should be confirmed");
    assertEquals(result.isPotential, false, "Should NOT be potential");
  }
});

Deno.test("A2: outline-none + focus-visible:ring-2 → PASS (strong replacement)", () => {
  const evidence = "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Should PASS with ring-2 replacement");
});

Deno.test("A2: outline-none + focus:bg-accent → Potential (bg is valid replacement, perceptibility unverifiable)", () => {
  const evidence = "focus:outline-none focus:bg-accent";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "Background focus should be potential, not confirmed");
    assertEquals(result.isConfirmed, false, "Should NOT be confirmed — bg is a valid replacement");
  }
});

Deno.test("A2: outline-none + focus:shadow-sm → Potential (subtle replacement)", () => {
  const evidence = "focus:outline-none focus:shadow-sm";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "Shadow-sm should be potential");
    assertEquals(result.isConfirmed, false, "Should NOT be confirmed");
  }
});

Deno.test("A2: outline-none + ring-slate-200 → Potential (muted color)", () => {
  const evidence = "focus:outline-none focus:ring-1 ring-slate-200";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "Muted ring color should be potential");
    assertEquals(result.isConfirmed, false, "Should NOT be confirmed");
  }
});

Deno.test("A2: no outline removal mentioned → SKIP", () => {
  const evidence = "button has focus:ring-2 styling";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'skip', "Should skip when no outline removal");
});

Deno.test("A2: outline-none + focus:shadow-md → PASS (strong shadow)", () => {
  const evidence = "focus:outline-none focus:shadow-md";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Shadow-md should be a strong replacement (PASS)");
});

Deno.test("A2: focus:border-0 + ring-1 + ring-zinc-200 → Potential", () => {
  const evidence = "focus:border-0 focus:ring-1 ring-zinc-200";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "border-0 + ring-1 + muted color should be potential");
    assertEquals(result.isConfirmed, false, "Should NOT be confirmed");
  }
});

Deno.test("A2: outline-none + focus:ring-1 (no muted color) → Potential (ring-1 is subtle)", () => {
  const evidence = "outline-none focus:ring-1 focus:ring-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "ring-1 should be potential (subtle)");
    assertEquals(result.isConfirmed, false, "Should NOT be confirmed — ring-1 is a valid replacement");
  }
});

Deno.test("A2: outline-none + focus-visible:border-primary → PASS (border replacement)", () => {
  const evidence = "focus:outline-none focus-visible:border-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Border replacement should PASS");
});

Deno.test("A2: focus-visible:outline-none + focus-visible:ring-1 + focus-visible:ring-ring → Potential (ring-1 is subtle but valid replacement)", () => {
  const evidence = "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "Should be potential (ring-1 is subtle)");
    assertEquals(result.isConfirmed, false, "Should NOT be confirmed — ring-1 is a valid replacement");
  }
});

Deno.test("A2: focus-visible:outline-none + focus-visible:ring-2 + focus-visible:ring-ring + focus-visible:ring-offset-2 → PASS (strong replacement)", () => {
  const evidence = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Should PASS — ring-2 + ring-offset-2 is a strong replacement");
});

// ============================================================
// ACCEPTANCE TESTS — Menu component false-positive fix
// ============================================================

Deno.test("A2: outline-none + focus:bg-accent + focus:text-accent-foreground → Potential (weak focus style, NOT confirmed)", () => {
  const evidence = "outline-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground focus:bg-accent focus:text-accent-foreground";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "Should be potential (bg/text is weak focus style)");
    assertEquals(result.isConfirmed, false, "Should NOT be confirmed — bg/text change is a weak replacement");
  }
});

Deno.test("A2: focus:outline-none alone → Confirmed (no replacement at all)", () => {
  const evidence = "focus:outline-none";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Should be confirmed — no replacement");
    assertEquals(result.isPotential, false, "Should NOT be potential");
  }
});

Deno.test("A2: focus-visible:outline-none + focus-visible:ring-2 → Not a violation (PASS)", () => {
  const evidence = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Should PASS — ring-2 is a strong replacement");
});

Deno.test("A2: outline-none + focus:underline → Potential (weak focus style)", () => {
  const evidence = "outline-none focus:underline";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "Underline is a weak focus style");
    assertEquals(result.isConfirmed, false, "Should NOT be confirmed");
  }
});

Deno.test("A2: outline-none + focus:opacity-80 → Potential (weak focus style)", () => {
  const evidence = "outline-none focus:opacity-80";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "Opacity change is a weak focus style");
    assertEquals(result.isConfirmed, false, "Should NOT be confirmed");
  }
});
