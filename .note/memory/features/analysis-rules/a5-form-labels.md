# Memory: features/analysis-rules/a5-form-labels
Updated: now

Rule A5 (Missing Form Labels) enforces WCAG 1.3.1, 3.3.2, and optionally 4.1.2 (for ARIA roles). It requires DOM/HTML analysis (ZIP/GitHub) and is marked 'Not Evaluated' (informational) for screenshot-only inputs.

## Detection (deterministic static analysis)
Targets: `<input>`, `<textarea>`, `<select>`, elements with `role="textbox|combobox|searchbox|spinbutton|listbox"`, and `contenteditable="true"` elements.

### Confirmed sub-checks (no confidence score)
- **A5.1**: Missing accessible label (no `<label>`, `aria-label`, or `aria-labelledby`). Title-only inputs remain A5.1.
- **A5.2**: Placeholder used as only label source.
- **A5.3**: Broken label associations (mismatched `for`/`id`, duplicate IDs, or orphan labels).

### Potential sub-checks (with confidence score)
- **A5.4**: Generic label text ("Field", "Input", etc.) — confidence 0.88
- **A5.5**: Duplicate label text across controls in same file — confidence 0.90
- **A5.6**: Noisy `aria-labelledby` (>60 chars or advisory tokens) — confidence 0.82

## Labeling Recognition (false-positive suppression)
- **`<label htmlFor>` / `<Label htmlFor>`**: Both lowercase and uppercase Label components with `htmlFor`/`for` props are recognized.
- **shadcn FormLabel/FormControl**: Controls inside `<FormControl>` within a `<FormItem>` that also contains `<FormLabel>` are treated as labeled. This covers react-hook-form patterns where `FormLabel` sets `htmlFor` and `FormControl` injects `id` via Slot at runtime.
- **Wrapped in label/Label**: Controls wrapped in `<label>` or `<Label>` are recognized.
- **`data-testid` exclusion**: The `id` attribute regex uses negative lookbehind `(?<![a-zA-Z-])id\s*=` to prevent `data-testid`, `data-id`, etc. from being matched as `id`.

## Data Model
- `isA5Aggregated: true` with `a5Elements: A5ElementSubItem[]`
- Each element has a stable `elementKey` (hash of tag+id+name+type+filePath+lineNumber) used for deduplication and suppression
- `wcagCriteria: string[]` — always includes `["1.3.1", "3.3.2"]`, ARIA roles add `"4.1.2"`
- `confidence` is ONLY present on potential findings — confirmed items must NOT include it
- `selectorHints: string[]` — e.g., `['id="email"', 'name="email"', 'aria-label="Search"']`
- `controlId?: string` — the actual `id` prop if present
- `labelingMethod?: string` — what labeling was found or missing (e.g., 'aria-label', 'FormLabel/FormControl (shadcn)', 'none')

## Suppression
- A5.3 (broken label) suppresses A5.1 (missing label) in the same file
- Confirmed findings suppress potential findings for the same elementKey

## UI
Renders in standardized aggregated card matching A1-A3 layout:
- Header: "A5 — Missing Form Labels" with element count badge
- Single-sentence description below title
- Collapsible element items showing: Element (type, id, name, aria-label), Labeling (method found/missing), Detection, Requirement (WCAG ref), Confidence (potential only)
- No internal sub-check badges, evidence blocks, or advisory guidance sections
