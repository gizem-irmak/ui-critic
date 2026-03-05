# Memory: features/analysis-rules/u3-content-accessibility-refinements
Updated: now

Rule U3 (Truncated or Inaccessible Content) includes modality-specific recovery logic and confidence weighting.

## Screenshot Recovery Suppression (v2)
For screenshots, U3 is suppressed when ANY recovery mechanism is detected in the same container:
- **Scrollbar**: Horizontal or vertical scrollbar visible → `recoveryObserved: "Scrollable region observed"` → SUPPRESS
- **Expand control**: "Show more" / "Expand" / "View all" → `recoveryObserved: "Expandable control observed"` → SUPPRESS
- **Tooltip**: Tooltip affordance confidently visible → `recoveryObserved: "Tooltip likely"` → SUPPRESS
- **Uncertain**: Recovery ambiguous → `recoveryObserved: "Uncertain"` → REPORT as Potential (confidence 0.55–0.65)
- **None**: No recovery found → `recoveryObserved: "None observed"` → REPORT as Potential (confidence 0.60–0.75)

Recovery detection scans ALL fields: evidence, diagnosis, recoveryObserved, u3Elements.recoverySignals, contextualHint.

Post-processing normalizes all `recoveryObserved` values to the 5-value enum above.

## Context-Aware Advisory
- Tables/lists/admin: "Use wrapping, tooltip, expandable cell, or responsive layout to ensure full values are accessible."
- Review/confirm: "Ensure long user-entered text wraps or can be expanded so users can fully verify inputs before submission."
- Default: "Ensure content is fully readable. Consider wrapping, tooltips, expandable sections, or scrollable regions."

## Programmatic Truncation (Code/ZIP)
For D7 findings suggesting intentional ID or token shortening (e.g., 'patient_id', 'uuid'), a 0.20 confidence penalty applies to prioritize meaningful content risks over privacy-driven truncation.
