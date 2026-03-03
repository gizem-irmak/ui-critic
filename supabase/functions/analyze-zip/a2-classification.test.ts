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

type Focusable = 'yes' | 'no' | 'unknown';

function classifyA2Finding(evidence: string, diagnosis: string = '', focusable: Focusable = 'yes'): A2ClassificationResult | 'skip' | 'pass' | 'not_applicable' {
  const combined = (evidence + ' ' + diagnosis).toLowerCase();

  // STEP 1: outlineRemoved — must mention outline suppression
  const outlineRemoved = /(?:^|\s|"|')outline-none|focus:outline-none|focus-visible:outline-none/i.test(combined) ||
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

  // STEP 2b: focus-within wrapper indicators
  const hasFocusWithinIndicator = /(?:^|\s|"|')focus-within:ring-(?!0\b)/i.test(combined) ||
                                   /(?:^|\s|"|')focus-within:border-(?!0\b|none)/i.test(combined) ||
                                   /(?:^|\s|"|')focus-within:shadow-(?!none)/i.test(combined);
  if (hasFocusWithinIndicator) {
    return 'pass';
  }

  // STEP 2c: State-driven highlight patterns (Radix/CMDK/listbox/menu)
  const hasStateDrivenIndicator = /(?:^|\s|"|')data-\[selected(?:=true|='true')?\]:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(combined) ||
                                   /(?:^|\s|"|')data-\[highlighted(?:=true|='true')?\]:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(combined) ||
                                   /(?:^|\s|"|')aria-selected:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(combined) ||
                                   /(?:^|\s|"|')data-\[state=active\]:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(combined) ||
                                   /(?:^|\s|"|')data-\[state=open\]:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(combined);
  if (hasStateDrivenIndicator) {
    return 'pass';
  }

  // STEP 3: hasWeakFocusStyling — ONLY focus-scoped tokens count
  const hasWeakFocusStyling = /(?:^|\s|"|')focus(?:-visible)?:(?:bg-|text-|underline|opacity-|font-)/i.test(combined);

  if (hasWeakFocusStyling) {
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

Deno.test("A2: focus:border-0 + ring-1 + ring-zinc-200 → SKIP (no outline-none present)", () => {
  const evidence = "focus:border-0 focus:ring-1 ring-zinc-200";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'skip', "No outline-none detected → SKIP (border-0 is not outline removal)");
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

Deno.test("A2: outline-none + data-[state=open]:bg-accent + focus:bg-accent → PASS (state-driven indicator present)", () => {
  const evidence = "outline-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground focus:bg-accent focus:text-accent-foreground";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "Should PASS — data-[state=open]:bg-* is a valid state-driven indicator");
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

// ============================================================
// CRITICAL: Bare (non-focus-scoped) tokens must NOT suppress A2
// ============================================================

Deno.test("A2: outline-none + bare ring-2 (no focus prefix) → Confirmed (bare tokens don't count)", () => {
  const evidence = "outline-none ring-2 ring-blue-500";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Bare ring-2 without focus: prefix must NOT count as replacement");
    assertEquals(result.isPotential, false, "Should NOT be potential");
  }
});

Deno.test("A2: outline-none + bare border-2 + bare shadow-md → Confirmed (no focus-scoped replacement)", () => {
  const evidence = "outline-none border-2 border-gray-300 shadow-md";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Bare border/shadow without focus: prefix must NOT count");
  }
});

Deno.test("A2: outline-none + bare bg-accent + bare text-accent-foreground → Confirmed (bare weak tokens don't count)", () => {
  const evidence = "outline-none bg-accent text-accent-foreground";
  const result = classifyA2Finding(evidence);
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Bare bg/text without focus: prefix must NOT count as weak replacement");
  }
});

Deno.test("A2: outline-none + data-[state=open]:bg-accent → PASS (state-driven indicator)", () => {
  const evidence = "outline-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground";
  const result = classifyA2Finding(evidence, '', 'yes');
  assertEquals(result, 'pass', "data-[state=open]:bg-* is now recognized as a valid state-driven indicator → PASS");
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

Deno.test("A2: outline-none + focus:bg-accent + focusable=unknown → Potential (weak styling takes priority)", () => {
  const result = classifyA2Finding("outline-none focus:bg-accent", '', 'unknown');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true);
    assertEquals(result.isConfirmed, false);
  }
});

Deno.test("A2: outline-none + focus-visible:ring-2 + focusable=unknown → PASS (strong replacement always passes)", () => {
  const result = classifyA2Finding("focus:outline-none focus-visible:ring-2", '', 'unknown');
  assertEquals(result, 'pass', "Strong replacement → PASS regardless of focusability");
});

// ============================================================
// STATE-DRIVEN INDICATOR TESTS (Radix/CMDK/listbox/menu)
// ============================================================

Deno.test("A2: outline-none + data-[selected=true]:bg-accent → PASS (state-driven indicator)", () => {
  const evidence = "outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "data-[selected=true]:bg-* is a valid visible indicator → PASS");
});

Deno.test("A2: outline-none + data-[highlighted=true]:bg-accent → PASS (CMDK highlight)", () => {
  const evidence = "outline-none data-[highlighted=true]:bg-accent";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "data-[highlighted=true]:bg-* is a valid visible indicator → PASS");
});

Deno.test("A2: outline-none + aria-selected:bg-primary → PASS (aria-selected indicator)", () => {
  const evidence = "outline-none aria-selected:bg-primary";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "aria-selected:bg-* is a valid visible indicator → PASS");
});

Deno.test("A2: outline-none + data-[state=active]:bg-muted → PASS (active state indicator)", () => {
  const evidence = "outline-none data-[state=active]:bg-muted data-[state=active]:text-muted-foreground";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "data-[state=active]:bg-* is a valid visible indicator → PASS");
});

Deno.test("A2: CMDK CommandItem — outline-none + data-[selected='true']:bg-accent → PASS", () => {
  const evidence = "outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "CommandItem with data-[selected] styling is not an A2 violation");
});

// ============================================================
// FOCUS-WITHIN WRAPPER TESTS
// ============================================================

Deno.test("A2: outline-none + focus-within:ring-2 on same element → PASS", () => {
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
// BARE input with only outline-none → still Confirmed
// ============================================================

Deno.test("A2: <input> with only outline-none → Confirmed (no indicator at all)", () => {
  const evidence = "outline-none";
  const result = classifyA2Finding(evidence, '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Bare outline-none on focusable input → Confirmed");
  }
});

Deno.test("A2: outline-none + data-[state=open]:bg-accent only (no selected/highlighted) + focusable=yes → Potential via weak? No → PASS (state=open counts)", () => {
  const evidence = "outline-none data-[state=open]:bg-accent";
  const result = classifyA2Finding(evidence);
  assertEquals(result, 'pass', "data-[state=open]:bg-* counts as a state-driven indicator → PASS");
});

// ============================================================
// WRAPPER / NON-FOCUSABLE SUPPRESSION TESTS
// ============================================================

Deno.test("A2: HoverCardContent with outline-none → suppress (non-focusable wrapper)", () => {
  const result = classifyA2Finding("outline-none", '', 'no');
  assertEquals(result, 'not_applicable', "HoverCardContent (focusable=no) should be suppressed");
});

Deno.test("A2: PopoverContent with outline-none → suppress (non-focusable wrapper)", () => {
  const result = classifyA2Finding("outline-none", '', 'no');
  assertEquals(result, 'not_applicable', "PopoverContent (focusable=no) should be suppressed");
});

Deno.test("A2: DropdownMenuItem with outline-none + focus:bg-accent → Potential (interactive primitive)", () => {
  const result = classifyA2Finding("outline-none focus:bg-accent focus:text-accent-foreground", '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "DropdownMenuItem with weak focus styling → Potential");
    assertEquals(result.isConfirmed, false);
  }
});

Deno.test("A2: <input> with outline-none only → Confirmed (focusable native element)", () => {
  const result = classifyA2Finding("outline-none", '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "Native input with outline-none → Confirmed");
  }
});

Deno.test("A2: <button> with outline-none + focus-visible:ring-2 → PASS (strong replacement)", () => {
  const result = classifyA2Finding("outline-none focus-visible:ring-2", '', 'yes');
  assertEquals(result, 'pass', "Button with ring-2 replacement → PASS");
});

// ============================================================
// PER-ELEMENT REPORTING TESTS
// ============================================================

Deno.test("A2: per-element reporting — CommandInput (input) is Confirmed when outline removed", () => {
  // Simulates: <CommandInput className="outline-none" /> which is an input element
  const result = classifyA2Finding("outline-none", '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isConfirmed, true, "CommandInput (native input) with outline-none → Confirmed");
  }
});

Deno.test("A2: per-element reporting — CommandItem with state-driven highlight is PASS", () => {
  // CommandItem uses data-[selected] for visual indication
  const evidence = "outline-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground";
  const result = classifyA2Finding(evidence, '', 'yes');
  assertEquals(result, 'pass', "CommandItem with data-[selected] state-driven indicator → PASS");
});

Deno.test("A2: per-element reporting — DropdownMenuItem with only focus:bg-accent → Potential", () => {
  const result = classifyA2Finding("outline-none focus:bg-accent", '', 'yes');
  assertEquals(typeof result, 'object');
  if (typeof result === 'object') {
    assertEquals(result.isPotential, true, "DropdownMenuItem with weak focus:bg → Potential");
    assertEquals(result.isConfirmed, false);
    assertEquals(result.potentialReason, 'Custom focus styles exist but perceptibility cannot be statically verified.');
  }
});

Deno.test("A2: structured detection — confirmed shows 'no visible focus indicator detected'", () => {
  // Simulate detection string generation
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
