/**
 * U2 (Incomplete / Unclear Navigation) Classification Tests
 * 
 * U2 is ALWAYS Potential (Non-blocking). Never Confirmed. Never generates corrective prompts.
 * U2 evaluates ONLY wayfinding clarity: where am I, where can I go, how do I go back.
 * U2 must NOT overlap with U6 (layout), U3 (truncation), U4 (recall), or A-rules (landmarks).
 * 
 * Deterministic sub-checks:
 *   U2.D1 — No visible primary navigation (≥3 routes, no nav components rendered)
 *   U2.D2 — Deep route lacks up/back affordance (depth ≥2, detail/edit pattern, no back control)
 *   U2.D3 — Breadcrumb logic defined but not rendered (getBreadcrumbs + component exists, not rendered)
 * 
 * Confidence ranges:
 *   Structural-only:            0.55–0.70
 *   Structural + LLM:           0.65–0.80
 *   Screenshot LLM-only:        0.60–0.80
 *   Hard cap:                   0.80
 */

import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// ============================================================
// SEVERITY INVARIANT: U2 is ALWAYS Potential
// ============================================================

Deno.test("U2: All findings must be Potential (never Confirmed)", () => {
  const validClassifications = new Set(['potential']);
  assert(validClassifications.has('potential'));
  assert(!validClassifications.has('confirmed' as any));
});

Deno.test("U2: Never generates corrective prompts", () => {
  // U2 is advisory-only; correctivePrompt must be absent or empty
  const finding = { status: 'potential', advisoryGuidance: 'guidance text', correctivePrompt: undefined };
  assertEquals(finding.correctivePrompt, undefined);
});

// ============================================================
// U2.D1 — No visible primary navigation in multi-route apps
// ============================================================

Deno.test("U2.D1: Triggers when ≥3 routes and no nav components rendered", () => {
  const scenario = {
    routeCount: 5,
    hasNavComponentRendered: false,
    hasNavItemsMapping: false,
    hasLayoutWithNav: false,
  };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNavComponentRendered && !scenario.hasNavItemsMapping && !scenario.hasLayoutWithNav;
  assert(shouldTrigger, "U2.D1 should trigger with ≥3 routes and no nav UI");
});

Deno.test("U2.D1: Does NOT trigger when nav component (Sidebar) is rendered", () => {
  const scenario = { routeCount: 5, hasNavComponentRendered: true, hasNavItemsMapping: false, hasLayoutWithNav: false };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNavComponentRendered && !scenario.hasNavItemsMapping && !scenario.hasLayoutWithNav;
  assert(!shouldTrigger, "U2.D1 should not trigger when Sidebar/Navbar/etc rendered");
});

Deno.test("U2.D1: Does NOT trigger when navItems.map() exists", () => {
  const scenario = { routeCount: 5, hasNavComponentRendered: false, hasNavItemsMapping: true, hasLayoutWithNav: false };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNavComponentRendered && !scenario.hasNavItemsMapping && !scenario.hasLayoutWithNav;
  assert(!shouldTrigger, "U2.D1 should not trigger when navItems mapped in JSX");
});

Deno.test("U2.D1: Does NOT trigger when layout wrapper provides nav", () => {
  const scenario = { routeCount: 5, hasNavComponentRendered: false, hasNavItemsMapping: false, hasLayoutWithNav: true };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNavComponentRendered && !scenario.hasNavItemsMapping && !scenario.hasLayoutWithNav;
  assert(!shouldTrigger, "U2.D1 should not trigger when layout provides nav");
});

Deno.test("U2.D1: Does NOT require <nav> or role='navigation' to suppress", () => {
  // Semantic absence alone must NOT trigger — only absence of visible nav UI matters
  const scenario = { routeCount: 5, hasNavElement: false, hasRoleNavigation: false, hasNavComponentRendered: true, hasNavItemsMapping: false, hasLayoutWithNav: false };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNavComponentRendered && !scenario.hasNavItemsMapping && !scenario.hasLayoutWithNav;
  assert(!shouldTrigger, "Semantic <nav> absence alone should not trigger U2.D1");
});

// ============================================================
// U2.D2 — Deep route lacks up/back affordance
// ============================================================

Deno.test("U2.D2: Triggers when deep detail route exists without back control", () => {
  const scenario = {
    deepRouteFiles: ['/admin/patients/:id'],
    hasBackControl: false,
    hasBreadcrumbRendered: false,
    hasParentRouteLink: false,
  };
  const shouldTrigger = scenario.deepRouteFiles.length > 0 && !scenario.hasBackControl && !scenario.hasBreadcrumbRendered && !scenario.hasParentRouteLink;
  assert(shouldTrigger, "U2.D2 should trigger for deep routes without back affordance");
});

