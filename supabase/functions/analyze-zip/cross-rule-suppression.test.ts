import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyCrossRuleSuppression } from "../_shared/cross-rule-suppression.ts";

// ─── Helper: build a minimal aggregated violation card ─────────────

function makeCard(ruleId: string, status: string, elements: any[]): any {
  const key = `${ruleId[0].toLowerCase()}${ruleId.slice(1)}Elements`;
  return {
    ruleId,
    ruleName: `Rule ${ruleId}`,
    category: ruleId[0] === 'A' ? 'accessibility' : ruleId[0] === 'E' ? 'ethics' : 'usability',
    status,
    [`is${ruleId}Aggregated`]: true,
    [key]: elements,
  };
}

function makeEl(label: string, location: string, opts: Record<string, any> = {}): any {
  return {
    elementLabel: label,
    location,
    deduplicationKey: opts.deduplicationKey || `${label}|${location}`,
    elementType: opts.elementType || 'unknown',
    detection: opts.detection || '',
    evidence: opts.evidence || '',
    explanation: opts.explanation || '',
    confidence: opts.confidence || 0.70,
    root_cause_tags: opts.root_cause_tags || [],
    ...opts,
  };
}

// ─── S1: A5 suppresses A6 on same form control ─────────────────────

Deno.test("S1: A5 suppresses A6 on same form control element", () => {
  const a5 = makeCard('A5', 'confirmed', [
    makeEl('Email input', 'src/Login.tsx', { elementType: 'input', subCheck: 'A5.1', root_cause_tags: ['missing_label'] }),
  ]);
  const a6 = makeCard('A6', 'confirmed', [
    makeEl('Email input', 'src/Login.tsx', { elementType: 'input', subCheck: 'A6.1' }),
  ]);

  const { kept, suppressedElements } = applyCrossRuleSuppression([a5, a6]);

  assert(kept.some(v => v.ruleId === 'A5'), 'A5 should be kept');
  assertEquals(suppressedElements.length, 1);
  assertEquals(suppressedElements[0].ruleId, 'A6');
  assertEquals(suppressedElements[0].meta.appliedRule, 'S1');
});

// ─── S2: A3 suppresses A2 on same element ───────────────────────────

Deno.test("S2: A3 suppresses A2 when element is not keyboard-reachable", () => {
  const a3 = makeCard('A3', 'confirmed', [
    makeEl('Menu trigger', 'src/Nav.tsx', { detection: 'onClick without role/tabIndex — not_focusable', root_cause_tags: ['keyboard_unreachable'] }),
  ]);
  const a2 = makeCard('A2', 'confirmed', [
    makeEl('Menu trigger', 'src/Nav.tsx', { detection: 'focus:outline-none without replacement' }),
  ]);

  const { kept, suppressedElements } = applyCrossRuleSuppression([a3, a2]);

  assert(kept.some(v => v.ruleId === 'A3'));
  assertEquals(suppressedElements.length, 1);
  assertEquals(suppressedElements[0].ruleId, 'A2');
  assertEquals(suppressedElements[0].meta.appliedRule, 'S2');
});

// ─── S6: U3 suppresses U6 on same element (truncation) ─────────────

Deno.test("S6: U3 suppresses U6 when root cause is overflow/truncation", () => {
  const u3 = makeCard('U3', 'potential', [
    makeEl('Product description', 'src/Card.tsx', {
      detection: 'line-clamp-2 truncation detected',
      root_cause_tags: ['overflow_truncation'],
    }),
  ]);
  const u6 = makeCard('U6', 'potential', [
    makeEl('Product description', 'src/Card.tsx', {
      detection: 'Weak grouping — content clipped',
    }),
  ]);

  const { kept, suppressedElements } = applyCrossRuleSuppression([u3, u6]);

  assert(kept.some(v => v.ruleId === 'U3'));
  assertEquals(suppressedElements.length, 1);
  assertEquals(suppressedElements[0].ruleId, 'U6');
  assertEquals(suppressedElements[0].meta.appliedRule, 'S6');
});

// ─── S5: U4 suppresses U1 ──────────────────────────────────────────

Deno.test("S5: U4 suppresses U1 when recall is needed for action", () => {
  const u4 = makeCard('U4', 'potential', [
    makeEl('Settings toggle', 'src/Settings.tsx', {
      detection: 'Hidden option requiring user to recall location',
      root_cause_tags: ['recall_needed_for_action'],
    }),
  ]);
  const u1 = makeCard('U1', 'potential', [
    makeEl('Settings toggle', 'src/Settings.tsx', {
      detection: 'Unclear primary action',
    }),
  ]);

  const { kept, suppressedElements } = applyCrossRuleSuppression([u4, u1]);

  assert(kept.some(v => v.ruleId === 'U4'));
  assertEquals(suppressedElements.length, 1);
  assertEquals(suppressedElements[0].ruleId, 'U1');
  assertEquals(suppressedElements[0].meta.appliedRule, 'S5');
});

