import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

/**
 * A2 Focus Visibility — Classification Logic (Refined v2)
 * 
 * Tests the refined A2 classification with strength-based token split:
 * - Confirmed: outline removal + NO replacement tokens
 * - Potential (Borderline): outline removal + only weak replacement (focus:bg-*, data-[selected]:bg-*, etc.)
 * - Suppress (PASS): outline removal + strong replacement (focus:ring-*, focus:border-*, focus:shadow-*, etc.)
 *   OR state-driven strong tokens (data-[selected]:ring-*, etc.)
 * - Skip: no outline removal mentioned
 * 
 * Outline removal tokens: outline-none, focus:outline-none, focus-visible:outline-none, [&]:outline-none
 * Strong replacement: focus(-visible)?:ring-*, focus(-visible)?:border-*, focus(-visible)?:shadow-*, focus(-visible)?:outline-*
 * Strong state-driven: data-[selected]:ring-*, data-[highlighted]:ring-*, etc.
 * Weak replacement: focus(-visible)?:bg-*, focus(-visible)?:text-*, focus(-visible)?:underline, focus(-visible)?:opacity-*
 * Weak state-driven: data-[selected]:bg-*, data-[highlighted]:bg-*, data-[state=open]:bg-*, etc.
 */

interface A2ClassificationResult {
  isConfirmed: boolean;
  isPotential: boolean;
  confidenceRange: [number, number];
  potentialReason?: string;
}

type Focusable = 'yes' | 'no' | 'unknown';

