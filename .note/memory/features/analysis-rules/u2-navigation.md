# Memory: features/analysis-rules/u2-navigation
Updated: today

Rule U2 (Incomplete / Unclear Navigation) evaluates ONLY wayfinding clarity. Always Potential (non-blocking), advisory only, never Confirmed, never generates corrective prompts. Confidence hard-capped at 0.80. Desktop-scoped by default.

## Desktop Scope Policy
U2 is desktop-scoped. Mobile/responsive navigation patterns are suppressed:
- If evidence includes `mobileOpen`, `isMobileMenuOpen`, or responsive classes (`sm:`, `md:`) toggling navigation visibility → suppress, UNLESS `lg:hidden` or `xl:hidden` also hides nav at desktop breakpoints.
- If an accessible menu toggle exists (`aria-label` containing "menu", "navigation", "open menu", "toggle menu", "hamburger") → suppress for "hidden nav until interaction" pattern.
- Standard responsive patterns (hamburger on mobile, full nav on desktop) are NOT flagged.

## Scope (strictly wayfinding)
U2 asks three questions:
1. Can users understand where they are? (active page indicator, page title)
2. Can users understand where they can go? (visible navigation, discoverable menu)
3. Can users navigate back/up in deep contexts? (back button, breadcrumb, parent link)

## Non-overlap boundaries
- Layout grouping / visual hierarchy → U6 (NOT U2)
- Content truncation / hidden overflow → U3 (NOT U2)
- Multi-step flow context / step indicators → U4 (NOT U2)
- Accessibility landmark semantics → A-rules (NOT U2)
- Code maintainability / routing scalability → out of scope

## Code Modality (ZIP/GitHub) — Deterministic Pre-pass
- **U2.D1** (No visible primary navigation): Triggers if ≥3 routes AND no rendered nav UI components (Sidebar, Navbar, Header, Topbar, Menu, Tabs, Breadcrumb, NavigationMenu, Drawer, Sheet, Stepper) AND no navItems.map() in JSX AND no layout wrapper providing nav. Does NOT require `<nav>` or `role="navigation"` — semantic absence alone must NOT trigger.
- **U2.D2** (Deep route lacks up/back): Triggers if route depth ≥2 with detail/edit pattern (:id, /edit, /new, /create, /details) AND no visible back control ("Back", "Previous", "Cancel" button) AND no breadcrumb rendered AND no parent route link in header. navigate(-1) counts ONLY if paired with visible button.
- **U2.D3** (Breadcrumb logic defined but not rendered): Triggers if getBreadcrumbs() or breadcrumb array defined AND Breadcrumb component exists in design system AND component NOT rendered AND max route depth ≥3. Does NOT trigger on unused imports alone. Does NOT trigger for shallow apps (depth < 3).

## Screenshot Modality (LLM-only)
LLM evaluates ONLY:
1. Current page identifiability (active highlight, title match)
2. Navigation discoverability (visible nav, mobile menu affordance)
LLM must NOT comment on layout grouping, spacing, visual hierarchy, or UI polish.

## Global Suppression (suppress U2 entirely if ANY true)
1. Breadcrumb rendered AND visible page title (h1) present
2. Tabs used as primary IA (≤5 routes)
3. Drawer/Sheet with Menu button present
4. ≥2 navigation primitives present (Sidebar + Breadcrumb, Navbar + Tabs, etc.)
5. Simple app (≤2 routes)
6. Navigation clearly provided by shared layout component + nav component rendered
7. Mobile-only nav toggle detected (mobileOpen, responsive classes) WITHOUT desktop nav hiding
8. Accessible menu toggle with aria-label ("menu", "navigation", etc.) WITHOUT desktop nav hiding

## Confidence Ranges
- Structural-only: 0.55–0.70
- Structural + LLM reinforcement: 0.65–0.80
- Screenshot-only: 0.60–0.80
- Hard cap: 0.80 (never exceed)

## Output
- If suppressed: no candidate, no LLM call, no U2 card
- If reported: aggregate per file by sub-check, advisory only
- Header: "Navigation clarity risk — verify in context."
- evaluationMethod: 'hybrid_structural' (deterministic), 'hybrid_llm_fallback' (LLM enrichment), 'llm_perceptual' (screenshot)
