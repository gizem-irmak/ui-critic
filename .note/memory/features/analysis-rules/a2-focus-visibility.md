# Memory: features/analysis-rules/a2-focus-visibility
Updated: now

Rule A2 (Poor Focus Visibility) uses refined classification logic with epistemic clarity:

## ZIP/GitHub (Deterministic Mode)

**Confirmed (Blocking):**
- Explicit focus suppression detected (outline-none, ring-0, :focus{outline:none})
- AND **no** valid replacement focus style present
- Valid replacements: focus:ring-*, focus-visible:ring-*, focus:border-*, focus-visible:border-*, focus:shadow-*, focus-visible:shadow-*, focus:bg-*, focus-visible:bg-*
- If ANY valid replacement exists → DO NOT mark confirmed
- Confidence: 90-95%

**Potential (Non-blocking):**
- Suppression + replacement exists but perceptibility cannot be statically verified
- Examples: ring-1 with muted color, bg-only change, shadow-sm only
- OR: Interactive elements with no explicit focus styles detected
- "Do NOT assume subtle styling equals invisible"
- Confidence: 60-75%

**Pass (Skip):**
- No suppression, or strong replacement (ring-2+, border, outline, shadow-md+)

## Screenshot (LLM-Assisted Mode)

- ALWAYS status="potential", NEVER confirmed
- LLM detects interactive elements and checks for visible focus indicators
- If no focused state shown: reason="Focus visibility cannot be verified from static screenshot."
- If focused element shown but no indicator: reason="No visible focus indicator observed."
- detectionMethod: 'llm_assisted'

## Policy

- No-downgrade policy applies only within the same modality
- Screenshot findings cannot override deterministic Confirmed findings
- UI shows detection method (Deterministic / LLM-Assisted) and WCAG 2.4.7 reference
- Each element includes `detectionMethod` and `potentialReason` fields

## Critical Bug Fixed

The screenshot A2 prompt was previously mislabeled as "Small body font size" instead of "Poor focus visibility" — now corrected to properly detect focus visibility issues in screenshots.
