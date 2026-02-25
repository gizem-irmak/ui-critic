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

  // Check for STRONG visible replacement → PASS
  // Any focus:ring-* (not ring-0), focus:border-* (not border-0/none), focus:shadow-* (not none), focus:outline-* (not none)
  const hasStrongReplacement = /focus(?:-visible)?:ring-(?!0\b)/.test(combined) ||
                                /focus(?:-visible)?:border-(?!0\b|none)/.test(combined) ||
                                /focus(?:-visible)?:shadow-(?!none)/.test(combined) ||
                                /focus(?:-visible)?:outline-(?!none)/.test(combined);

  if (hasStrongReplacement) {
    return 'pass';
  }

  // Check for WEAK/AMBIGUOUS focus styling → Potential (Borderline)
  // Includes: focus:bg-*, focus:text-*, focus:underline, focus:opacity-*, focus:font-*
  const hasWeakFocusStyling = /focus(?:-visible)?:(?:bg-|text-|underline|opacity-|font-)/.test(combined);

  if (hasWeakFocusStyling) {
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

Deno.test("A2: ring-1 + gray-200 + ring-offset-0 → PASS (focus:ring-1 is a valid replacement)", () => {
  const evidence = "focus:outline-none focus:ring-1 focus:ring-gray-200 ring-offset-0";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Should PASS — focus:ring-1 is a valid focus replacement");
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

Deno.test("A2: outline-none + focus:shadow-sm → PASS (focus:shadow-sm is a valid replacement)", () => {
  const evidence = "focus:outline-none focus:shadow-sm";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "focus:shadow-sm is a valid focus replacement → PASS");
});

Deno.test("A2: outline-none + ring-slate-200 + focus:ring-1 → PASS (focus:ring-1 is valid)", () => {
  const evidence = "focus:outline-none focus:ring-1 ring-slate-200";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "focus:ring-1 is a valid replacement → PASS");
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

Deno.test("A2: focus:border-0 + ring-1 + ring-zinc-200 → PASS (focus:ring-1 is valid)", () => {
  const evidence = "focus:border-0 focus:ring-1 ring-zinc-200";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "focus:ring-1 is a valid replacement → PASS");
});

Deno.test("A2: outline-none + focus:ring-1 (no muted color) → PASS (focus:ring-1 is valid)", () => {
  const evidence = "outline-none focus:ring-1 focus:ring-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "focus:ring-1 is a valid replacement → PASS");
});

Deno.test("A2: outline-none + focus-visible:border-primary → PASS (border replacement)", () => {
  const evidence = "focus:outline-none focus-visible:border-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Border replacement should PASS");
});

Deno.test("A2: focus-visible:outline-none + focus-visible:ring-1 + focus-visible:ring-ring → PASS (ring-1 is valid)", () => {
  const evidence = "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Should PASS — focus-visible:ring-1 is a valid replacement");
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