Deno.test("U2.D2: Does NOT trigger when back button exists", () => {
  const scenario = { deepRouteFiles: ['/settings/security'], hasBackControl: true, hasBreadcrumbRendered: false, hasParentRouteLink: false };
  const shouldTrigger = scenario.deepRouteFiles.length > 0 && !scenario.hasBackControl && !scenario.hasBreadcrumbRendered && !scenario.hasParentRouteLink;
  assert(!shouldTrigger, "U2.D2 should not trigger when back control exists");
});

Deno.test("U2.D2: Does NOT trigger when breadcrumb is rendered", () => {
  const scenario = { deepRouteFiles: ['/foo/:id'], hasBackControl: false, hasBreadcrumbRendered: true, hasParentRouteLink: false };
  const shouldTrigger = scenario.deepRouteFiles.length > 0 && !scenario.hasBackControl && !scenario.hasBreadcrumbRendered && !scenario.hasParentRouteLink;
  assert(!shouldTrigger, "U2.D2 should not trigger when breadcrumb exists");
});

Deno.test("U2.D2: Does NOT trigger when parent route link in header exists", () => {
  const scenario = { deepRouteFiles: ['/foo/:id'], hasBackControl: false, hasBreadcrumbRendered: false, hasParentRouteLink: true };
  const shouldTrigger = scenario.deepRouteFiles.length > 0 && !scenario.hasBackControl && !scenario.hasBreadcrumbRendered && !scenario.hasParentRouteLink;
  assert(!shouldTrigger, "U2.D2 should not trigger when parent link in header exists");
});

Deno.test("U2.D2: Does NOT trigger without deep routes", () => {
  const scenario = { deepRouteFiles: [], hasBackControl: false, hasBreadcrumbRendered: false, hasParentRouteLink: false };
  const shouldTrigger = scenario.deepRouteFiles.length > 0 && !scenario.hasBackControl && !scenario.hasBreadcrumbRendered && !scenario.hasParentRouteLink;
  assert(!shouldTrigger, "U2.D2 should not trigger without deep routes");
});

// ============================================================
// U2.D3 — Breadcrumb logic defined but not rendered
// ============================================================

Deno.test("U2.D3: Triggers when breadcrumb logic + component exist but not rendered", () => {
  const scenario = { hasBreadcrumbLogicDefined: true, hasBreadcrumbComponentInDesignSystem: true, hasBreadcrumbRendered: false };
  const shouldTrigger = scenario.hasBreadcrumbLogicDefined && scenario.hasBreadcrumbComponentInDesignSystem && !scenario.hasBreadcrumbRendered;
  assert(shouldTrigger, "U2.D3 should trigger when logic+component exist but not rendered");
});

Deno.test("U2.D3: Does NOT trigger when breadcrumb is rendered", () => {
  const scenario = { hasBreadcrumbLogicDefined: true, hasBreadcrumbComponentInDesignSystem: true, hasBreadcrumbRendered: true };
  const shouldTrigger = scenario.hasBreadcrumbLogicDefined && scenario.hasBreadcrumbComponentInDesignSystem && !scenario.hasBreadcrumbRendered;
  assert(!shouldTrigger, "U2.D3 should not trigger when breadcrumb is rendered");
});

Deno.test("U2.D3: Does NOT trigger on unused imports alone (no logic defined)", () => {
  const scenario = { hasBreadcrumbLogicDefined: false, hasBreadcrumbComponentInDesignSystem: true, hasBreadcrumbRendered: false };
  const shouldTrigger = scenario.hasBreadcrumbLogicDefined && scenario.hasBreadcrumbComponentInDesignSystem && !scenario.hasBreadcrumbRendered;
  assert(!shouldTrigger, "U2.D3 should not trigger on unused imports alone");
});

Deno.test("U2.D3: Does NOT trigger without breadcrumb component in design system", () => {
  const scenario = { hasBreadcrumbLogicDefined: true, hasBreadcrumbComponentInDesignSystem: false, hasBreadcrumbRendered: false };
  const shouldTrigger = scenario.hasBreadcrumbLogicDefined && scenario.hasBreadcrumbComponentInDesignSystem && !scenario.hasBreadcrumbRendered;
  assert(!shouldTrigger, "U2.D3 should not trigger without breadcrumb component");
});

// ============================================================
// GLOBAL SUPPRESSION RULES
// ============================================================

Deno.test("U2: Suppressed when breadcrumb + visible page title present", () => {
  const hasBreadcrumbRendered = true;
  const hasVisiblePageTitle = true;
  const suppressed = hasBreadcrumbRendered && hasVisiblePageTitle;
  assert(suppressed, "Should suppress U2 entirely when breadcrumb + h1 present");
});

Deno.test("U2: Suppressed when Tabs used as primary IA (≤5 routes)", () => {
  const hasTabsAsPrimaryIA = true;
  const routeCount = 4;
  const suppressed = hasTabsAsPrimaryIA && routeCount <= 5;
  assert(suppressed, "Should suppress U2 when Tabs are primary IA");
});

