# Memory: features/analysis-rules/u3-content-accessibility
Updated: now

Rule U3 (Truncated or Inaccessible Content) evaluates content visibility via hybrid detection, reported as Potential only.

## Sub-checks
- U3.D1: Line-clamp/truncate/text-ellipsis/whitespace-nowrap+overflow-hidden, overflow-hidden+width-constraint
- U3.D2: Fixed-height (h-12+, max-h-*) + overflow-hidden without scroll
- U3.D3: Nested scroll traps
- U3.D4: Hidden content without control
- U3.D5: Unbroken text overflow risk
- U3.D6: Column-constrained cell clipping — width constraint + overflow-hidden/table-fixed in table/list context, dynamic content only
- U3.D7: Programmatic truncation with ellipsis — .slice(0,N)/.substring(0,N)/.substr(0,N) + "..."/"…" in JSX text nodes

## U3.D7 Details (Programmatic Truncation)
Triggers when a dynamic expression uses .slice/.substring/.substr(0, N) AND an ellipsis ("..." or "…") is adjacent (inside or immediately after the expression). Confidence: base 0.45, +0.15 if in .map(), +0.10 if explicit ellipsis, -0.20 for ID-like fields (_id, uuid, token), -0.20 if recovery detected. ID fields get a special note: "Intentional ID shortening". Recovery suppression same as CSS truncation (title, tooltip, expand mechanism).

## UI Layout
Concise 7-row layout (Column, Element, Content, Tokens, Recovery, Source, Confidence) with:
- "Truncation kind" field: CSS vs Programmatic (shown for D7 findings, includes slice length)
- Subtree-scoped carrier content preview

## Cell-Level Reporting (v5)
U3 findings target DATA CELLS, not headers. Each finding includes `columnLabel` (resolved from nearest `<thead>` or `<TableHeader>`) for actionable context.

## Content Preview Binding (v6 — carrier-scoped)
Content preview is extracted from the CARRIER ELEMENT's own subtree using a unified `{expr}` regex that handles cast expressions like `(appt as any).doctors?.name`. Never pulls preview from siblings/parents.

## Gate Ordering (v4 — strict)
1. **Prepass**: Table context + header token extraction
2. **Gate 2**: Header/label suppression (BEFORE content risk)
3. **Gate 1**: Content risk classification
4. **D1/D2/D3/D4/D5/D6/D7**: Sub-check triggers
5. **Gate 3**: Recovery mechanism detection

## Header Suppression (v4 — multi-token)
Suppress when element is inside `<thead>`/`<th>`/`<TableHead>`/`<TableHeader>`, has role="columnheader", textPreview contains ≥3 known header label tokens, matches known header labels ≤20 chars, has header styling on static text, or is purely static short text (≤20 chars) with no dynamic expression.

## Deduplication (v4)
Key format: `U3.{subCheck}|{filePath}|{lineNumber}|{columnLabel}`
