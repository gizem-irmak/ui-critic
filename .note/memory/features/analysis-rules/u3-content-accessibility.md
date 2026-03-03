# Memory: features/analysis-rules/u3-content-accessibility
Updated: now

Rule U3 (Truncated or Inaccessible Content) evaluates content visibility via hybrid detection, reported as Potential only.

## Strict Gating (v7)
U3 now requires ALL three conditions to trigger:
1. **Strong truncation signal**: truncate, text-ellipsis, line-clamp-*, overflow-hidden + whitespace-nowrap + width constraint, or fixed width + overflow-hidden
2. **Dynamic text binding**: {variable}, {props.*}, {item.*}, or mapped data field. Static text (even long) is fully suppressed.
3. **No recovery mechanism**: ANY recovery signal (title, Tooltip, Popover, expand, click-to-detail, aria-description, overflow-scroll) causes full suppression — not confidence reduction.

Elements that do NOT trigger: decorative containers, icon containers, structural wrappers, height-only constraints without text truncation, overflow-hidden alone without truncation tokens.

## Sub-checks
- U3.D1: Line-clamp/truncate/text-ellipsis/whitespace-nowrap+overflow-hidden+width-constraint, overflow-hidden+width-constraint
- U3.D2: Fixed-height (h-12+, max-h-*) + overflow-hidden without scroll — dynamic content only
- U3.D3: Nested scroll traps
- U3.D4: Hidden content without control
- U3.D5: Unbroken text overflow risk — dynamic content only, recovery = full suppress
- U3.D6: Column-constrained cell clipping — dynamic content only
- U3.D7: Programmatic truncation with ellipsis — .slice(0,N)/.substring(0,N)/.substr(0,N) + "..."/"…"

## Recovery = Full Suppress (v7)
Recovery signals cause immediate suppression (not confidence deduction):
- title attribute, Tooltip/Popover/HoverCard/Dialog components
- overflow-auto/scroll, aria-label/describedby
- "Show more"/"Expand"/"View more" links
- onClick with detail/select pattern, expand/toggle state

## Confidence Model (v7)
Base: 0.55 (raised since only dynamic content reaches scoring)
+0.15 if dynamic + truncation utility, +0.10 if dynamic only, +0.05 if truncation utility, +0.05 for high-risk field labels
-0.20 if header suspected
Range: [0.40, 0.75]

## UI Layout
Concise 7-row layout (Column, Element, Content, Tokens, Recovery, Source, Confidence)

## Cell-Level Reporting (v5)
U3 findings target DATA CELLS, not headers. Each finding includes `columnLabel`.

## Gate Ordering (v4 — strict)
1. **Prepass**: Table context + header token extraction
2. **Gate 2**: Header/label suppression (BEFORE content risk)
3. **Gate 1**: Content risk classification — dynamic/list_mapped ONLY
4. **D1/D2/D3/D4/D5/D6/D7**: Sub-check triggers
5. **Gate 3**: Recovery mechanism detection — FULL SUPPRESS

## Deduplication (v4)
Key format: `U3.{subCheck}|{filePath}|{lineNumber}|{columnLabel}`
