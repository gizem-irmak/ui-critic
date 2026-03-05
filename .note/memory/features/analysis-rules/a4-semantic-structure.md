# Memory: features/analysis-rules/a4-semantic-structure
Updated: now

Rule A4 (Missing Semantic Structure) evaluates WCAG 1.3.1/2.4.1 at the **page level**, not repo-wide.

## Shared Page File Detection (parity-critical)

Both `analyze-zip` and `analyze-github` use `identifyPageFiles()` from `_shared/projectSnapshot.ts`. This function:

1. **Path-based**: Files matching `src/pages/**`, `src/routes/**`, `app/**`, `pages/**`, `views/**`
2. **Route-entry detection**: Files exporting components referenced in React Router `element={<Comp />}` config
3. **Layout exclusion**: `*Layout.tsx`, `layout.tsx` are excluded UNLESS they are route entry components
4. Helper: `isPageFile(path, content, allFiles, routeEntryComponents)` — deterministic, shared

## Sub-checks

- **A4.1 (Heading Semantics)**:
  - `visual_heading_missing_semantics`: `<div>`/`<span>`/`<p>` with large font + bold but no heading role → **Confirmed** (0.92)
  - `visual_heading_no_h1`: Top-of-page visual heading with no `<h1>` → **Potential/borderline** (0.68-0.70, page vs non-page)
  - `multiple_h1`: >1 `<h1>` **in the same page file** → **Potential** (0.70). Only runs on `isPageFile === true`
  - `skipped_levels`: Heading hierarchy gaps (global) → **Potential** (0.78)
- **A4.2 (Interactive Semantics)**: Only fires when keyboard support present (tabIndex+keyHandler) but `role` missing
- **A4.3 (Landmark Regions)**: Layout-aware. Confidence 0.80 (with page files) or 0.60 (without)
- **A4.4 (List Semantics)**: Requires ≥3 repeated elements with list-intent evidence. Always **Potential** (0.82)

## Regex Parity

Both pipelines use identical `LARGE_FONT_RE` and `BOLD_RE` with responsive prefix support: `(?:sm|md|lg|xl|2xl):`.

## Diagnostics

Both pipelines log `=== A4 PARITY DIAGNOSTICS ===` with page file list and per-sub-check finding counts.

## Key Design Decisions
- No repo-wide `<h1>` counting (was causing false positives)
- Layout wrapper inference resolves `@/` aliases and relative imports (one hop only)
- `client/` prefix added to file path filter for monorepo support
- For screenshots, A4 is 'Not Evaluated' (Input Limitation)