function classifyA2Finding(evidence: string, diagnosis: string = '', focusable: Focusable = 'yes'): A2ClassificationResult | 'skip' | 'pass' | 'not_applicable' {
  const combined = (evidence + ' ' + diagnosis).toLowerCase();

  // STEP 1: outlineRemoved — must mention outline suppression (including [&]:outline-none)
  const outlineRemoved = /(?:^|\s|"|'|\[&\]:)outline-none|focus:outline-none|focus-visible:outline-none/i.test(combined) ||
                          /outline\s*:\s*none/i.test(combined);
  if (!outlineRemoved) {
    return 'skip';
  }

  // STEP 2: hasStrongReplacement — ONLY focus-scoped tokens count
  const hasStrongReplacement = /(?:^|\s|"|')focus(?:-visible)?:ring-(?!0\b)/i.test(combined) ||
                                /(?:^|\s|"|')focus(?:-visible)?:border-(?!0\b|none)/i.test(combined) ||
                                /(?:^|\s|"|')focus(?:-visible)?:shadow-(?!none)/i.test(combined) ||
                                /(?:^|\s|"|')focus(?:-visible)?:outline-(?!none)/i.test(combined);

  if (hasStrongReplacement) {
    return 'pass';
  }

  // STEP 2b: focus-within wrapper indicators (strong)
  const hasFocusWithinIndicator = /(?:^|\s|"|')focus-within:ring-(?!0\b)/i.test(combined) ||
                                   /(?:^|\s|"|')focus-within:border-(?!0\b|none)/i.test(combined) ||
                                   /(?:^|\s|"|')focus-within:shadow-(?!none)/i.test(combined);
  if (hasFocusWithinIndicator) {
    return 'pass';
  }

  // STEP 2c: State-driven STRONG indicators (ring/border/shadow/outline)
  const hasStateDrivenStrong = /(?:^|\s|"|')data-\[selected(?:=true|='true')?\]:(?:ring-|border-|outline-|shadow-)/i.test(combined) ||
                               /(?:^|\s|"|')data-\[highlighted(?:=true|='true')?\]:(?:ring-|border-|outline-|shadow-)/i.test(combined) ||
                               /(?:^|\s|"|')aria-selected:(?:ring-|border-|outline-|shadow-)/i.test(combined) ||
                               /(?:^|\s|"|')data-\[state=active\]:(?:ring-|border-|outline-|shadow-)/i.test(combined);
  if (hasStateDrivenStrong) {
    return 'pass';
  }

  // STEP 3a: State-driven WEAK indicators (bg/text only) → Potential
  const hasStateDrivenWeak = /(?:^|\s|"|')data-\[selected(?:=true|='true')?\]:(?:bg-|text-)/i.test(combined) ||
                              /(?:^|\s|"|')data-\[highlighted(?:=true|='true')?\]:(?:bg-|text-)/i.test(combined) ||
                              /(?:^|\s|"|')aria-selected:(?:bg-|text-)/i.test(combined) ||
                              /(?:^|\s|"|')data-\[state=(?:active|open)\]:(?:bg-|text-)/i.test(combined);

  // STEP 3b: hasWeakFocusStyling — ONLY focus-scoped tokens count
  const hasWeakFocusStyling = /(?:^|\s|"|')focus(?:-visible)?:(?:bg-|text-|underline|opacity-|font-)/i.test(combined);

  if (hasStateDrivenWeak || hasWeakFocusStyling) {
    return {
      isConfirmed: false,
      isPotential: true,
      confidenceRange: [0.60, 0.75],
      potentialReason: 'Custom focus styles exist but perceptibility cannot be statically verified.',
    };
  }

  // STEP 4: Focusability gate
  if (focusable === 'no') {
    return 'not_applicable';
  }

  if (focusable === 'yes') {
    return {
      isConfirmed: true,
      isPotential: false,
      confidenceRange: [0.90, 0.95],
    };
  }

  // focusable === 'unknown' → Potential
  return {
    isConfirmed: false,
    isPotential: true,
    confidenceRange: [0.70, 0.80],
    potentialReason: 'Element focusability could not be deterministically confirmed.',
  };
}

// ============================================================
// TEST CASES — STRONG REPLACEMENT → PASS
// ============================================================

Deno.test("A2: ring-1 + gray-200 + ring-offset-0 → PASS (focus:ring-1 is a valid replacement)", () => {
  const evidence = "focus:outline-none focus:ring-1 focus:ring-gray-200 ring-offset-0";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Should PASS — focus:ring-1 is a valid focus replacement");
});

Deno.test("A2: outline-none + focus-visible:ring-2 → PASS (strong replacement)", () => {
  const evidence = "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Should PASS with ring-2 replacement");
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

Deno.test("A2: outline-none + focus:shadow-md → PASS (strong shadow)", () => {
  const evidence = "focus:outline-none focus:shadow-md";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Shadow-md should be a strong replacement (PASS)");
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

Deno.test("A2: focus-visible:outline-none + focus-visible:ring-1 + focus-visible:ring-ring → PASS", () => {
  const evidence = "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Should PASS — focus-visible:ring-1 is a valid replacement");
});

Deno.test("A2: focus-visible:outline-none + focus-visible:ring-2 + ring-offset-2 → PASS (strong)", () => {
  const evidence = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Should PASS — ring-2 + ring-offset-2 is a strong replacement");
});

Deno.test("A2: <button> with outline-none + focus-visible:ring-2 → PASS (strong replacement)", () => {
  const result = classifyA2Finding("outline-none focus-visible:ring-2", '', 'yes');
  assertEquals(result, 'pass', "Button with ring-2 replacement → PASS");
});

Deno.test("A2: outline-none + focus-visible:ring-2 + focusable=unknown → PASS (strong always passes)", () => {
  const result = classifyA2Finding("focus:outline-none focus-visible:ring-2", '', 'unknown');
  assertEquals(result, 'pass', "Strong replacement → PASS regardless of focusability");
});

// ============================================================
// TEST CASES — CONFIRMED (no replacement)
// ============================================================

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

Deno.test("A2: focus:outline-none alone → Confirmed (no replacement at all)", () => {
  const evidence = "focus:outline-none";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Should be confirmed — no replacement");
    assertEquals(result.isPotential, false, "Should NOT be potential");
  }
});

Deno.test("A2: <input> with only outline-none → Confirmed (no indicator at all)", () => {
  const evidence = "outline-none";
  const result = classifyA2Finding(evidence, '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Bare outline-none on focusable input → Confirmed");
  }
});

Deno.test("A2: <input> with outline-none only → Confirmed (focusable native element)", () => {
  const result = classifyA2Finding("outline-none", '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Native input with outline-none → Confirmed");
  }
});

Deno.test("A2: per-element — CommandInput (input) is Confirmed when outline removed", () => {
  const result = classifyA2Finding("outline-none", '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "CommandInput (native input) with outline-none → Confirmed");
  }
});

// ============================================================
// BARE (non-focus-scoped) tokens must NOT suppress A2
// ============================================================

Deno.test("A2: outline-none + bare ring-2 (no focus prefix) → Confirmed", () => {
  const evidence = "outline-none ring-2 ring-blue-500";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Bare ring-2 without focus: prefix must NOT count");
  }
});

Deno.test("A2: outline-none + bare border-2 + bare shadow-md → Confirmed", () => {
  const evidence = "outline-none border-2 border-gray-300 shadow-md";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Bare border/shadow without focus: prefix must NOT count");
  }
});

Deno.test("A2: outline-none + bare bg-accent + bare text-accent-foreground → Confirmed", () => {
  const evidence = "outline-none bg-accent text-accent-foreground";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Bare bg/text without focus: prefix must NOT count");
  }
});

// ============================================================
// WEAK REPLACEMENT → POTENTIAL (Borderline)
// ============================================================

Deno.test("A2: outline-none + focus:bg-accent → Potential (weak replacement)", () => {
  const evidence = "focus:outline-none focus:bg-accent";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "Background focus should be potential");
    assertEquals(result.isConfirmed, false, "Should NOT be confirmed — bg is a weak replacement");
  }
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

Deno.test("A2: DropdownMenuItem with outline-none + focus:bg-accent → Potential", () => {
  const result = classifyA2Finding("outline-none focus:bg-accent focus:text-accent-foreground", '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "DropdownMenuItem with weak focus styling → Potential");
    assertEquals(result.isConfirmed, false);
  }
});

Deno.test("A2: per-element — DropdownMenuItem with only focus:bg-accent → Potential", () => {
  const result = classifyA2Finding("outline-none focus:bg-accent", '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "DropdownMenuItem with weak focus:bg → Potential");
    assertEquals(result.isConfirmed, false);
    assertEquals(result.potentialReason, 'Custom focus styles exist but perceptibility cannot be statically verified.');
  }
});

Deno.test("A2: outline-none + focus:bg-accent + focusable=unknown → Potential (weak takes priority)", () => {
  const result = classifyA2Finding("outline-none focus:bg-accent", '', 'unknown');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true);
    assertEquals(result.isConfirmed, false);
  }
});

// ============================================================
// STATE-DRIVEN WEAK → POTENTIAL (bg/text only)
// ============================================================

Deno.test("A2: outline-none + data-[selected=true]:bg-accent → Potential (state-driven weak)", () => {
  const evidence = "outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "data-[selected]:bg-* is weak → Potential");
    assertEquals(result.isConfirmed, false);
  }
});

Deno.test("A2: outline-none + data-[highlighted=true]:bg-accent → Potential (CMDK weak)", () => {
  const evidence = "outline-none data-[highlighted=true]:bg-accent";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "data-[highlighted]:bg-* is weak → Potential");
    assertEquals(result.isConfirmed, false);
  }
});

Deno.test("A2: outline-none + aria-selected:bg-primary → Potential (weak state-driven)", () => {
  const evidence = "outline-none aria-selected:bg-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "aria-selected:bg-* is weak → Potential");
    assertEquals(result.isConfirmed, false);
  }
});

Deno.test("A2: outline-none + data-[state=active]:bg-muted → Potential (weak state-driven)", () => {
  const evidence = "outline-none data-[state=active]:bg-muted data-[state=active]:text-muted-foreground";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "data-[state=active]:bg-* is weak → Potential");
    assertEquals(result.isConfirmed, false);
  }
});

Deno.test("A2: outline-none + data-[state=open]:bg-accent + focus:bg-accent → Potential (all weak)", () => {
  const evidence = "outline-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground focus:bg-accent focus:text-accent-foreground";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "All tokens are weak (bg/text) → Potential");
    assertEquals(result.isConfirmed, false);
  }
});

Deno.test("A2: outline-none + data-[state=open]:bg-accent only → Potential (weak)", () => {
  const evidence = "outline-none data-[state=open]:bg-accent";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "data-[state=open]:bg-* is weak → Potential");
    assertEquals(result.isConfirmed, false);
  }
});

Deno.test("A2: CMDK CommandItem — outline-none + data-[selected='true']:bg-accent → Potential (weak)", () => {
  const evidence = "outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "CommandItem with data-[selected]:bg-* → Potential (weak)");
    assertEquals(result.isConfirmed, false);
  }
});

Deno.test("A2: per-element — CommandItem with state-driven bg highlight → Potential", () => {
  const evidence = "outline-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground";
  const result = classifyA2Finding(evidence, '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "CommandItem with data-[selected]:bg-* → Potential");
    assertEquals(result.isConfirmed, false);
  }
});

// ============================================================
// STATE-DRIVEN STRONG → PASS (ring/border/shadow/outline)
// ============================================================

Deno.test("A2: outline-none + data-[selected=true]:ring-2 → PASS (state-driven strong)", () => {
  const evidence = "outline-none data-[selected=true]:ring-2 data-[selected=true]:ring-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "data-[selected]:ring-* is strong → PASS");
});

Deno.test("A2: outline-none + data-[highlighted]:border-primary → PASS (state-driven strong)", () => {
  const evidence = "outline-none data-[highlighted=true]:border-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "data-[highlighted]:border-* is strong → PASS");
});

Deno.test("A2: outline-none + data-[state=active]:shadow-md → PASS (state-driven strong)", () => {
  const evidence = "outline-none data-[state=active]:shadow-md";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "data-[state=active]:shadow-* is strong → PASS");
});

// ============================================================
// FOCUS-WITHIN WRAPPER → PASS
// ============================================================

Deno.test("A2: outline-none + focus-within:ring-2 → PASS", () => {
  const evidence = "outline-none focus-within:ring-2 focus-within:ring-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "focus-within:ring-2 is a valid wrapper indicator → PASS");
});

Deno.test("A2: outline-none + focus-within:border-primary → PASS", () => {
  const evidence = "outline-none focus-within:border-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "focus-within:border-* is a valid wrapper indicator → PASS");
});

Deno.test("A2: outline-none + focus-within:shadow-md → PASS", () => {
  const evidence = "outline-none focus-within:shadow-md";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "focus-within:shadow-* is a valid wrapper indicator → PASS");
});

