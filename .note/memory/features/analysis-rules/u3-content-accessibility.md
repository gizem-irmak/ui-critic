# Memory: features/analysis-rules/u3-content-accessibility
Updated: now

Rule U3 (Truncated or Inaccessible Content) evaluates content visibility via hybrid detection, reported as Potential only.

## Cell-Level Reporting (v4)
U3 findings target DATA CELLS, not headers. Each finding includes `columnLabel` (resolved from nearest `<thead>`) for actionable context (e.g., "Column: Reason").

## Gate Ordering (v4 — strict)
Gates are applied in this order:
1. **Prepass**: Table context + header token extraction
2. **Gate 2**: Header/label suppression (BEFORE content risk)
3. **Gate 1**: Content risk classification
4. **D1/D2/D3/D4/D5**: Sub-check triggers
5. **Gate 3**: Recovery mechanism detection

## Header Suppression (v4 — multi-token)
Suppress when:
- Element is inside `<thead>`/`<th>`/`<TableHead>`, has role="columnheader"
- **NEW**: textPreview contains ≥3 known header label tokens (patient, doctor, reason, status, date, actions, name, specialty, location, time, etc.) — catches concatenated header strings regardless of length
- Matches known header labels ≤20 chars
- Has header styling on any-length static text without dynamic expressions
- Is purely static short text (≤20 chars) with no dynamic expression in context

## Table-Context Static Suppression (v4)
In table/list contexts (`<tr>`, `<td>`, `<TableCell>`, `.map()` blocks), `static_long` content kind is NOT enough to emit U3. Only `dynamic` or `list_mapped` content kinds qualify for emission inside table structures.

## Three-Gate Architecture
**Gate 1 — Content Risk**: Only emit when content has meaningful truncation risk:
- Dynamic expression `{…}` present, OR inside `.map()` list rendering (contentKind: dynamic/list_mapped)
- Static text ≥ 28 chars OR ≥ 5 tokens (contentKind: static_long) — but suppressed in table contexts
- Short static UI chrome suppressed (contentKind: static_short)

**Gate 2 — Header/Label Suppression**: See above (multi-token detection).

**Gate 3 — Recovery Mechanism**: Detect title attributes, Tooltip/Popover/HoverCard/Dialog wrappers, overflow-scroll, aria-describedby, "Show more" links, click-to-detail handlers. Recovery signals suppress or lower confidence.

## Column Label Mapping
For table structures, headers are extracted from `<th>`/`<TableHead>` in order. Cell index is computed by counting `<td>`/`<TableCell>` siblings before the finding position. The resolved `columnLabel` appears in elementLabel, evidence, and a dedicated "Column" row in the UI card.

## Evidence Format (v3)
Evidence now reads: `Column "Reason" cell uses \`truncate\` on {appt.reason} with no tooltip/expand` — providing column context, truncation mechanism, and dynamic expression in one line.

## Deduplication (v4)
Key format: `U3.{subCheck}|{filePath}|{lineNumber}|{columnLabel}` — includes column label to prevent merging distinct cells on the same line.

## Sub-checks
- U3.D1: Line-clamp/truncate/text-ellipsis/whitespace-nowrap+overflow-hidden, overflow-hidden+width-constraint
- U3.D2: Fixed-height (h-12+, max-h-*) + overflow-hidden without scroll
- U3.D3: Nested scroll traps
- U3.D4: Hidden content without control
- U3.D5: Unbroken text overflow risk

## Enhanced Metadata (v3)
Each finding includes: contentKind, recoverySignals[], truncationTokens[], startLine/endLine, columnLabel, contentPreview.
