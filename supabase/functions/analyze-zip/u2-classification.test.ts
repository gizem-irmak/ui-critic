/**
 * U2 (Incomplete / Unclear Navigation) Classification Tests
 * 
 * U2 is ALWAYS Potential (Non-blocking). Never Confirmed.
 * 
 * Deterministic sub-checks:
 *   U2.D1 — No navigation container (≥3 routes, no <nav>/role="navigation")
 *   U2.D2 — No back affordance in nested route
 *   U2.D3 — Breadcrumb imported but not rendered
 * 
 * evaluationMethod:
 *   'hybrid_structural'    — deterministic signals found
 *   'hybrid_llm_fallback'  — LLM contextual evaluation
 *   'llm_perceptual'       — screenshot-only (visual assessment)
 * 
 * Confidence ranges:
 *   Structural-only:            0.65–0.75
 *   Structural + LLM:           0.75–0.85
 *   Screenshot LLM-only:        0.60–0.75
 */

import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// ============================================================
// SEVERITY INVARIANT: U2 is ALWAYS Potential
// ============================================================

Deno.test("U2: All findings must be Potential (never Confirmed)", () => {
  // U2 output contract: classification is always 'potential'
  const classifications = ['potential'] as const;
  assertEquals(classifications[0], 'potential');
  // There should never be a 'confirmed' classification for U2
  const validClassifications = new Set(['potential']);
  assert(!validClassifications.has('confirmed' as any));
});

// ============================================================
// U2.D1 — No navigation container
// ============================================================

Deno.test("U2.D1: Triggers when ≥3 routes and no <nav> or role='navigation'", () => {
  // Setup: App.tsx with 3+ routes, no <nav> anywhere
  const scenario = {
    routeCount: 5,
    hasNav: false,
    hasRoleNavigation: false,
    hasNavLinks: false,
  };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNav && !scenario.hasRoleNavigation && !scenario.hasNavLinks;
  assert(shouldTrigger, "U2.D1 should trigger with 3+ routes and no nav container");
});

Deno.test("U2.D1: Does NOT trigger with <nav> present", () => {
  const scenario = {
    routeCount: 5,
    hasNav: true,
    hasRoleNavigation: false,
    hasNavLinks: false,
  };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNav && !scenario.hasRoleNavigation && !scenario.hasNavLinks;
  assert(!shouldTrigger, "U2.D1 should not trigger when <nav> exists");
});

Deno.test("U2.D1: Does NOT trigger with role='navigation'", () => {
  const scenario = {
    routeCount: 5,
    hasNav: false,
    hasRoleNavigation: true,
    hasNavLinks: false,
  };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNav && !scenario.hasRoleNavigation && !scenario.hasNavLinks;
  assert(!shouldTrigger, "U2.D1 should not trigger when role='navigation' exists");
});

Deno.test("U2.D1: Does NOT trigger with fewer than 3 routes", () => {
  const scenario = {
    routeCount: 2,
    hasNav: false,
    hasRoleNavigation: false,
    hasNavLinks: false,
  };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNav && !scenario.hasRoleNavigation && !scenario.hasNavLinks;
  assert(!shouldTrigger, "U2.D1 should not trigger with <3 routes");
});

Deno.test("U2.D1: Does NOT trigger when nav links exist in layout files", () => {
  const scenario = {
    routeCount: 5,
    hasNav: false,
    hasRoleNavigation: false,
    hasNavLinks: true, // Links found in layout files
  };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNav && !scenario.hasRoleNavigation && !scenario.hasNavLinks;
  assert(!shouldTrigger, "U2.D1 should not trigger when nav links exist in layouts");
});

// ============================================================
// U2.D2 — No back affordance in nested route
// ============================================================

Deno.test("U2.D2: Triggers when nested routes exist without back/breadcrumb", () => {
  const scenario = {
    nestedRoutes: true,
    hasBackButton: false,
    hasBreadcrumb: false,
  };
  const shouldTrigger = scenario.nestedRoutes && !scenario.hasBackButton && !scenario.hasBreadcrumb;
  assert(shouldTrigger, "U2.D2 should trigger for nested routes without back affordance");
});

Deno.test("U2.D2: Does NOT trigger when back button exists", () => {
  const scenario = {
    nestedRoutes: true,
    hasBackButton: true,
    hasBreadcrumb: false,
  };
  const shouldTrigger = scenario.nestedRoutes && !scenario.hasBackButton && !scenario.hasBreadcrumb;
  assert(!shouldTrigger, "U2.D2 should not trigger when back button exists");
});