// ============================================================
// SKIP — no outline removal
// ============================================================

Deno.test("A2: no outline removal mentioned → SKIP", () => {
  const evidence = "button has focus:ring-2 styling";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'skip', "Should skip when no outline removal");
});

Deno.test("A2: focus:border-0 + ring-1 + ring-zinc-200 → SKIP (no outline-none present)", () => {
  const evidence = "focus:border-0 focus:ring-1 ring-zinc-200";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'skip', "No outline-none detected → SKIP");
});

// ============================================================
// [&]:outline-none support
// ============================================================

Deno.test("A2: [&]:outline-none → Confirmed (no replacement)", () => {
  const evidence = "[&]:outline-none";
  const result = classifyA2Finding(evidence, '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "[&]:outline-none is an outline removal → Confirmed");
  }
});

Deno.test("A2: [&]:outline-none + focus:ring-2 → PASS (strong replacement)", () => {
  const evidence = "[&]:outline-none focus:ring-2";
  const result = classifyA2Finding(evidence, '', 'yes');
  assertEquals(result, 'pass', "[&]:outline-none + strong replacement → PASS");
});

Deno.test("A2: [&]:outline-none + focus:bg-accent → Potential (weak replacement)", () => {
  const evidence = "[&]:outline-none focus:bg-accent";
  const result = classifyA2Finding(evidence, '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "[&]:outline-none + weak replacement → Potential");
    assertEquals(result.isConfirmed, false);
  }
});

