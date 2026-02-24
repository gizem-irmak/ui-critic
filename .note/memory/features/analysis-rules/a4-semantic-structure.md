# Memory: features/analysis-rules/a4-semantic-structure
Updated: now

Rule A4 (Missing Semantic Structure) requires source code (ZIP/GitHub) and uses `status: 'not_evaluated'` (message: "Semantic structure cannot be verified without source code.") for screenshot-only inputs. It performs four sub-checks:

- **A4.1 (Heading Semantics)**:
  - `missing_h1`: No `<h1>` found → **Potential** (apps may define h1 dynamically).
  - `skipped_levels`: Heading hierarchy gaps → **Potential**.
  - `multiple_h1`: More than one `<h1>` → **Potential**.
  - `visual_heading_missing_semantics`: `<div>`/`<span>`/`<p>` with large font class tokens (`text-xl`+, `text-lg`) AND bold (`font-bold`/`font-semibold`) AND text 3–80 chars AND no `role="heading"` → **Confirmed** (0.92 confidence).
  - `visual_heading_no_h1`: Same as above BUT element is near top of component (first 25% of lines) AND no `<h1>` in the same file → **Potential/borderline** (0.68 confidence). Detection text: "Visual heading rendered without semantic heading (<h1> or role='heading' aria-level)".

- **A4.2 (Interactive Semantics)** — deliberately avoids overlap with A3:
  - Only fires when a non-semantic element has a pointer handler (`onClick`, etc.) AND keyboard support is present (`tabIndex>=0` AND `onKeyDown`/`onKeyUp`/`onKeyPress`) BUT missing `role="button"`/`role="link"`.
  - If keyboard support is missing → suppressed (deferred to A3-C1).
  - Ancestor exemptions applied: elements inside `<button>`, `<a>`, `<input>`, `<select>`, `<textarea>`, `<label>`, `<details>` are skipped.
  - Uses `extractJsxOpeningTags` for multiline JSX support.

- **A4.3 (Landmark Regions)**: Missing `<main>` or `role="main"` → **Potential**.

- **A4.4 (List Semantics)** — tightened heuristic, always **Potential**:
  - Requires ≥3 repeated elements with identical className AND list-like intent evidence (class contains "item"/"card"/"entry"/"row"/"record"/"list", OR text content has bullet/number prefixes).
  - Pure Tailwind utility class repetition without list-intent keywords is NOT flagged.

The `detection` field now includes the trigger type (`missing_h1`, `skipped_levels`, `visual_heading_missing_semantics`, `visual_heading_no_h1`, `multiple_h1`) for UI rendering.
