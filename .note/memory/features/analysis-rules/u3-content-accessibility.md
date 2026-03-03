# Memory: features/analysis-rules/u3-content-accessibility
Updated: now

Rule U3 (Truncated or Inaccessible Content) evaluates content visibility via hybrid detection, reported as Potential only.

## Cell-Level Reporting (v3)
U3 findings target DATA CELLS, not headers. Each finding includes `columnLabel` (resolved from nearest `<thead>`) for actionable context (e.g., "Column: Reason").

## Header Suppression (strengthened)
Suppress when element is inside `<thead>`/`<th>`/`<TableHead>`, has role="columnheader", matches known header labels ≤20 chars, has header styling on short text, or is purely static short text (≤20 chars) with no dynamic expression in context.

## Three-Gate Architecture
**Gate 1 — Content Risk**: Only emit when content has meaningful truncation risk:
- Dynamic expression `{…}` present, OR inside `.map()` list rendering (contentKind: dynamic/list_mapped)
- Static text ≥ 28 chars OR ≥ 5 tokens (contentKind: static_long)
- Short static UI chrome suppressed (contentKind: static_short)

**Gate 2 — Header/Label Suppression**: See above.

**Gate 3 — Recovery Mechanism**: Detect title attributes, Tooltip/Popover/HoverCard/Dialog wrappers, overflow-scroll, aria-describedby, "Show more" links, click-to-detail handlers. Recovery signals suppress or lower confidence.

## Column Label Mapping
For table structures, headers are extracted from `<th>`/`<TableHead>` in order. Cell index is computed by counting `<td>`/`<TableCell>` siblings before the finding position. The resolved `columnLabel` appears in elementLabel, evidence, and a dedicated "Column" row in the UI card.

## Evidence Format (v3)
Evidence now reads: `Column "Reason" cell uses \`truncate\` on {appt.reason} with no tooltip/expand` — providing column context, truncation mechanism, and dynamic expression in one line.

## Sub-checks
- U3.D1: Line-clamp/truncate/text-ellipsis/whitespace-nowrap+overflow-hidden, overflow-hidden+width-constraint
- U3.D2: Fixed-height (h-12+, max-h-*) + overflow-hidden without scroll
- U3.D3: Nested scroll traps
- U3.D4: Hidden content without control
- U3.D5: Unbroken text overflow risk

## Enhanced Metadata (v3)
Each finding includes: contentKind, recoverySignals[], truncationTokens[], startLine/endLine, columnLabel, contentPreview.