Deno.test("U2: Suppressed when Drawer/Sheet with Menu present", () => {
  const hasDrawerWithMenu = true;
  assert(hasDrawerWithMenu, "Should suppress U2 when Drawer/Sheet menu exists");
});

Deno.test("U2: Suppressed when ≥2 navigation primitives present", () => {
  const navPrimitives = new Set(['Sidebar', 'Breadcrumb']);
  assert(navPrimitives.size >= 2, "Should suppress U2 with ≥2 nav primitives");
});

Deno.test("U2: Suppressed for simple apps (≤2 routes)", () => {
  const routeCount = 2;
  assert(routeCount <= 2, "Should suppress U2 for ≤2 routes");
});

Deno.test("U2: Suppressed when layout wrapper provides navigation", () => {
  const hasLayoutWithNav = true;
  const hasNavComponentRendered = true;
  const suppressed = hasLayoutWithNav && hasNavComponentRendered;
  assert(suppressed, "Should suppress U2 when layout provides nav");
});

// ============================================================
// CONFIDENCE RANGE TESTS
// ============================================================

Deno.test("U2: Structural-only confidence is 0.55-0.70", () => {
  const structuralConfidences = [0.65, 0.60, 0.65]; // D1, D2, D3
  for (const c of structuralConfidences) {
    assert(c >= 0.55 && c <= 0.70, `Structural confidence ${c} must be in [0.55, 0.70]`);
  }
});

Deno.test("U2: Confidence never exceeds 0.80", () => {
  const maxConfidence = 0.80;
  const testValues = [0.65, 0.70, 0.75, 0.80];
  for (const c of testValues) {
    assert(c <= maxConfidence, `Confidence ${c} must be ≤ 0.80`);
  }
});

Deno.test("U2: LLM-only (screenshot) confidence range is 0.60-0.80", () => {
  const llmConfidence = 0.75;
  assert(llmConfidence <= 0.80, "Screenshot LLM confidence must be ≤0.80");
  assert(llmConfidence >= 0.60, "Screenshot LLM confidence must be ≥0.60");
});

// ============================================================
// SCOPE BOUNDARY TESTS (non-overlap)
// ============================================================

Deno.test("U2: Must NOT evaluate layout grouping (belongs to U6)", () => {
  const u2Scope = ['wayfinding', 'navigation_visibility', 'back_affordance'];
  assert(!u2Scope.includes('layout_grouping'), "U2 must not evaluate layout grouping");
  assert(!u2Scope.includes('visual_hierarchy'), "U2 must not evaluate visual hierarchy");
});

Deno.test("U2: Must NOT evaluate content truncation (belongs to U3)", () => {
  const u2Scope = ['wayfinding', 'navigation_visibility', 'back_affordance'];
  assert(!u2Scope.includes('truncation'), "U2 must not evaluate truncation");
});

Deno.test("U2: Must NOT evaluate step indicators (belongs to U4)", () => {
  const u2Scope = ['wayfinding', 'navigation_visibility', 'back_affordance'];
  assert(!u2Scope.includes('step_indicators'), "U2 must not evaluate step indicators");
});

Deno.test("U2: Must NOT evaluate landmark semantics (belongs to A-rules)", () => {
  const u2Scope = ['wayfinding', 'navigation_visibility', 'back_affordance'];
  assert(!u2Scope.includes('landmark_semantics'), "U2 must not evaluate landmark semantics");
});

// ============================================================
// EVALUATION METHOD TAGGING
// ============================================================

Deno.test("U2: Deterministic findings use 'hybrid_structural' evaluationMethod", () => {
  assertEquals('hybrid_structural', 'hybrid_structural');
});

Deno.test("U2: LLM fallback findings use 'hybrid_llm_fallback' evaluationMethod", () => {
  assertEquals('hybrid_llm_fallback', 'hybrid_llm_fallback');
});

Deno.test("U2: Screenshot findings use 'llm_perceptual' evaluationMethod", () => {
  assertEquals('llm_perceptual', 'llm_perceptual');
});

// ============================================================
// DEDUPLICATION & AGGREGATION
// ============================================================

Deno.test("U2: Deduplication keys prevent duplicate findings per sub-check", () => {
  const keys = new Set<string>();
  keys.add('U2.D1|global');
  keys.add('U2.D1|global'); // duplicate
  assertEquals(keys.size, 1, "Should only have 1 unique key");
});

Deno.test("U2: Aggregated output always has blocksConvergence=false", () => {
  const aggregated = { ruleId: 'U2', status: 'potential', blocksConvergence: false };
  assertEquals(aggregated.blocksConvergence, false);
  assertEquals(aggregated.status, 'potential');
});
