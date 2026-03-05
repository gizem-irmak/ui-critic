# Memory: features/analysis-rules/u4-recognition-to-recall-regression
Updated: now

Rule U4 (Recognition-to-Recall Regression) identifies cognitive load shifts from recognition to recall. It is strictly gated to finite categorical domains (e.g., specialty, country, role) and excludes freeform narrative fields. Deliberate safety-friction patterns (e.g., 'Type DELETE to confirm') are subject to hard suppression if the required phrase is visibly displayed in the immediate UI context. The rule uses a deterministic candidate extraction pass with an optional suppression-only LLM validator. All findings are Potential-only (Non-blocking) with a 0.65 confidence cap (standard) or up to 0.75 if LLM-validated. Evidence text highlights the mechanism where users must recall valid values instead of selecting from a list.

## Screenshot Modality
- **Classification**: Always Potential (never Confirmed) — screenshots cannot verify input types or categorical domain bindings.
- **Detection**: LLM visual reasoning assessing whether the UI requires users to recall information from memory rather than recognize it from visible options.
- **Deterministic checks disabled**: Code-based candidate extraction and domain detection are not executed for screenshot inputs.
- **Confidence gating**: confidence ≥ 60% → report as Potential; confidence < 60% → suppress entirely (aligned with global perceptual policy).
- **Confidence cap**: Screenshot U4 confidence is capped at 0.75 due to absence of code-level verification.
- **Cross-rule suppression**: U3 may suppress U4 when truncation causes the recall burden. U5 may suppress U4 when missing interaction feedback is the underlying issue.
- **Advisory**: "Visual analysis suggests a potential recognition-to-recall regression; verify by interacting with the interface."
