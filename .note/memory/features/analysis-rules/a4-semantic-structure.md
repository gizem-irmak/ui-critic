# Memory: features/analysis-rules/a4-semantic-structure
Updated: now

Rule A4 (Missing Semantic Structure) evaluates WCAG 1.3.1/2.4.1 at the **page level**, not repo-wide.

## Page-Level Architecture
- **Page identification**: Files under `/pages/`, `/routes/`, `/app/`, `/views/` directories, OR files referenced as route elements in React Router config.
- **Layout wrapper inference**: One-hop import resolution (`@/` alias supported) to check if a page's wrapper component provides `<main>`.

## Sub-checks:

- **A4.1 (Heading Semantics)**:
  - `visual_heading_missing_semantics`: `<div>`/`<span>`/`<p>` with large font + bold but no heading role → **Confirmed** (0.92).
  - `visual_heading_no_h1`: Top-of-page visual heading in a page file with no `<h1>` → **Potential/borderline** (0.68-0.70).
  - `multiple_h1`: >1 `<h1>` **in the same page file** → **Potential** (0.70). Repo-wide h1 counting is **removed**.
  - `skipped_levels`: Heading hierarchy gaps (global) → **Potential** (0.78).

- **A4.2 (Interactive Semantics)**: Only fires when keyboard support present (tabIndex+keyHandler) but `role` missing. Suppresses if keyboard missing (→ A3-C1).

- **A4.3 (Landmark Regions)**: Layout-aware. If no file has `<main>`/`role="main"`, checks if any page's layout wrapper provides it via one-hop import resolution. Only emits if truly absent everywhere. Confidence 0.80 (with page files) or 0.60 (without).

- **A4.4 (List Semantics)**: Requires ≥3 repeated elements with list-intent evidence. Always **Potential** (0.82).

## Key Design Decisions
- No repo-wide `<h1>` counting (was causing false positives when many pages each had one `<h1>`).
- Layout wrapper inference resolves `@/` aliases and relative imports (one hop only).
- `client/` prefix added to file path filter for monorepo support.
