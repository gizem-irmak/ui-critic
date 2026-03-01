# Memory: features/analysis-rules/u2-navigation
Updated: today

Rule U2 (Incomplete / Unclear Navigation) is a desktop-scoped hybrid rule, always classified as Potential (non-blocking).

## Wayfinding Focus
Evaluates whether users can understand their location, where they can go, and how to navigate back/up. Explicitly excludes layout grouping (U6), step context (U4), exit/cancel (E3).

## Sub-checks
- **U2.D1** (Missing nav landmark): Triggers if ≥3 routes AND no rendered nav UI components or navItems mapping AND no layout wrapper with nav.
- **U2.D2** (Deep pages without "you are here" cues): Triggers if nested routes (depth ≥2 with detail/edit patterns) exist AND all cues missing (active highlight, page heading, breadcrumb, back button).
- **U2.D3** (Breadcrumb depth risk — evidence-gated, project-agnostic): Only triggers when BOTH:
  1. Breadcrumb implementation shows cap-depth pattern (returns ≤2 levels, maps only shallow segments, .slice(0,2), switch with shallow cases)
  2. Multi-channel evidence of deeper route hierarchy (≥3 segments) from Router defs (channel A) or deep links (channel B). File system hints (channel C) alone are insufficient.
  - Cap-depth detection scans files matching breadcrumb/crumbs/navtrail by path or content tokens.
  - Finding text includes specific breadcrumb function name, file path, and one example deep route.
  - Confidence: 0.60 base, +0.10 for channel A, +0.10 for channel B, +0.05 if both A+B, capped at 0.85.

## Suppression
Suppressed for simple apps (≤2 routes), mobile-only responsive patterns, accessible menu toggles, ≥2 nav primitives, clear headings + active highlights, breadcrumb + page title.

## Confidence
Hard cap: 0.80 for D1/D2, 0.85 for D3. Findings are aggregated into a single U2 card per run with element-level evidence and advisory guidance.
