# Memory: features/analysis-rules/u3-content-accessibility
Updated: now

Rule U3 (Truncated or Inaccessible Content) evaluates content visibility via hybrid detection, reported as Potential only.

## Cell-Level Reporting (v5)
U3 findings target DATA CELLS, not headers. Each finding includes `columnLabel` (resolved from nearest `<thead>` or `<TableHeader>`) for actionable context (e.g., "Column: Reason").

## Content Preview Binding (v5 — carrier-scoped)
Content preview is extracted from the CARRIER ELEMENT's own subtree (via `extractU3CarrierContentPreview`), NOT from a forward scan at the regex match position. This ensures the preview matches the actual truncated content (e.g., `{doctors?.name}` not `{appt.status}` from a sibling element).

## Shadcn Table Component Support (v5)
The following shadcn components are treated as semantic table structure throughout U3:
- `<Table>`, `<TableHeader>`, `<TableBody>`, `<TableRow>`, `<TableHead>`, `<TableCell>`
These are recognized for: table context detection, header suppression, column label mapping, and carrier element attribution.

## Gate Ordering (v4 — strict)
Gates are applied in this order:
1. **Prepass**: Table context + header token extraction
2. **Gate 2**: Header/label suppression (BEFORE content risk)
3. **Gate 1**: Content risk classification
4. **D1/D2/D3/D4/D5/D6**: Sub-check triggers
5. **Gate 3**: Recovery mechanism detection

## Header Suppression (v4 — multi-token)
Suppress when:
- Element is inside `<thead>`/`<th>`/`<TableHead>`/`<TableHeader>`, has role="columnheader"
- textPreview contains ≥3 known header label tokens
- Matches known header labels ≤20 chars
- Has header styling on any-length static text without dynamic expressions
- Is purely static short text (≤20 chars) with no dynamic expression in context

## Table-Context Static Suppression (v4)
In table/list contexts, `static_long` content kind is NOT enough to emit U3. Only `dynamic` or `list_mapped` content kinds qualify.

## Token Extraction (v5)
`min-w-0` is extracted as its own token. `w-N` tokens are NOT extracted from inside `min-w-N` or `max-w-N` (negative lookbehind). Bracket notations (`w-[200px]`, `max-w-[200px]`) are also extracted.

## Sub-checks
- U3.D1: Line-clamp/truncate/text-ellipsis/whitespace-nowrap+overflow-hidden, overflow-hidden+width-constraint
- U3.D2: Fixed-height (h-12+, max-h-*) + overflow-hidden without scroll
- U3.D3: Nested scroll traps
- U3.D4: Hidden content without control
- U3.D5: Unbroken text overflow risk
- U3.D6: Column-constrained cell clipping — width constraint + overflow-hidden/table-fixed in table/list context, dynamic content only

## Column Label Mapping (v5)
Supports both HTML (`<thead>`, `<th>`, `<tr>`, `<td>`) and shadcn (`<TableHeader>`, `<TableHead>`, `<TableRow>`, `<TableCell>`). Row start is found using whichever of `<tr` or `<TableRow` appears last before the position.

## Deduplication (v4)
Key format: `U3.{subCheck}|{filePath}|{lineNumber}|{columnLabel}`
