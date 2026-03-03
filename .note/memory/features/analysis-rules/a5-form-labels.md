# Memory: features/analysis-rules/a5-form-labels
Updated: now

Rule A5 (Missing Form Labels) enforces WCAG 1.3.1, 3.3.2, and optionally 4.1.2 (for ARIA roles). It requires DOM/HTML analysis (ZIP/GitHub) and is marked 'Not Evaluated' (informational) for screenshot-only inputs.

## Epistemic Safety Principle (v2)
**Only classify Confirmed when absence of accessible name is deterministically provable from static code.**

- **Native self-closing form controls** (`<input>`, `<textarea>`, `<select>`) with no label → **Confirmed** (deterministically provable)
- **React wrapper components** (Input, Switch, Checkbox, SelectTrigger, etc.) → **Potential** (library abstractions may internally render accessible names)
- **ARIA role elements** (`<div role="textbox">`, `<div role="listbox">`) → **Potential** (may contain children providing accessible name)
- **Contenteditable elements** → **Potential** (may contain text providing accessible name)
- Confidence for ambiguous findings: ≤ 0.70, potentialSubtype: 'accuracy'

### Labeling Evidence Wording
- Confirmed: `labelingMethod: 'none'` (deterministically provable)
- Potential (library/ambiguous): `labelingMethod: 'no explicit label detected'`
- UI displays: "No explicit programmatic label detected (label, aria-label, aria-labelledby). Accessible name may rely on rendered text content."
- **NEVER** state "Labeling: none" or "Control has no accessible name" for Potential findings.

## Detection (deterministic static analysis)
Targets: `<input>`, `<textarea>`, `<select>`, elements with `role="textbox|combobox|searchbox|spinbutton|listbox"`, `contenteditable="true"` elements, AND React wrapper components via A5_WRAPPER_COMPONENT_MAP.

### Import-Aware Control Identification
Before checking labels, the detector extracts import statements from each file to determine where components originate. This prevents false positives from name collisions (e.g., `<Switch>` from react-router vs. `<Switch>` from @/components/ui/switch).

Rules:
- Native tags (input/select/textarea/button) → always treated as controls
- Wrapper components in A5_WRAPPER_COMPONENT_MAP:
  - If imported from a **NON-UI source** (react-router, @remix-run, next/navigation, wouter) → **NOT a control, skip A5**
  - If imported from a **UI source** (@/components/ui/*, @radix-ui/*, shadcn, @headlessui/*) → **IS a control**
  - If import source is unknown → check for explicit ARIA role (role="switch", etc.); if no role and no import, skip
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
- No `label` prop and no other labeling → **Potential** (epistemic safety — library abstraction)

### Internal Component Suppression
Files matching `components/ui/` are excluded from A5 scanning entirely.

### Confirmed sub-checks (no confidence score)
- **A5.1**: Missing accessible label — ONLY for native self-closing controls (`<input>`, `<textarea>`, `<select>`) where absence is deterministically provable.
- **A5.2**: Placeholder used as only label source.
- **A5.3**: Broken label associations (mismatched `for`/`id`, duplicate IDs, or orphan labels).

### Potential sub-checks (with confidence score)
- **A5.1 (library abstraction)**: React wrapper component with no explicit label — confidence 0.70 (epistemic safety)
- **A5.1 (ARIA role)**: Element with ARIA input role, no explicit label — confidence 0.70
- **A5.1 (contenteditable)**: Contenteditable element, no explicit label — confidence 0.70
- **A5.1 (dynamic label)**: Wrapper component has `label` prop with dynamic value — confidence 0.50 (borderline)
- **A5.4**: Generic label text ("Field", "Input", etc.) — confidence 0.88
- **A5.5**: Duplicate label text across controls in same file — confidence 0.90
- **A5.6**: Noisy `aria-labelledby` (>60 chars or advisory tokens) — confidence 0.82

## UI
Renders in standardized aggregated card matching A1-A3 layout:
- Header: "A5 — Missing Form Labels" with element count badge
- Labeling field uses epistemic wording for Potential findings (warning color)
- Labeling field uses "none" for Confirmed findings (destructive color)
