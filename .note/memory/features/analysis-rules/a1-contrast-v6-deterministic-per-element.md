# Memory: features/analysis-rules/a1-contrast-v6-deterministic-per-element
Updated: just now

Rule A1 (Contrast) is input-type aware and evaluates text elements individually across the entire application scope.

## Screenshot Input — Conditional Deterministic Evaluation

Screenshot input is ELIGIBLE for deterministic evaluation, but NOT guaranteed. Classification depends on sampling reliability:

**Confirmed (Blocking)** — when ALL criteria are met:
- Foreground sampled from interior glyph pixels (darkest 30-40% by luminance, excluding anti-aliased edges)
- Background sampled from adjacent uniform region of the same component
- Contrast ratio computed using WCAG relative luminance formula
- Recalculated contrast from reported hex differs from measured ratio by ≤0.2
- Confidence: 80-95%

**Potential Risk (Non-blocking)** — when reliable sampling is NOT possible:
- Gradients, image backgrounds, overlays, transparency
- Font smoothing artifacts causing high color variance
- colorAttributionUnreliable: true (recalculated differs >0.2)
- Do not report exact contrast ratio
- Confidence: 50-70%

**Borderline (Advisory, Non-blocking)**: Measured ratio 4.3:1–4.5:1 for normal text. Confidence: 70-80%.

## ZIP / GitHub Input — Always Potential Risk

Static code analysis ALWAYS classifies A1 as Potential Risk:
- Detect potentially risky color tokens (e.g., text-gray-400) tiered by Tailwind gray scale
- Do not infer final contrast ratios (background cannot be determined)
- Recommend screenshot upload for confirmation
- Confidence reduced: ZIP 90% of base, GitHub 85% of base

## Reporting Requirements (ALL A1 Findings)

Every A1 report MUST include:
1. **Location** — Page and component name (e.g., CourseCard → Credits badge)
2. **Issue Description** — Clear statement of what was detected
3. **Explanation** — Why this may/does violate WCAG (measured ratio OR reason for uncertainty)

## Language Rules

DO NOT:
- Repeat labels like "heuristic" or "non-blocking" in diagnosis text
- Use vague phrases like "based on visual inspection" when computation was performed
- Omit location details
- Include "does not block convergence" in explanations (handled by UI layer)

DO:
- Use precise, factual wording
- Ensure findings are concise and reproducible
- Include inputType field for all A1 findings
