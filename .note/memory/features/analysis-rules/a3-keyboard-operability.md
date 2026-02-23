# Memory: features/analysis-rules/a3-keyboard-operability
Updated: now

Rule A3 (Incomplete Keyboard Operability) targets WCAG 2.1.1. Requires source code (ZIP/GitHub); screenshots emit `status: 'not_evaluated'`.

## Classification Codes

### Confirmed (Blocking)

**A3-C1 — Non-semantic clickable elements:**
- Tag is non-native interactive (div/span/p/li/section/etc)
- Has pointer handler (onClick/onMouseDown/onPointerDown/onTouchStart)
- AND any of: (a) missing interactive role, (b) missing tabIndex or tabIndex<0, (c) missing keyboard handler (onKeyDown/onKeyUp/onKeyPress)
- Exemptions (do NOT confirm):
  - Nested inside a native interactive ancestor (button, a, select, textarea)
  - `<label>` or `<summary>` elements (not in NON_INTERACTIVE_TAGS)
  - role + tabIndex>=0 + keyHandler ALL present → no finding
- Confidence: 92%

**A3-C2 — Native elements blocked:**
- button/a/input/select/textarea with tabIndex="-1" when intended to be interactive
- Exempt if: aria-hidden="true", hidden, sr-only, visually-hidden, **disabled**, or **aria-disabled="true"**
- Confidence: 90%

**A3-C3 — Focus traps (strict evidence only):**
- Only Confirmed if keydown handler intercepts Tab/Shift+Tab and prevents default, or explicit focus-loop logic without escape path
- Otherwise downgrade to Potential with reason "runtime focus trap cannot be proven statically"
- (Not yet implemented in detector)

### Potential (Non-blocking)

**A3-P1 — Missing Enter/Space activation:**
- role="button" with tabIndex>=0 but no keyboard handler
- `<a>` without href with onClick: upgraded to **Confirmed (A3-C1)** if missing role/tabIndex/keyHandler; otherwise Potential
- Confidence: 68-72%

### Removed

**A3-P2 (Menu ARIA state)** — Reclassified to A6 (Missing Accessible Names / Name-Role-Value). Menu triggers lacking aria-controls/aria-expanded belong to ARIA semantics, not keyboard operability.

## Screenshot Handling

- status: `not_evaluated`
- message: "Keyboard operability cannot be verified from screenshots without source/runtime."
- confidence: 0

## Policies

- No-downgrade policy within same modality
- Standard corrective prompt 3-part format
- `isNestedInInteractiveAncestor()` helper scans 800 chars before match for unclosed interactive tags