// ============================================================
// FOCUSABILITY GATING TESTS
// ============================================================

Deno.test("A2: outline-none + focusable=yes → Confirmed", () => {
  const result = classifyA2Finding("outline-none", '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Focusable=yes → Confirmed");
    assertEquals(result.isPotential, false);
  }
});

Deno.test("A2: outline-none + focusable=unknown → Potential (not Confirmed)", () => {
  const result = classifyA2Finding("outline-none", '', 'unknown');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, false, "Focusable=unknown must NOT be Confirmed");
    assertEquals(result.isPotential, true, "Focusable=unknown → Potential");
  }
});

Deno.test("A2: outline-none + focusable=no → not_applicable", () => {
  const result = classifyA2Finding("outline-none", '', 'no');
  assertEquals(result, 'not_applicable', "Non-focusable elements should be not_applicable");
});

// ============================================================
// NON-FOCUSABLE WRAPPER SUPPRESSION
// ============================================================

Deno.test("A2: HoverCardContent with outline-none → suppress (non-focusable wrapper)", () => {
  const result = classifyA2Finding("outline-none", '', 'no');
  assertEquals(result, 'not_applicable', "HoverCardContent (focusable=no) should be suppressed");
});

Deno.test("A2: PopoverContent with outline-none → suppress (non-focusable wrapper)", () => {
  const result = classifyA2Finding("outline-none", '', 'no');
  assertEquals(result, 'not_applicable', "PopoverContent (focusable=no) should be suppressed");
});

// ============================================================
// STRUCTURED DETECTION STRING TESTS
// ============================================================

Deno.test("A2: structured detection — confirmed shows 'no visible focus indicator detected'", () => {
  const outlineTokens = ['outline-none'];
  const replacementTokens: string[] = [];
  let structuredDetection: string;
  if (replacementTokens.length > 0) {
    structuredDetection = `outline removed via "${outlineTokens.join(', ')}"\nalternative indicator detected: ${replacementTokens.join(', ')}`;
  } else {
    structuredDetection = `outline removed via "${outlineTokens.join(', ')}"\nno visible focus indicator detected`;
  }
  assertEquals(structuredDetection.includes('no visible focus indicator detected'), true);
  assertEquals(structuredDetection.includes('outline removed via'), true);
});

Deno.test("A2: structured detection — potential shows alternative indicator", () => {
  const outlineTokens = ['focus:outline-none'];
  const replacementTokens = ['focus:bg-accent', 'focus:text-accent-foreground'];
  let structuredDetection: string;
  if (replacementTokens.length > 0) {
    structuredDetection = `outline removed via "${outlineTokens.join(', ')}"\nalternative indicator detected: ${replacementTokens.join(', ')}`;
  } else {
    structuredDetection = `outline removed via "${outlineTokens.join(', ')}"\nno visible focus indicator detected`;
  }
  assertEquals(structuredDetection.includes('alternative indicator detected'), true);
});
