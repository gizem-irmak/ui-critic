# Memory: features/analysis-rules/u3-content-accessibility
Updated: now

Rule U3 (Truncated or Inaccessible Content) evaluates content visibility via hybrid detection.

## Classification Model (v9)
U3 now supports both **Confirmed** and **Potential** classifications:

### Confirmed (≥0.80 confidence)
Triggered when element has **explicit truncation utility** on the same node as dynamic text AND **no recovery mechanism**:
- `truncate`, `line-clamp-1/2/3/...`, `text-ellipsis`
- These deterministically impose truncation — no screenshot needed to confirm the mechanism.
- Advisory: "Content is truncated by CSS and no accessible recovery is provided."

### Potential (0.55–0.75 confidence)
Triggered when truncation is **implied but not explicit**:
- `overflow-hidden` without `truncate`/`line-clamp`
- Fixed height + `overflow-hidden` (D2)
- Width constraints without explicit ellipsis/clamp (D1b, D6)
- `whitespace-nowrap` + `overflow-hidden` + width constraint
- Programmatic `.slice(0,N)` + ellipsis (D7)
- Unbroken text overflow risk (D5)
- Advisory: "Static analysis suggests possible clipping; verify in rendered UI."

## Per-Node Scoping (v8)
ALL U3 checks enforce strict per-node isolation:
1. **Carrier-only tokens**: Truncation tokens extracted ONLY from carrier element's own `className`.
2. **Same-node signal**: Signal must exist on the SAME JSX node being flagged.
3. **Text-element gate**: Carrier must be a text-rendering element.
4. **Empty content gate**: If content preview is empty/whitespace, do NOT report.

## Strict Gating (v7+v8)
U3 requires ALL conditions to trigger:
1. Strong truncation signal on same node
2. Dynamic text binding ({variable}, {props.*}, {item.*})
3. Text-rendering element
4. Non-empty content
5. No recovery mechanism

## Recovery = Full Suppress (or downgrade to Potential)
Recovery signals cause immediate suppression:
- title attribute, Tooltip/Popover/HoverCard/Dialog components
- overflow-auto/scroll, aria-label/describedby
- "Show more"/"Expand"/"View more" links
- onClick with detail/select pattern, expand/toggle state

## Confidence Model
**Confirmed path** (explicit truncation):
- Base: 0.82
- +0.05 if dynamic content, +0.03 for high-risk field labels
- -0.15 if header suspected
- Range: [0.80, 0.90]

**Potential path** (implicit clipping):
- Base: 0.55
- +0.15 if dynamic + truncation utility, +0.10 if dynamic only
- +0.05 if truncation utility, +0.05 for high-risk field labels
- -0.20 if header suspected
- Range: [0.40, 0.75]

## Sub-checks
- U3.D1: Line-clamp/truncate/text-ellipsis → **Confirmed** (if no recovery)
- U3.D1 (nowrap): whitespace-nowrap + overflow-hidden + width → **Potential**
- U3.D1b: Width constraint + overflow-hidden → **Potential**
- U3.D6: Column-constrained cell clipping → **Potential**
- U3.D7: Programmatic truncation (.slice/.substring + "...") → **Potential**
- U3.D5: Unbroken text overflow risk → **Potential**

## UI Layout
Concise 7-row layout (Column, Element, Content, Tokens, Recovery, Source, Confidence).
Per-element "Confirmed" badge shown on confirmed items. Card border is destructive for confirmed, warning for potential-only.

## Deduplication
Key format: `U3.{subCheck}|{filePath}|{lineNumber}|{columnLabel}`
