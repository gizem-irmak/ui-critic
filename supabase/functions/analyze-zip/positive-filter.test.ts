/**
 * Positive Finding Filter — Regression Tests
 *
 * Ensures the "issues only" guardrail correctly:
 * (a) Filters positive/praise findings (no card emitted)
 * (b) Filters aggregated cards with 0 elements
 * (c) Preserves real Potential findings
 */

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isPositiveFinding, filterPositiveFindings } from "../_shared/cross-rule-suppression.ts";

// ============================================================
// (a) Positive / praise findings → filtered → no card
// ============================================================

Deno.test("Positive filter: U2 'clear navigation' praise is filtered", () => {
  const v = {
    ruleId: 'U2',
    status: 'potential',
    diagnosis: 'The application provides clear navigation structure with good wayfinding cues.',
    evidence: 'Navigation bar well-implemented with active state indicators.',
  };
  assertEquals(isPositiveFinding(v), true);
});

Deno.test("Positive filter: 'no issue' / 'compliant' is filtered", () => {
  assertEquals(isPositiveFinding({
    ruleId: 'A4', status: 'potential',
    diagnosis: 'No issue found. Semantic structure is compliant.',
  }), true);
});

Deno.test("Positive filter: 'works correctly' is filtered", () => {
  assertEquals(isPositiveFinding({
    ruleId: 'U5', status: 'potential',
    diagnosis: 'Interaction feedback works correctly across all forms.',
  }), true);
});

Deno.test("Positive filter: status='pass' is filtered regardless of text", () => {
  assertEquals(isPositiveFinding({
    ruleId: 'A3', status: 'pass',
    diagnosis: 'Keyboard operability is adequate.',
  }), true);
});

Deno.test("Positive filter: 'well-structured' advisory is filtered", () => {
  assertEquals(isPositiveFinding({
    ruleId: 'U6', status: 'potential',
    diagnosis: 'Layout is well-structured and provides clear hierarchy.',
  }), true);
});

// ============================================================
// (b) Aggregated cards with 0 elements → filtered
// ============================================================

Deno.test("Positive filter: aggregated card with empty u2Elements is filtered", () => {
  const { kept } = filterPositiveFindings([{
    ruleId: 'U2', status: 'potential', isU2Aggregated: true, u2Elements: [],
    diagnosis: 'Navigation issues detected.',
  }]);
  assertEquals(kept.length, 0);
});

// ============================================================
// (c) Real Potential findings → preserved
// ============================================================

Deno.test("Positive filter: real U2 risk finding is preserved", () => {
  const v = {
    ruleId: 'U2', status: 'potential',
    diagnosis: 'Navigation is missing active state indicators; users cannot determine current location.',
    evidence: 'No active highlight in sidebar nav.',
  };
  assertEquals(isPositiveFinding(v), false);
});

Deno.test("Positive filter: real A1 confirmed finding is preserved", () => {
  const v = {
    ruleId: 'A1', status: 'confirmed',
    diagnosis: 'Insufficient contrast ratio of 2.1:1 on heading text.',
    evidence: 'color: #999 on background: #fff',
  };
  assertEquals(isPositiveFinding(v), false);
});

Deno.test("Positive filter: finding with both positive and negative language is preserved", () => {
  // Contains "clear" but also "missing" — this is a real finding with context
  const v = {
    ruleId: 'U2', status: 'potential',
    diagnosis: 'Navigation provides clear top-level links but is missing breadcrumbs for deep routes.',
  };
  assertEquals(isPositiveFinding(v), false);
});

Deno.test("Positive filter: filterPositiveFindings preserves real findings and removes praise", () => {
  const violations = [
    { ruleId: 'U2', status: 'potential', diagnosis: 'Clear navigation, well-implemented.' },
    { ruleId: 'A1', status: 'confirmed', diagnosis: 'Contrast ratio 2.1:1 is insufficient.' },
    { ruleId: 'U5', status: 'potential', isU5Aggregated: true, u5Elements: [{ elementLabel: 'btn' }], diagnosis: 'Missing loading indicator on submit.' },
  ];
  const { kept, filtered } = filterPositiveFindings(violations);
  assertEquals(kept.length, 2);
  assertEquals(filtered.length, 1);
  assertEquals(filtered[0].ruleId, 'U2');
});