// ─── S7: E2 suppresses U1 ──────────────────────────────────────────

Deno.test("S7: E2 suppresses U1 in same decision point", () => {
  const e2 = makeCard('E2', 'potential', [
    makeEl('Upgrade dialog', 'src/Upgrade.tsx', {
      detection: 'Visual imbalance: primary emphasized, secondary de-emphasized',
    }),
  ]);
  const u1 = makeCard('U1', 'potential', [
    makeEl('Upgrade dialog', 'src/Upgrade.tsx', {
      detection: 'Unclear primary action hierarchy',
    }),
  ]);

  const { kept, suppressedElements } = applyCrossRuleSuppression([e2, u1]);

  assert(kept.some(v => v.ruleId === 'E2'));
  assertEquals(suppressedElements.length, 1);
  assertEquals(suppressedElements[0].ruleId, 'U1');
  assertEquals(suppressedElements[0].meta.appliedRule, 'S7');
});

// ─── S10: E2 vs E3 (visual hiding → E2 wins) ───────────────────────

Deno.test("S10: E2 suppresses E3 when E3 is merely visual hiding", () => {
  const e2 = makeCard('E2', 'potential', [
    makeEl('Cookie consent', 'src/CookieBanner.tsx', {
      detection: 'Choice imbalance: accept emphasized, decline obscured',
    }),
  ]);
  const e3 = makeCard('E3', 'potential', [
    makeEl('Cookie consent', 'src/CookieBanner.tsx', {
      detection: 'Decline option visually hidden behind link',
    }),
  ]);

  const { kept, suppressedElements } = applyCrossRuleSuppression([e2, e3]);

  assert(kept.some(v => v.ruleId === 'E2'));
  assertEquals(suppressedElements.length, 1);
  assertEquals(suppressedElements[0].ruleId, 'E3');
  assertEquals(suppressedElements[0].meta.appliedRule, 'S10');
});

// ─── S10-rev: E3 keeps when functional restriction ─────────────────

Deno.test("S10-rev: E3 suppresses E2 when E3 is functional restriction (missing exit)", () => {
  const e2 = makeCard('E2', 'potential', [
    makeEl('Delete dialog', 'src/DeleteModal.tsx', {
      detection: 'Imbalance: delete emphasized',
    }),
  ]);
  const e3 = makeCard('E3', 'potential', [
    makeEl('Delete dialog', 'src/DeleteModal.tsx', {
      detection: 'Structural absence — no cancel, missing exit control',
    }),
  ]);

  const { kept, suppressedElements } = applyCrossRuleSuppression([e2, e3]);

  assert(kept.some(v => v.ruleId === 'E3'));
  assertEquals(suppressedElements.length, 1);
  assertEquals(suppressedElements[0].ruleId, 'E2');
  assertEquals(suppressedElements[0].meta.appliedRule, 'S10-rev');
});

// ─── Fallback: A* > E* > U* global priority ────────────────────────

Deno.test("Fallback: Accessibility (A4) suppresses Usability (U6) on same element when no pairwise rule matches", () => {
  const a4 = makeCard('A4', 'confirmed', [
    makeEl('Sidebar nav', 'src/Layout.tsx', {
      subCheck: 'A4.3', detection: 'Missing landmark region',
      elementType: 'div',
    }),
  ]);
  const u6 = makeCard('U6', 'potential', [
    makeEl('Sidebar nav', 'src/Layout.tsx', {
      detection: 'Weak grouping in sidebar',
    }),
  ]);

  const { kept, suppressedElements } = applyCrossRuleSuppression([a4, u6]);

  assert(kept.some(v => v.ruleId === 'A4'));
  assertEquals(suppressedElements.length, 1);
  assertEquals(suppressedElements[0].ruleId, 'U6');
  assertEquals(suppressedElements[0].meta.appliedRule, 'fallback');
});

// ─── No suppression when elements differ ────────────────────────────

Deno.test("No suppression: different elements are NOT suppressed", () => {
  const a5 = makeCard('A5', 'confirmed', [
    makeEl('Email input', 'src/Login.tsx', { elementType: 'input' }),
  ]);
  const a6 = makeCard('A6', 'confirmed', [
    makeEl('Submit button', 'src/Login.tsx', { elementType: 'button' }),
  ]);

  const { kept, suppressedElements } = applyCrossRuleSuppression([a5, a6]);

  assertEquals(kept.length, 2, 'Both cards should be kept');
  assertEquals(suppressedElements.length, 0, 'No suppression across different elements');
});
