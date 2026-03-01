# Memory: features/analysis-rules/u4-context-aware-suppression
Updated: now

Rule U4 (Recognition-to-Recall Regression) was rewritten with a 4-subtype pipeline:

## Subtypes

1. **U4.1 — Structured Selection → Free-Text Substitution** (Hybrid: deterministic + LLM)
   - Detects `<input type="text">` / `<textarea>` with semantic labels (category, type, status, etc.) where no `<Select>`, `<RadioGroup>`, `<Combobox>`, or `<datalist>` exists nearby (±30 lines).
   - **Confirmed** if no selection component exists anywhere in the file.
   - **Potential** if selection components exist elsewhere in the file.
   - LLM confirms/dismisses/adjusts deterministic candidates via `[U4_1_CANDIDATES]` bundle.
   - Excluded: free-form labels (notes, description, message), optional fields, fields with autocomplete.

2. **U4.2 — Hidden or Non-Persistent Selection State** (Deterministic)
   - Detects `<Tabs>`, `<ToggleGroup>` etc. without active state indicators (bg-primary, aria-selected, isActive, etc.) within ±20 lines.
   - Always **Potential**. Confidence: 0.65.

3. **U4.3 — Multi-Step Context Regression** (Deterministic)
   - Detects multi-step flows (stepCount ≥ 2) missing: step indicator, back navigation, summary/review, or persistent context.
   - Suppressed if persistent context OR (summary + back nav + step indicator) all exist.
   - Confidence scaled by missing mitigations: 0.60 (1 missing) → 0.75 (3+ missing).
   - Always **Potential**.

4. **U4.4 — Generic or Context-Free Action Labels** (LLM-assisted)
   - Evaluates generic CTAs ("Next", "Continue", "Submit") that transition steps or commit data.
   - Only flagged if no adjacent context describes the action.
   - Standard auth CTAs excluded. Always **Potential**. Confidence: 0.55–0.70.

## Architecture

- **Deterministic-first**: U4.1 candidates, U4.2, U4.3 run before LLM call.
- **Evidence bundles**: `[U4_1_CANDIDATES]` and `[U4_4_EVIDENCE]` sent to LLM.
- **Post-processing**: Merges deterministic U4.2/U4.3 + LLM U4.1/U4.4. Splits into confirmed and potential aggregated violations.
- **Confirmed U4.1** findings block convergence; all other subtypes are non-blocking.

## False Positive Prevention

- Never trigger based solely on: `<input type="text">` presence, absence of step indicator without multi-step logic, minimalist styling, truncation (U3 scope), or short labels alone.
- If uncertainty > 40%, classify as Potential.
- Free-form labels, optional fields, and fields with autocomplete/suggestions are excluded from U4.1.
