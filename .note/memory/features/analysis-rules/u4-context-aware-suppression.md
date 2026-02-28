# Memory: features/analysis-rules/u4-context-aware-suppression
Updated: now

Rule U4 (Recognition-to-Recall Regression) implements multi-layered context-aware suppression:

1. **Pagination suppression**: Controls without visible page context ("Page X of Y", item range, total count) within ±15 lines are flagged; if context exists, U4 is suppressed.

2. **Standard auth CTA exclusion**: "Sign In", "Sign Up", "Go to Dashboard" etc. are filtered from evidence bundles to prevent false positives.

3. **Multi-step flow analysis** (new): The evidence bundle now extracts:
   - `stepCount`: estimated number of steps in the flow
   - `hasBackwardNavigation`: whether Previous/Back buttons exist
   - `hasSummaryStep`: whether a review/confirm/summary step renders prior selections
   - `hasPersistentContext`: whether selected values (selectedLocation, selectedDoctor, etc.) are visibly displayed across steps
   - `hasStepIndicator`: whether "Step X of Y" or progress bars exist
   - `multiStepMitigation`: computed level — `none`, `summary_final`, `persistent_context`, or `full`

4. **Mitigation-based suppression/downgrade**:
   - `full` or `persistent_context` → SUPPRESS entirely
   - `summary_final` + backward nav → downgrade to confidence 0.50–0.60, use language "Summary provided only at final step; intermediate steps may require recall of prior selections"
   - `none` → flag normally (confidence 0.75–0.80)

5. **Confidence calibration**:
   - 0.75–0.80: No summary + no backward nav + no step indicator + generic CTAs
   - 0.60–0.70: Summary only at final step, no backward nav
   - 0.50–0.60: Summary at final step AND backward nav exists
   - SUPPRESS: Persistent context across steps OR full mitigation
