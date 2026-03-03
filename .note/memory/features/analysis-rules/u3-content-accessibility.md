# Memory: features/analysis-rules/u3-content-accessibility
Updated: now

Rule U3 (Truncated or Inaccessible Content) evaluates content visibility via hybrid detection, reported as Potential only.

## Per-Node Scoping (v8)
ALL U3 checks enforce strict per-node isolation:
1. **Carrier-only tokens**: Truncation tokens are extracted ONLY from the carrier element's own `className`. Never from `context` window (which merges ancestor/sibling classes).
2. **Same-node signal**: The truncation signal (truncate, overflow-hidden, width constraint) must exist on the SAME JSX node being flagged — not on ancestors or siblings.
3. **Text-element gate**: Carrier must be a text-rendering element (p, span, td, div with text, etc.). SVG, img, icon components, and layout-only wrappers are ineligible.
4. **Empty content gate**: If extracted content preview is empty/whitespace, do NOT report.

## Strict Gating (v7+v8)
U3 now requires ALL conditions to trigger:
1. **Strong truncation signal on same node**: truncate, text-ellipsis, line-clamp-*, (overflow-hidden + whitespace-nowrap) on same className, or fixed width + overflow-hidden on same className
2. **Dynamic text binding**: {variable}, {props.*}, {item.*}, or mapped data field. Static text (even long) is fully suppressed.
3. **Text-rendering element**: Carrier tag must pass u3IsTextElement gate.
4. **Non-empty content**: Content preview must contain actual text or dynamic binding.
5. **No recovery mechanism**: ANY recovery signal causes full suppression.

Elements that do NOT trigger: decorative containers, icon components (lucide-react etc.), svg/path/img, structural wrappers, elements where truncation class is on a different node than the text.

## Sub-checks
- U3.D1: Line-clamp/truncate/text-ellipsis on same node as dynamic text
- U3.D1 (nowrap): whitespace-nowrap + overflow-hidden + width constraint ALL on same node
- U3.D1b: Width constraint + overflow-hidden on same node (no explicit truncate)
- U3.D6: Column-constrained cell clipping — all signals on same carrier node
- U3.D7: Programmatic truncation with ellipsis — .slice(0,N)/.substring(0,N) + "..."/"…"

## Recovery = Full Suppress
Recovery signals cause immediate suppression (not confidence deduction):
- title attribute, Tooltip/Popover/HoverCard/Dialog components
- overflow-auto/scroll, aria-label/describedby
- "Show more"/"Expand"/"View more" links
- onClick with detail/select pattern, expand/toggle state

## Confidence Model
Base: 0.55 (raised since only dynamic content reaches scoring)
+0.15 if dynamic + truncation utility, +0.10 if dynamic only, +0.05 if truncation utility, +0.05 for high-risk field labels
-0.20 if header suspected
Range: [0.40, 0.75]

## UI Layout
Concise 7-row layout (Column, Element, Content, Tokens, Recovery, Source, Confidence)

## Cell-Level Reporting
U3 findings target DATA CELLS, not headers. Each finding includes `columnLabel`.

## Gate Ordering (v8)
1. **Carrier resolution**: Find carrier element via u3FindCarrierElement
2. **Text-element gate**: Carrier tag must be text-rendering
3. **Same-node gate**: Signal must be on carrier's own className
4. **Empty content gate**: Content preview must be non-empty
5. **Gate 2**: Header/label suppression
6. **Gate 1**: Content risk classification — dynamic/list_mapped ONLY
7. **Gate 3**: Recovery mechanism detection — FULL SUPPRESS

## Deduplication
Key format: `U3.{subCheck}|{filePath}|{lineNumber}|{columnLabel}`
