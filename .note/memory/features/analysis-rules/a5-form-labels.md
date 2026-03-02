# Memory: features/analysis-rules/a5-form-labels
Updated: now

Rule A5 (Missing Form Labels) enforces WCAG 1.3.1, 3.3.2, and optionally 4.1.2 (for ARIA roles). It requires DOM/HTML analysis (ZIP/GitHub) and is marked 'Not Evaluated' (informational) for screenshot-only inputs.

## Detection (deterministic static analysis)
Targets: `<input>`, `<textarea>`, `<select>`, elements with `role="textbox|combobox|searchbox|spinbutton|listbox"`, `contenteditable="true"` elements, AND React wrapper components via A5_WRAPPER_COMPONENT_MAP.

### Import-Aware Control Identification
Before checking labels, the detector extracts import statements from each file to determine where components originate. This prevents false positives from name collisions (e.g., `<Switch>` from react-router vs. `<Switch>` from @/components/ui/switch).

Rules:
- Native tags (input/select/textarea/button) → always treated as controls
- Wrapper components in A5_WRAPPER_COMPONENT_MAP:
  - If imported from a **NON-UI source** (react-router, @remix-run, next/navigation, wouter) → **NOT a control, skip A5**
  - If imported from a **UI source** (@/components/ui/*, @radix-ui/*, shadcn, @headlessui/*) → **IS a control**
  - If import source is unknown → check for explicit ARIA role (role="switch", etc.); if no role and no import, assume UI control
  - If import source is unknown and no ARIA role → skip (not a control)

### Wrapper Component Map
Maps React component names to implied control types:
- Input → input
- Textarea → textarea
- SelectTrigger → select (role=combobox)
- Switch → checkbox (role=switch)
- Checkbox → checkbox
- RadioGroupItem → radio
- Slider → slider (role=slider)

### Component-Aware Label Resolution (Wrapper `label` Prop)
For wrapper components (Input, Textarea, etc.), the detector checks for a `label` prop in addition to standard labeling methods:
- `label="Email"` (static string) → treated as programmatically labeled → **PASS, no A5 finding**
- `label={t('email')}` (dynamic/runtime value) → cannot be statically verified → **Potential (borderline, confidence 0.50)**
- No `label` prop and no other labeling → standard A5 detection applies

This prevents false positives when custom wrapper components (e.g., `<Input label="Email" />`) internally render `<label htmlFor={id}>` + `<input id={id}>`.

### Internal Component Suppression
Files matching `components/ui/` are excluded from A5 scanning entirely. This prevents flagging internal `<input>` elements inside wrapper components that handle label association internally via generated ids (e.g., `useId()`).

### Dynamic ID Handling
- If `id` prop is present but dynamic (e.g., `id={id}`, `id={useId()}`), the report shows `id=(dynamic)` instead of `id: (none)`
- Static `id` values are shown as-is: `id="email"`

### Prop Parsing (supports JSX expression syntax)
Props (aria-label, aria-labelledby, id, name, placeholder, label) on wrapper components are parsed identically to native elements. Both static (`aria-label="X"`) and JSX expression (`aria-label={"X"}`, `aria-label={'X'}`) syntax are recognized. A `<Input aria-label="X" />` is treated as labeled.

### Confirmed sub-checks (no confidence score)
- **A5.1**: Missing accessible label (no `<label>`, `aria-label`, `aria-labelledby`, or wrapper `label` prop). Title-only inputs remain A5.1.
- **A5.2**: Placeholder used as only label source.
- **A5.3**: Broken label associations (mismatched `for`/`id`, duplicate IDs, or orphan labels).

### Potential sub-checks (with confidence score)
- **A5.1 (dynamic label)**: Wrapper component has `label` prop with dynamic value — confidence 0.50 (borderline)
- **A5.4**: Generic label text ("Field", "Input", etc.) — confidence 0.88
- **A5.5**: Duplicate label text across controls in same file — confidence 0.90
- **A5.6**: Noisy `aria-labelledby` (>60 chars or advisory tokens) — confidence 0.82

## Labeling Recognition (false-positive suppression)
- **`<label htmlFor>` / `<Label htmlFor>`**: Both lowercase and uppercase Label components with `htmlFor`/`for` props are recognized.
- **shadcn FormLabel/FormControl**: Controls inside `<FormControl>` within a `<FormItem>` that also contains `<FormLabel>` are treated as labeled.
- **Wrapped in label/Label**: Controls wrapped in `<label>` or `<Label>` are recognized.
- **Wrapper `label` prop**: Static `label="..."` on wrapper components is treated as labeled.
- **`data-testid` exclusion**: The `id` attribute regex uses negative lookbehind to prevent `data-testid`, `data-id`, etc. from being matched as `id`.
- **aria-describedby**: Does NOT count as a label (supporting evidence only).

## Data Model
- `isA5Aggregated: true` with `a5Elements: A5ElementSubItem[]`
- Each element has a stable `elementKey` (hash of tag+id+name+type+filePath+lineNumber) used for deduplication and suppression
- `elementName?: string` — React component name (e.g., "Input", "SelectTrigger", "Switch")
- `controlType?: string` — Implied native type (e.g., "input", "select", "checkbox", "slider")
- `wcagCriteria: string[]` — always includes `["1.3.1", "3.3.2"]`, ARIA roles add `"4.1.2"`
- `confidence` is ONLY present on potential findings — confirmed items must NOT include it
- `selectorHints: string[]` — e.g., `['id="email"', 'name="email"', 'aria-label="Search"']`
- `controlId?: string` — the actual `id` prop if present; `"(dynamic)"` if dynamic
- `labelingMethod?: string` — includes evidence, e.g., `label prop (wrapper)`, `aria-label="Search patients"`, `label[htmlFor="foo"]`, `label prop (dynamic — not verified)`, `none`

## Suppression
- A5.3 (broken label) suppresses A5.1 (missing label) in the same file
- Confirmed findings suppress potential findings for the same elementKey

## UI
Renders in standardized aggregated card matching A1-A3 layout:
- Header: "A5 — Missing Form Labels" with element count badge
- Single-sentence description below title
- Collapsible element items showing: Element (type, id, name, aria-label), Labeling (method found/missing with evidence), Detection, Requirement (WCAG ref), Confidence (potential only)
