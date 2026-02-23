# Memory: features/analysis-rules/a3-keyboard-operability
Updated: now

Rule A3 (Incomplete Keyboard Operability, WCAG 2.1.1) requires source code (ZIP/GitHub) for evaluation. Screenshot inputs produce `status: 'informational'` ("Not Evaluated").

## Multiline JSX Support
The detection engine uses `extractJsxOpeningTags()` — a custom parser that tracks `{}` brace depth, string literals, and template literals to correctly handle multiline JSX attributes containing arrow functions with `>` characters. This replaces the old `[^>]*` regex which failed on multiline JSX.

## File Coverage
- Scans ALL `.tsx`, `.jsx`, `.ts`, `.js` files recursively (no directory restriction)
- Excludes: `components/ui/`, `node_modules/`, test/spec files

## Classification Rules

### Confirmed
- **A3-C1**: Non-semantic elements (`div`, `span`, `p`, `li`, `section`, `article`, etc.) with pointer handlers (`onClick`, `onMouseDown`, `onPointerDown`, `onTouchStart`) that are missing ANY of: `role`, `tabIndex>=0`, keyboard handler (`onKeyDown`/`onKeyUp`/`onKeyPress`). Uses OR logic — if any required feature is missing → Confirmed.
- **A3-C2**: Native interactive elements (`button`, `a`, `input`, `select`, `textarea`) with `tabIndex={-1}` without `disabled`/`aria-disabled`.
- **A3-C3**: Focus traps with strict static evidence: `onKeyDown` intercepting Tab + `preventDefault()` without Escape exit path.

### Potential
- **A3-P1**: `role="button"` with `tabIndex` but no key handler; or `<a>` without valid `href` used as button.
- **A3-C3** (downgraded): Focus trap with Escape path detected → Potential.

## Exemptions (No Report)
- Element nested inside native interactive ancestor (`button`, `a`, `input`, `select`, `textarea`, `label`, `details`)
- `<summary>` inside `<details>`
- Element with `role` + `tabIndex>=0` + keyboard handler (all three present)
- `aria-hidden="true"` elements
- Disabled elements (`disabled`, `aria-disabled`)

## Logging
Each finding logs: `filePath`, `lineNumber`, `<tag>`, `handlers=[...]`, `missing=[...]`, `reasonCode`.

## A3Finding Interface
Includes `lineNumber`, `detectedHandlers: string[]`, `missingFeatures: string[]` for structured logging.
