# Memory: features/analysis-rules/u3-content-accessibility
Updated: now

Rule U3 (Truncated or Inaccessible Content) evaluates content visibility via hybrid detection.
- Sub-checks: U3.D1 (Ellipsis/Line-clamp), U3.D2 (Overflow clipping), U3.D3 (Nested scroll traps), U3.D4 (Hidden content), and U3.D5 (Unbroken text overflow risk).
- Refinement Heuristics: Static text ≤ 18 characters is suppressed for truncation. Hidden content detection (U3.D4) excludes responsive variants (e.g., 'md:hidden') and intentional 'aria-hidden' elements.

## Strict Evidence Binding (D5)
- D5 now uses **carrier element scoping**: it finds the JSX element directly containing the dynamic text (`u3FindCarrierElement`) and only checks classes on that element and its immediate parent (`u3FindParentElement`).
- Classes from sibling elements (e.g., other `<td>` cells in the same row) are NOT considered.
- Element attribution reports the actual tag that carries the truncation class, not unrelated components.

## Component-Level Expand Detection
- `u3HasComponentExpandForVar` searches the entire component/file for the same variable field rendered without truncation elsewhere (e.g., `selectedMsg.subject` in a detail view).
- Also detects onClick → setSelected patterns with corresponding detail views.
- Dialog/Drawer/Modal expansion detection for full-content views.
- If expand mechanism found → finding is suppressed entirely.

## U3.D5 Risk Tiers
- Evaluates dynamic variables by semantic risk. High-risk (reason, notes, bio, subject, description, message, body, comment, details, address) flags with any strong constraint on carrier/parent; Medium-risk (specialty, title, label) requires 'truncate' or 'nowrap' on carrier/parent; Low-risk (status, date, time, id, num, type) is suppressed unless both 'truncate' and 'overflow-hidden' are present on carrier/parent.
- Confidence: Base 0.70, adjusted by tier and signals. Findings with confidence < 0.65 are suppressed.
- Deduplication: Merges overlapping signals (truncate + overflow) for the same field, prioritizing line-clamp > truncate > unbroken-overflow. Max 3 items per file for D5, max 5 total per file post-dedup.
- UI: Includes an 80–120 character 'Text preview' and an 'Element' section detailing truncation type, text length, and 'expandDetected' status.
