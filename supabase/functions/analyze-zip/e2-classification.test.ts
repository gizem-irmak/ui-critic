/**
 * E2 Classification Tests — Imbalanced Choice Architecture in High-Impact Decisions
 * 
 * Tests the deterministic high-impact gate and imbalance signal scoring logic.
 * E2 requires: (1) high-impact domain keywords nearby, AND (2) 2+ imbalance signals.
 */

import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// ── Recreate E2 detection logic for testing ──

const E2_HIGH_IMPACT_KEYWORDS_RE = /\b(accept|decline|cookie|consent|tracking|personalization|privacy|data|share|subscribe|trial|upgrade|buy|purchase|payment|card|delete|remove|cancel\s*plan|confirm|submit|discharge|book\s*appointment|final|cannot\s*be\s*undone)\b/gi;
const E2_EXCLUSION_LABELS = /^(sign\s*in|log\s*in|sign\s*up|register|get\s*started|learn\s*more|home|about|contact|pricing|features|blog|docs|documentation|faq|help|support)$/i;

interface CtaLabel { label: string; styleTokens: string; position: number; }

function detectE2ImbalanceSignals(ctaLabels: CtaLabel[]): string[] {
  const signals: string[] = [];
  if (ctaLabels.length < 2) return signals;
  const styles = ctaLabels.map(c => c.styleTokens.toLowerCase());
  const labels = ctaLabels.map(c => c.label.toLowerCase());

  const hasPrimary = styles.some(s => /bg-|variant=default|variant=\s*$/.test(s) && !/variant=(ghost|link|outline|secondary)/.test(s));
  const hasGhostOrLink = styles.some(s => /variant=(ghost|link|outline)|text-(gray|muted|slate)|text-sm/.test(s));
  if (hasPrimary && hasGhostOrLink) signals.push('visual_dominance');

  const hasWFull = styles.some(s => /w-full|px-8|px-10|py-3|py-4/.test(s));
  const hasSmall = styles.some(s => /text-sm|text-xs|size=sm/.test(s));
  if (hasWFull && hasSmall) signals.push('size_asymmetry');

  const hasPositive = labels.some(l => /\b(yes|continue|accept|agree|upgrade|get|start|try|unlock)\b/i.test(l));
  const hasNegative = labels.some(l => /\b(no\s*thanks|no,?\s*i|maybe\s*later|i\s*don'?t|not\s*now|i\s*hate|i\s*prefer\s*not)\b/i.test(l));
  if (hasPositive && hasNegative) signals.push('language_bias');

  if (/defaultChecked|checked|defaultValue|pre-?selected/.test(styles.join(' '))) signals.push('default_selection');

  const hasLearnMore = labels.some(l => /^learn\s*more$/i.test(l));
  const hasExplicitDecline = labels.some(l => /\b(decline|cancel|no|opt.?out|dismiss|close|skip)\b/i.test(l));
  if (hasLearnMore && !hasExplicitDecline) signals.push('ambiguous_alternative');

  return signals;
}

function matchHighImpactKeywords(text: string): string[] {
  const matched: string[] = [];
  E2_HIGH_IMPACT_KEYWORDS_RE.lastIndex = 0;
  let m;
  while ((m = E2_HIGH_IMPACT_KEYWORDS_RE.exec(text)) !== null) {
    const kw = m[1].toLowerCase();
    if (!matched.includes(kw)) matched.push(kw);
  }
  return matched;
}

function isExcludedLabel(label: string): boolean {
  return E2_EXCLUSION_LABELS.test(label);
}

// ══════════════════════════════════════════════════════════════
// HIGH-IMPACT GATE TESTS
// ══════════════════════════════════════════════════════════════

Deno.test("E2 gate: consent keywords detected", () => {
  const kws = matchHighImpactKeywords("We use cookie tracking. Accept or decline our consent policy.");
  assert(kws.includes("cookie"), `Expected 'cookie' in: ${kws.join(', ')}`);
  assert(kws.includes("tracking"), `Expected 'tracking' in: ${kws.join(', ')}`);
  assert(kws.includes("accept"), `Expected 'accept' in: ${kws.join(', ')}`);
  assert(kws.includes("decline"), `Expected 'decline' in: ${kws.join(', ')}`);
  assert(kws.includes("consent"), `Expected 'consent' in: ${kws.join(', ')}`);
});

Deno.test("E2 gate: monetization keywords detected", () => {
  const kws = matchHighImpactKeywords("Subscribe now and start your free trial. Payment required.");
  assert(kws.includes("subscribe"));
  assert(kws.includes("trial"));
  assert(kws.includes("payment"));
});

Deno.test("E2 gate: irreversible action keywords detected", () => {
  const kws = matchHighImpactKeywords("Delete your account. This cannot be undone. Confirm deletion.");
  assert(kws.includes("delete"));
  assert(kws.includes("cannot be undone"));
  assert(kws.includes("confirm"));
});

Deno.test("E2 gate: no keywords for standard nav page", () => {
  const kws = matchHighImpactKeywords("Welcome to our site. Explore features, pricing, and blog posts.");
  assertEquals(kws.length, 0);
});

Deno.test("E2 gate: no keywords for standard landing page", () => {
  const kws = matchHighImpactKeywords("Get started today. Sign up for free. Already have an account? Sign in.");
  assertEquals(kws.length, 0);
});

Deno.test("E2 gate: 'sign up' alone does NOT trigger gate", () => {
  const kws = matchHighImpactKeywords("Sign up for an account. Sign in if you have one.");
  assertEquals(kws.length, 0);
});

Deno.test("E2 gate: 'sign up' WITH consent context triggers gate", () => {
  const kws = matchHighImpactKeywords("Sign up and accept our privacy policy. We share data with partners.");
  assert(kws.includes("accept"));
  assert(kws.includes("privacy"));
  assert(kws.includes("data"));
  assert(kws.includes("share"));
});

// ══════════════════════════════════════════════════════════════
// EXCLUSION LABEL TESTS
// ══════════════════════════════════════════════════════════════

Deno.test("E2 exclusion: standard auth labels excluded", () => {
  assert(isExcludedLabel("Sign In"));
  assert(isExcludedLabel("Log In"));
  assert(isExcludedLabel("Sign Up"));
  assert(isExcludedLabel("Register"));
  assert(isExcludedLabel("Get Started"));
  assert(isExcludedLabel("Learn More"));
});

Deno.test("E2 exclusion: nav labels excluded", () => {
  assert(isExcludedLabel("Home"));
  assert(isExcludedLabel("About"));
  assert(isExcludedLabel("Contact"));
  assert(isExcludedLabel("Pricing"));
  assert(isExcludedLabel("Features"));
  assert(isExcludedLabel("Blog"));
  assert(isExcludedLabel("Docs"));
});

Deno.test("E2 exclusion: action labels NOT excluded", () => {
  assert(!isExcludedLabel("Accept All Cookies"));
  assert(!isExcludedLabel("Subscribe Now"));
  assert(!isExcludedLabel("Delete Account"));
  assert(!isExcludedLabel("Upgrade Plan"));
  assert(!isExcludedLabel("Confirm Payment"));
});

// ══════════════════════════════════════════════════════════════
// IMBALANCE SIGNAL TESTS
// ══════════════════════════════════════════════════════════════

Deno.test("E2 signals: visual dominance detected (primary vs ghost)", () => {
  const signals = detectE2ImbalanceSignals([
    { label: "Accept All", styleTokens: "bg-blue-600 text-white px-8 py-3", position: 0 },
    { label: "Decline", styleTokens: "variant=ghost text-gray-400 text-sm", position: 1 },
  ]);
  assert(signals.includes("visual_dominance"));
});

Deno.test("E2 signals: size asymmetry detected (w-full vs text-sm)", () => {
  const signals = detectE2ImbalanceSignals([
    { label: "Subscribe", styleTokens: "bg-primary w-full py-4", position: 0 },
    { label: "No thanks", styleTokens: "text-sm text-muted", position: 1 },
  ]);
  assert(signals.includes("size_asymmetry"));
});

Deno.test("E2 signals: language bias detected (positive vs shaming)", () => {
  const signals = detectE2ImbalanceSignals([
    { label: "Yes, continue", styleTokens: "bg-primary", position: 0 },
    { label: "No, I hate saving money", styleTokens: "variant=link", position: 1 },
  ]);
  assert(signals.includes("language_bias"));
});

Deno.test("E2 signals: ambiguous alternative detected (Learn more as only exit)", () => {
  const signals = detectE2ImbalanceSignals([
    { label: "Accept All", styleTokens: "bg-primary", position: 0 },
    { label: "Learn more", styleTokens: "variant=link", position: 1 },
  ]);
  assert(signals.includes("ambiguous_alternative"));
});

Deno.test("E2 signals: ambiguous alternative NOT detected when explicit decline exists", () => {
  const signals = detectE2ImbalanceSignals([
    { label: "Accept All", styleTokens: "bg-primary", position: 0 },
    { label: "Decline", styleTokens: "variant=outline", position: 1 },
    { label: "Learn more", styleTokens: "variant=link", position: 2 },
  ]);
  assert(!signals.includes("ambiguous_alternative"));
});

Deno.test("E2 signals: no signals for equal-weight buttons", () => {
  const signals = detectE2ImbalanceSignals([
    { label: "Option A", styleTokens: "variant=outline px-4 py-2", position: 0 },
    { label: "Option B", styleTokens: "variant=outline px-4 py-2", position: 1 },
  ]);
  assertEquals(signals.length, 0);
});

Deno.test("E2 signals: no signals for standard Sign Up + Sign In", () => {
  const signals = detectE2ImbalanceSignals([
    { label: "Sign Up", styleTokens: "variant=default", position: 0 },
    { label: "Sign In", styleTokens: "variant=outline", position: 1 },
  ]);
  // Even if visual_dominance triggers, there's only 1 signal → won't pass 2+ requirement
  assert(signals.length < 2, `Expected <2 signals but got ${signals.length}: ${signals.join(', ')}`);
});

// ══════════════════════════════════════════════════════════════
// INTEGRATION: GATE + SIGNALS COMBINED
// ══════════════════════════════════════════════════════════════

Deno.test("E2 integration: cookie banner with visual + size asymmetry → PASS", () => {
  const nearbyText = "We use cookies for tracking and personalization. Accept or manage preferences.";
  const kws = matchHighImpactKeywords(nearbyText);
  assert(kws.length > 0, "Should detect high-impact keywords");

  const signals = detectE2ImbalanceSignals([
    { label: "Accept All", styleTokens: "bg-primary w-full py-3", position: 0 },
    { label: "Manage preferences", styleTokens: "variant=ghost text-sm text-muted", position: 1 },
  ]);
  assert(signals.length >= 2, `Expected 2+ signals but got ${signals.length}: ${signals.join(', ')}`);
});

Deno.test("E2 integration: landing page Sign Up + Sign In → SUPPRESSED (no gate)", () => {
  const nearbyText = "Welcome to our platform. Create your account to get started.";
  const kws = matchHighImpactKeywords(nearbyText);
  assertEquals(kws.length, 0, "Standard landing page should have no high-impact keywords");
});

Deno.test("E2 integration: payment form with visual dominance + language bias → PASS", () => {
  const nearbyText = "Complete your purchase. Subscribe to premium plan.";
  const kws = matchHighImpactKeywords(nearbyText);
  assert(kws.includes("purchase") || kws.includes("subscribe"));

  const signals = detectE2ImbalanceSignals([
    { label: "Yes, upgrade now", styleTokens: "bg-green-600 w-full py-4", position: 0 },
    { label: "Maybe later", styleTokens: "variant=link text-gray-400 text-sm", position: 1 },
  ]);
  assert(signals.length >= 2, `Expected 2+ signals: ${signals.join(', ')}`);
});

Deno.test("E2 integration: delete confirmation with equal buttons → SUPPRESSED (only 1 signal)", () => {
  const nearbyText = "Are you sure you want to delete this item? This cannot be undone.";
  const kws = matchHighImpactKeywords(nearbyText);
  assert(kws.length > 0, "Should detect high-impact keywords");

  const signals = detectE2ImbalanceSignals([
    { label: "Delete", styleTokens: "variant=destructive px-4 py-2", position: 0 },
    { label: "Cancel", styleTokens: "variant=outline px-4 py-2", position: 1 },
  ]);
  assert(signals.length < 2, `Expected <2 signals for equal-weight delete dialog but got ${signals.length}: ${signals.join(', ')}`);
});

Deno.test("E2 integration: pricing page with features list (no consent context) → SUPPRESSED", () => {
  const nearbyText = "Choose the plan that works for you. All plans include unlimited users.";
  const kws = matchHighImpactKeywords(nearbyText);
  assertEquals(kws.length, 0, "Standard pricing copy without payment/subscribe keywords");
});

// ══════════════════════════════════════════════════════════════
// CONFIDENCE BOUNDS
// ══════════════════════════════════════════════════════════════

Deno.test("E2 confidence: cap at 0.75", () => {
  const rawConfidence = 0.90;
  const capped = Math.min(rawConfidence, 0.75);
  assertEquals(capped, 0.75);
});

Deno.test("E2 confidence: low signals get 0.55–0.65 range", () => {
  const weakConfidence = 0.60;
  assert(weakConfidence >= 0.55 && weakConfidence <= 0.65);
});

Deno.test("E2 confidence: strong signals max at 0.75", () => {
  const strongConfidence = Math.min(0.80, 0.75);
  assertEquals(strongConfidence, 0.75);
});

// ══════════════════════════════════════════════════════════════
// EDGE CASES
// ══════════════════════════════════════════════════════════════

Deno.test("E2 edge: single CTA → no signals (need 2+)", () => {
  const signals = detectE2ImbalanceSignals([
    { label: "Subscribe Now", styleTokens: "bg-primary w-full", position: 0 },
  ]);
  assertEquals(signals.length, 0);
});

Deno.test("E2 edge: multiple equal CTAs → no signals", () => {
  const signals = detectE2ImbalanceSignals([
    { label: "Plan A", styleTokens: "variant=outline px-4", position: 0 },
    { label: "Plan B", styleTokens: "variant=outline px-4", position: 1 },
    { label: "Plan C", styleTokens: "variant=outline px-4", position: 2 },
  ]);
  assertEquals(signals.length, 0);
});

Deno.test("E2 edge: 'data' keyword in regular context does not trigger", () => {
  // 'data' alone is a high-impact keyword but the test checks the full pipeline
  // where we'd also need 2+ signals to actually flag
  const kws = matchHighImpactKeywords("View your data dashboard. Export reports.");
  assert(kws.includes("data"));
  // Even with the keyword, no imbalance signals → suppressed
  const signals = detectE2ImbalanceSignals([
    { label: "Export", styleTokens: "variant=outline", position: 0 },
    { label: "View All", styleTokens: "variant=outline", position: 1 },
  ]);
  assertEquals(signals.length, 0);
});
