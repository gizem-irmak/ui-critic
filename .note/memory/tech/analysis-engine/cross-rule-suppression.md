# Memory: tech/analysis-engine/cross-rule-suppression
Updated: now

Cross-rule suppression runs AFTER per-rule aggregation, BEFORE final response assembly in all three edge functions (analyze-zip, analyze-github, analyze-ui). Implemented in `supabase/functions/_shared/cross-rule-suppression.ts`.

## Architecture
- `applyCrossRuleSuppression(violations[])` → `{ kept[], suppressedElements[] }`
- Operates on aggregated violation cards; removes sub-items from subordinate rules when a dominant rule covers the same element.
- Suppressed items are NOT deleted; stored as `SuppressedElement` with `SuppressionMeta` (suppressedBy, rationale, appliedRule) for auditing.

## Element Matching
Elements are matched across rules via: deduplicationKey equality, location + elementLabel match, or selectorHint/evidence substring overlap.

## Pairwise Suppression Rules (S1–S10)
- **S1**: A5 suppresses A6 on same form control (missing label is root cause)
- **S2**: A3 suppresses A2 on same element when keyboard-unreachable (focus visibility moot)
- **S3**: A1 suppresses U6 when contrast causes grouping confusion
- **S4**: A3 suppresses U2 on same navigation element with keyboard issue
- **S5**: U4 suppresses U1 when recall needed for action
- **S6**: U3 suppresses U6 when overflow/truncation is root cause
- **S7**: E2 suppresses U1 in same decision point (choice imbalance)
- **S8**: E2 suppresses E1 when manipulation is central
- **S9**: E3 suppresses U2 when restricted exit/control
- **S10**: E2 suppresses E3 when E3 is merely visual hiding; **S10-rev**: E3 suppresses E2 when E3 is functional restriction

## Global Fallback Priority
When no pairwise rule matches: A* > E* > U*. Within same category, higher specificity wins (A5>A3>A6>A2>A4>A1, E2>E3>E1, U3>U4>U2>U6>U5>U1). Fallback skips dominant elements that were themselves suppressed by pairwise rules.

## Tests
`supabase/functions/analyze-zip/cross-rule-suppression.test.ts` — 8 test cases covering S1, S2, S5, S6, S7, S10, S10-rev, fallback, and no-suppression scenarios.
