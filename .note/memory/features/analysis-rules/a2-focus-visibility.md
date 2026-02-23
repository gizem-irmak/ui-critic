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

## Screenshot (LLM-Assisted Mode) — Three-Tier Classification

1. **Not Evaluated (status: "informational"):**
   - Screenshot does NOT display any element in a focused state
   - reason: "Focus state not observable in provided screenshot."
   - confidence: 0
   - Renders in "Rules Not Evaluated" section

2. **Potential (status: "potential"):**
   - Screenshot DOES show a focused element but that element lacks a visible indicator
   - reason: "No visible focus indicator observed."
   - confidence: 0.55-0.75

3. **No Finding:**
   - Screenshot shows visible focus indicators on focused elements → PASS

- NEVER mark screenshot A2 as confirmed.
- detectionMethod: 'llm_assisted'

## Policy

- No-downgrade policy applies only within the same modality
- Screenshot findings cannot override deterministic Confirmed findings
- UI shows detection method (Deterministic / LLM-Assisted) and WCAG 2.4.7 reference
- Each element includes `detectionMethod` and `potentialReason` fields
