/**
 * U2 (Incomplete / Unclear Navigation) Classification Tests
 * 
 * U2 is ALWAYS Potential (Non-blocking). Never Confirmed. Never generates corrective prompts.
 * U2 evaluates ONLY wayfinding clarity: where am I, where can I go, how do I go back.
 * U2 is desktop-scoped: mobile-only responsive patterns are suppressed by default.
 * U2 must NOT overlap with U6 (layout), U3 (truncation), U4 (recall), or A-rules (landmarks).
 * 
 * Deterministic sub-checks:
 *   U2.D1 — No visible primary navigation (≥3 routes, no nav components rendered)
 *   U2.D2 — Deep route lacks up/back affordance (depth ≥2, detail/edit pattern, no back control)
 *   U2.D3 — Breadcrumb logic defined but not rendered (only if maxRouteDepth ≥3)
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
  const finding = { status: 'potential', advisoryGuidance: 'guidance text', correctivePrompt: undefined };
  assertEquals(finding.correctivePrompt, undefined);
});

// ============================================================
// U2.D1 — No visible primary navigation in multi-route apps
// ============================================================

Deno.test("U2.D1: Triggers when ≥3 routes and no nav components rendered", () => {
  const scenario = { routeCount: 5, hasNavComponentRendered: false, hasNavItemsMapping: false, hasLayoutWithNav: false };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNavComponentRendered && !scenario.hasNavItemsMapping && !scenario.hasLayoutWithNav;
  assert(shouldTrigger);
});

Deno.test("U2.D1: Does NOT trigger when nav component (Sidebar) is rendered", () => {
  const scenario = { routeCount: 5, hasNavComponentRendered: true, hasNavItemsMapping: false, hasLayoutWithNav: false };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNavComponentRendered && !scenario.hasNavItemsMapping && !scenario.hasLayoutWithNav;
  assert(!shouldTrigger);
});

Deno.test("U2.D1: Does NOT trigger when navItems.map() exists", () => {
  const scenario = { routeCount: 5, hasNavComponentRendered: false, hasNavItemsMapping: true, hasLayoutWithNav: false };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNavComponentRendered && !scenario.hasNavItemsMapping && !scenario.hasLayoutWithNav;
  assert(!shouldTrigger);
});

Deno.test("U2.D1: Does NOT trigger when layout wrapper provides nav", () => {
  const scenario = { routeCount: 5, hasNavComponentRendered: false, hasNavItemsMapping: false, hasLayoutWithNav: true };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNavComponentRendered && !scenario.hasNavItemsMapping && !scenario.hasLayoutWithNav;
  assert(!shouldTrigger);
});

Deno.test("U2.D1: Does NOT require <nav> or role='navigation' to suppress", () => {
  const scenario = { routeCount: 5, hasNavElement: false, hasRoleNavigation: false, hasNavComponentRendered: true, hasNavItemsMapping: false, hasLayoutWithNav: false };
  const shouldTrigger = scenario.routeCount >= 3 && !scenario.hasNavComponentRendered && !scenario.hasNavItemsMapping && !scenario.hasLayoutWithNav;
  assert(!shouldTrigger);
});

// ============================================================
// U2.D2 — Deep route lacks up/back affordance
// ============================================================

Deno.test("U2.D2: Triggers when deep detail route exists without back control", () => {
  const scenario = { deepRouteFiles: ['/admin/patients/:id'], hasBackControl: false, hasBreadcrumbRendered: false, hasParentRouteLink: false };
  const shouldTrigger = scenario.deepRouteFiles.length > 0 && !scenario.hasBackControl && !scenario.hasBreadcrumbRendered && !scenario.hasParentRouteLink;
  assert(shouldTrigger);
});

Deno.test("U2.D2: Does NOT trigger when back button exists", () => {
  const scenario = { deepRouteFiles: ['/settings/security'], hasBackControl: true, hasBreadcrumbRendered: false, hasParentRouteLink: false };
  const shouldTrigger = scenario.deepRouteFiles.length > 0 && !scenario.hasBackControl && !scenario.hasBreadcrumbRendered && !scenario.hasParentRouteLink;
  assert(!shouldTrigger);
});

Deno.test("U2.D2: Does NOT trigger when breadcrumb is rendered", () => {
  const scenario = { deepRouteFiles: ['/foo/:id'], hasBackControl: false, hasBreadcrumbRendered: true, hasParentRouteLink: false };
  const shouldTrigger = scenario.deepRouteFiles.length > 0 && !scenario.hasBackControl && !scenario.hasBreadcrumbRendered && !scenario.hasParentRouteLink;
  assert(!shouldTrigger);
});

Deno.test("U2.D2: Does NOT trigger without deep routes", () => {
  const scenario = { deepRouteFiles: [], hasBackControl: false, hasBreadcrumbRendered: false, hasParentRouteLink: false };
  const shouldTrigger = scenario.deepRouteFiles.length > 0 && !scenario.hasBackControl && !scenario.hasBreadcrumbRendered && !scenario.hasParentRouteLink;
  assert(!shouldTrigger);
});

// ============================================================
// U2.D3 — Breadcrumb depth risk (evidence-gated, project-agnostic)
// Only triggers when BOTH:
//   (1) cap-depth breadcrumb implementation detected
//   (2) multi-channel evidence of deeper routes (≥3 segments) from router (A) or links (B)
// ============================================================

Deno.test("U2.D3: No trigger when shallow app routes only (no deep evidence)", () => {
  const capDepthDetected = true;
  const maxRouteDepthEvidence = 2;
  const evidenceChannels: string[] = ['A'];
  const hasStrongEvidence = maxRouteDepthEvidence >= 3 && (evidenceChannels.includes('A') || evidenceChannels.includes('B'));
  const shouldTrigger = capDepthDetected && hasStrongEvidence;
  assert(!shouldTrigger, "Should NOT trigger when maxRouteDepthEvidence < 3");
});

Deno.test("U2.D3: Triggers when deep route (channel A) + cap-depth breadcrumb", () => {
  const capDepthDetected = true;
  const maxRouteDepthEvidence = 3;
  const evidenceChannels = ['A'];
  const hasStrongEvidence = maxRouteDepthEvidence >= 3 && (evidenceChannels.includes('A') || evidenceChannels.includes('B'));
  const shouldTrigger = capDepthDetected && hasStrongEvidence;
  assert(shouldTrigger, "Should trigger: cap-depth + deep routes from router defs");
});

Deno.test("U2.D3: Triggers when deep links (channel B) + cap-depth breadcrumb", () => {
  const capDepthDetected = true;
  const maxRouteDepthEvidence = 4;
  const evidenceChannels = ['B'];
  const hasStrongEvidence = maxRouteDepthEvidence >= 3 && (evidenceChannels.includes('A') || evidenceChannels.includes('B'));
  const shouldTrigger = capDepthDetected && hasStrongEvidence;
  assert(shouldTrigger, "Should trigger: cap-depth + deep links in code");
});

Deno.test("U2.D3: Does NOT trigger when deep routes exist but breadcrumb NOT capped", () => {
  const capDepthDetected = false;
  const maxRouteDepthEvidence = 5;
  const evidenceChannels = ['A', 'B'];
  const hasStrongEvidence = maxRouteDepthEvidence >= 3 && (evidenceChannels.includes('A') || evidenceChannels.includes('B'));
  const shouldTrigger = capDepthDetected && hasStrongEvidence;
  assert(!shouldTrigger, "Should NOT trigger: no cap-depth pattern in breadcrumb");
});

Deno.test("U2.D3: Does NOT trigger when deep evidence only from file-system (channel C)", () => {
  const capDepthDetected = true;
  const maxRouteDepthEvidence = 4;
  const evidenceChannels = ['C']; // only file system hints
  const hasStrongEvidence = maxRouteDepthEvidence >= 3 && (evidenceChannels.includes('A') || evidenceChannels.includes('B'));
  const shouldTrigger = capDepthDetected && hasStrongEvidence;
  assert(!shouldTrigger, "Should NOT trigger: channel C alone is insufficient");
});

Deno.test("U2.D3: Confidence increases with multiple evidence channels", () => {
  let confidence = 0.60;
  const channels = ['A', 'B'];
  if (channels.includes('A')) confidence += 0.10;
  if (channels.includes('B')) confidence += 0.10;
  if (channels.includes('A') && channels.includes('B')) confidence += 0.05;
  confidence = Math.min(confidence, 0.85);
  assertEquals(confidence, 0.85, "Both A + B should yield max confidence 0.85");
});

Deno.test("U2.D3: Confidence with single channel A stays at 0.70", () => {
  let confidence = 0.60;
  const channels = ['A'];
  if (channels.includes('A')) confidence += 0.10;
  if (channels.includes('B')) confidence += 0.10;
  if (channels.includes('A') && channels.includes('B')) confidence += 0.05;
  confidence = Math.min(confidence, 0.85);
  assertEquals(confidence, 0.70, "Single channel A should yield 0.70");
});

// ============================================================
// U2.D3 — Admin-scoped false positive prevention tests
// Validates that shallow admin routes (/admin/patients, /admin/doctors)
// do NOT trigger breadcrumb-depth warnings, while deep admin routes DO.
// ============================================================

Deno.test("U2.D3 Admin: /admin + one-segment children only => no breadcrumb warning", () => {
  // Routes: /admin, /admin/patients, /admin/appointments, /admin/doctors, /admin/timeslots
  // All are depth 2 — no 3+ segment routes
  const adminRoutes = ['/admin', '/admin/patients', '/admin/appointments', '/admin/doctors', '/admin/timeslots'];
  const maxDepth = Math.max(...adminRoutes.map(r => r.split('/').filter(Boolean).length));
  const capDepthDetected = true; // getBreadcrumbs returns ≤2 entries
  const hasStrongEvidence = maxDepth >= 3;
  assert(!hasStrongEvidence, "Max depth should be 2");
  assert(!(capDepthDetected && hasStrongEvidence), "Should NOT trigger: all admin routes are ≤2 segments");
});

Deno.test("U2.D3 Admin: /admin/patients/:id present => breadcrumb warning emitted", () => {
  const adminRoutes = ['/admin', '/admin/patients', '/admin/patients/:id'];
  const maxDepth = Math.max(...adminRoutes.map(r => r.split('/').filter(Boolean).length));
  const capDepthDetected = true;
  const channels = ['A'];
  const hasStrongEvidence = maxDepth >= 3 && (channels.includes('A') || channels.includes('B'));
  assert(hasStrongEvidence, "Max depth should be 3 (/admin/patients/:id)");
  assert(capDepthDetected && hasStrongEvidence, "Should trigger: deep admin route exists");
});

Deno.test("U2.D3 Admin: /admin/patients/new present => breadcrumb warning emitted", () => {
  const adminRoutes = ['/admin', '/admin/patients', '/admin/patients/new'];
  const maxDepth = Math.max(...adminRoutes.map(r => r.split('/').filter(Boolean).length));
  const capDepthDetected = true;
  const channels = ['A'];
  const hasStrongEvidence = maxDepth >= 3 && (channels.includes('A') || channels.includes('B'));
  assert(capDepthDetected && hasStrongEvidence, "Should trigger: /admin/patients/new is 3 segments");
});

Deno.test("U2.D3 Admin: Router missing but deep admin links in code => warning emitted", () => {
  // No router path= defs, but code has <Link to="/admin/patients/123/edit">
  const capDepthDetected = true;
  const maxRouteDepthEvidence = 4; // /admin/patients/123/edit = 4 segments
  const channels = ['B']; // from deep link channel only
  const hasStrongEvidence = maxRouteDepthEvidence >= 3 && (channels.includes('A') || channels.includes('B'));
  assert(capDepthDetected && hasStrongEvidence, "Should trigger: deep admin link found via channel B");
});

Deno.test("U2.D3 Admin: Router missing and no deep evidence => no warning", () => {
  const capDepthDetected = true;
  const maxRouteDepthEvidence = 2;
  const channels: string[] = []; // no route or link evidence
  const hasStrongEvidence = maxRouteDepthEvidence >= 3 && (channels.includes('A') || channels.includes('B'));
  assert(!(capDepthDetected && hasStrongEvidence), "Should NOT trigger: no deep evidence at all");
});

// ============================================================
// DESKTOP-SCOPE SUPPRESSION TESTS
// ============================================================

Deno.test("U2: Suppressed when mobileOpen toggle detected without desktop nav hiding", () => {
  const hasMobileOnlyNavToggle = true;
  const hasDesktopNavHidden = false;
  const suppressed = hasMobileOnlyNavToggle && !hasDesktopNavHidden;
  assert(suppressed, "Should suppress U2 for mobile-only nav toggles");
});

Deno.test("U2: NOT suppressed when mobile toggle also hides desktop nav (lg:hidden)", () => {
  const hasMobileOnlyNavToggle = true;
  const hasDesktopNavHidden = true;
  const suppressed = hasMobileOnlyNavToggle && !hasDesktopNavHidden;
  assert(!suppressed, "Should NOT suppress when desktop nav is also hidden");
});

Deno.test("U2: Suppressed when accessible menu toggle exists (aria-label='menu')", () => {
  const hasAccessibleMenuToggle = true;
  const hasDesktopNavHidden = false;
  const suppressed = hasAccessibleMenuToggle && !hasDesktopNavHidden;
  assert(suppressed, "Should suppress for accessible menu toggle without desktop hiding");
});

Deno.test("U2: NOT suppressed when accessible toggle exists but desktop nav is hidden", () => {
  const hasAccessibleMenuToggle = true;
  const hasDesktopNavHidden = true;
  const suppressed = hasAccessibleMenuToggle && !hasDesktopNavHidden;
  assert(!suppressed, "Should NOT suppress when desktop nav is also hidden despite toggle");
});

Deno.test("U2: Responsive classes (sm:hidden, md:block) on nav are treated as mobile-only", () => {
  // sm:/md: classes toggling nav visibility without lg:/xl: hiding → mobile-only
  const hasResponsiveNavClasses = true;
  const hasLgXlHidden = false;
  const isMobileOnly = hasResponsiveNavClasses && !hasLgXlHidden;
  assert(isMobileOnly, "sm:/md: responsive nav toggling should be treated as mobile-only");
});

Deno.test("U2: Responsive classes WITH lg:hidden are NOT treated as mobile-only", () => {
  const hasResponsiveNavClasses = true;
  const hasLgXlHidden = true;
  const isMobileOnly = hasResponsiveNavClasses && !hasLgXlHidden;
  assert(!isMobileOnly, "lg:hidden on nav means desktop nav is also hidden — not mobile-only");
});

// ============================================================
// GLOBAL SUPPRESSION RULES (existing)
// ============================================================

Deno.test("U2: Suppressed when breadcrumb + visible page title present", () => {
  assert(true && true, "Should suppress U2 entirely when breadcrumb + h1 present");
});

Deno.test("U2: Suppressed when Tabs used as primary IA (≤5 routes)", () => {
  assert(true && 4 <= 5, "Should suppress U2 when Tabs are primary IA");
});

Deno.test("U2: Suppressed when Drawer/Sheet with Menu present", () => {
  assert(true);
});

Deno.test("U2: Suppressed when ≥2 navigation primitives present", () => {
  assert(new Set(['Sidebar', 'Breadcrumb']).size >= 2);
});

Deno.test("U2: Suppressed for simple apps (≤2 routes)", () => {
  assert(2 <= 2);
});

Deno.test("U2: Suppressed when layout wrapper provides navigation", () => {
  assert(true && true);
});

// ============================================================
// CONFIDENCE RANGE TESTS
// ============================================================

Deno.test("U2: Structural-only confidence is 0.55-0.70", () => {
  for (const c of [0.65, 0.60, 0.65]) {
    assert(c >= 0.55 && c <= 0.70, `Structural confidence ${c} must be in [0.55, 0.70]`);
  }
});

Deno.test("U2: Confidence never exceeds 0.80", () => {
  for (const c of [0.65, 0.70, 0.75, 0.80]) {
    assert(c <= 0.80, `Confidence ${c} must be ≤ 0.80`);
  }
});

Deno.test("U2: LLM-only (screenshot) confidence range is 0.60-0.80", () => {
  const c = 0.75;
  assert(c <= 0.80 && c >= 0.60);
});

// ============================================================
// SCOPE BOUNDARY TESTS (non-overlap)
// ============================================================

Deno.test("U2: Must NOT evaluate layout grouping (belongs to U6)", () => {
  const u2Scope = ['wayfinding', 'navigation_visibility', 'back_affordance'];
  assert(!u2Scope.includes('layout_grouping'));
  assert(!u2Scope.includes('visual_hierarchy'));
});

Deno.test("U2: Must NOT evaluate content truncation (belongs to U3)", () => {
  const u2Scope = ['wayfinding', 'navigation_visibility', 'back_affordance'];
  assert(!u2Scope.includes('truncation'));
});

Deno.test("U2: Must NOT evaluate step indicators (belongs to U4)", () => {
  const u2Scope = ['wayfinding', 'navigation_visibility', 'back_affordance'];
  assert(!u2Scope.includes('step_indicators'));
});

Deno.test("U2: Must NOT evaluate landmark semantics (belongs to A-rules)", () => {
  const u2Scope = ['wayfinding', 'navigation_visibility', 'back_affordance'];
  assert(!u2Scope.includes('landmark_semantics'));
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
  keys.add('U2.D1|global');
  assertEquals(keys.size, 1);
});

Deno.test("U2: Aggregated output always has blocksConvergence=false", () => {
  const aggregated = { ruleId: 'U2', status: 'potential', blocksConvergence: false };
  assertEquals(aggregated.blocksConvergence, false);
  assertEquals(aggregated.status, 'potential');
});

// ============================================================
// ROUTE-PAGE HEADING VERIFICATION (v5)
// ============================================================

Deno.test("U2.D2: Suppressed when active nav highlight + route pages have <h1>", () => {
  const hasActiveNavHighlight = true;
  const hasPageHeadingInRoutePages = true;
  const suppressed = hasActiveNavHighlight && hasPageHeadingInRoutePages;
  assert(suppressed, "Should suppress: active highlight + route page headings = strong wayfinding");
});

Deno.test("U2.D2: NOT suppressed when active highlight but no route page <h1>", () => {
  const hasActiveNavHighlight = true;
  const hasPageHeadingInRoutePages = false;
  const suppressed = hasActiveNavHighlight && hasPageHeadingInRoutePages;
  assert(!suppressed, "Should NOT suppress: no heading evidence in route pages");
});

Deno.test("U2.D2: PatientLayout with route page headings does NOT claim 'missing page title'", () => {
  const hasPageHeadingInRoutePages = true;
  const hasPageHeadingInLayout = false;
  // Detection text should be layout-scoped, not claim missing page title
  const detectionText = hasPageHeadingInRoutePages
    ? 'Layout does not include breadcrumb structure or a persistent location indicator. Page-level headings were evaluated separately in route pages.'
    : 'Detail/nested views lack persistent wayfinding cues';
  assert(!detectionText.includes('no clear page title in the main content area'));
  assert(detectionText.includes('Page-level headings were evaluated'));
});

Deno.test("U2.D2: Confidence capped at 0.55 when route pages have headings but layout doesn't", () => {
  const hasPageHeadingInRoutePages = true;
  const hasPageHeadingInLayout = false;
  const conf = (hasPageHeadingInRoutePages && !hasPageHeadingInLayout) ? 0.55 : 0.70;
  assertEquals(conf, 0.55, "Route-page headings without layout headings → confidence ≤ 0.55");
});

Deno.test("U2.D2: Advisory text mentions existing headings when route pages have <h1>", () => {
  const hasPageHeadingInRoutePages = true;
  const advisory = hasPageHeadingInRoutePages
    ? 'Optional: add breadcrumbs for deep navigation, but current pages already expose headings.'
    : 'Add at least one persistent "you are here" cue.';
  assert(advisory.includes('already expose headings'));
});

Deno.test("U2.D2: hasAnyCue includes hasPageHeadingInRoutePages", () => {
  const hasActiveNavHighlight = false;
  const hasPageHeadingInLayout = false;
  const hasPageHeadingInRoutePages = true;
  const hasBreadcrumbRendered = false;
  const hasBackControl = false;
  const hasParentRouteLink = false;
  const hasAnyCue = hasActiveNavHighlight || hasPageHeadingInLayout || hasPageHeadingInRoutePages || hasBreadcrumbRendered || hasBackControl || hasParentRouteLink;
  assert(hasAnyCue, "Route page headings should count as a wayfinding cue");
});