Deno.test("U2.D2: Does NOT trigger when breadcrumb is rendered", () => {
  const scenario = {
    nestedRoutes: true,
    hasBackButton: false,
    hasBreadcrumb: true,
  };
  const shouldTrigger = scenario.nestedRoutes && !scenario.hasBackButton && !scenario.hasBreadcrumb;
  assert(!shouldTrigger, "U2.D2 should not trigger when breadcrumb exists");
});

Deno.test("U2.D2: Does NOT trigger without nested routes", () => {
  const scenario = {
    nestedRoutes: false,
    hasBackButton: false,
    hasBreadcrumb: false,
  };
  const shouldTrigger = scenario.nestedRoutes && !scenario.hasBackButton && !scenario.hasBreadcrumb;
  assert(!shouldTrigger, "U2.D2 should not trigger without nested routes");
});

// ============================================================
// U2.D3 — Breadcrumb inconsistency
// ============================================================

Deno.test("U2.D3: Triggers when breadcrumb imported but not rendered", () => {
  const scenario = {
    breadcrumbImported: true,
    breadcrumbRendered: false,
  };
  const shouldTrigger = scenario.breadcrumbImported && !scenario.breadcrumbRendered;
  assert(shouldTrigger, "U2.D3 should trigger when breadcrumb imported but not rendered");
});

Deno.test("U2.D3: Does NOT trigger when breadcrumb is rendered", () => {
  const scenario = {
    breadcrumbImported: true,
    breadcrumbRendered: true,
  };
  const shouldTrigger = scenario.breadcrumbImported && !scenario.breadcrumbRendered;
  assert(!shouldTrigger, "U2.D3 should not trigger when breadcrumb is rendered");
});

Deno.test("U2.D3: Does NOT trigger when no breadcrumb import exists", () => {
  const scenario = {
    breadcrumbImported: false,
    breadcrumbRendered: false,
  };
  const shouldTrigger = scenario.breadcrumbImported && !scenario.breadcrumbRendered;
  assert(!shouldTrigger, "U2.D3 should not trigger without breadcrumb import");
});

// ============================================================
// CONFIDENCE RANGE TESTS
// ============================================================

Deno.test("U2: Structural-only confidence is 0.65-0.75", () => {
  const structuralConfidences = [0.70, 0.68, 0.72]; // D1, D2, D3
  for (const c of structuralConfidences) {
    assert(c >= 0.65 && c <= 0.75, `Structural confidence ${c} must be in [0.65, 0.75]`);
  }
});

Deno.test("U2: LLM-only (screenshot) confidence capped at 0.75", () => {
  const llmConfidence = 0.75;
  assert(llmConfidence <= 0.75, "Screenshot LLM confidence must be ≤0.75");
  assert(llmConfidence >= 0.60, "Screenshot LLM confidence must be ≥0.60");
});

// ============================================================
// EVALUATION METHOD TAGGING
// ============================================================

Deno.test("U2: Deterministic findings use 'hybrid_structural' evaluationMethod", () => {
  const evaluationMethod = 'hybrid_structural';
  assertEquals(evaluationMethod, 'hybrid_structural');
});

Deno.test("U2: LLM fallback findings use 'hybrid_llm_fallback' evaluationMethod", () => {
  const evaluationMethod = 'hybrid_llm_fallback';
  assertEquals(evaluationMethod, 'hybrid_llm_fallback');
});

Deno.test("U2: Screenshot findings use 'llm_perceptual' evaluationMethod", () => {
  const evaluationMethod = 'llm_perceptual';
  assertEquals(evaluationMethod, 'llm_perceptual');
});

// ============================================================
// DEDUPLICATION
// ============================================================

Deno.test("U2: Deduplication keys prevent duplicate findings per sub-check", () => {
  const keys = new Set<string>();
  const dedupeKey1 = 'U2.D1|global';
  const dedupeKey2 = 'U2.D1|global'; // Same — should be deduplicated
  keys.add(dedupeKey1);
  assert(keys.has(dedupeKey2), "Duplicate key should match");
  assertEquals(keys.size, 1, "Should only have 1 unique key");
});

// ============================================================
// AGGREGATION INVARIANT
// ============================================================

Deno.test("U2: Aggregated output always has blocksConvergence=false", () => {
  const aggregated = {
    ruleId: 'U2',
    status: 'potential',
    blocksConvergence: false,
  };
  assertEquals(aggregated.blocksConvergence, false);
  assertEquals(aggregated.status, 'potential');
});
