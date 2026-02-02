# Memory: features/analysis-rules/a1-contrast-v8-sampling-method-enforcement
Updated: just now

Rule A1 (Contrast) explicitly tracks `samplingMethod` to distinguish pixel-sampled vs inferred color evaluations.

## Sampling Method Field (Mandatory)

Every A1 finding MUST include `samplingMethod`:
- **"pixel"** — Colors sampled directly from screenshot pixels (interior glyph strokes + adjacent background)
- **"inferred"** — Colors derived from tokens, palette values, class names, or approximations

## Pixel-Sampled (Can Confirm)

ONLY `samplingMethod: "pixel"` can produce Confirmed Pass/Violation status.

**Criteria for pixel-sampled:**
1. Text region detected (OCR/visual)
2. Multiple interior glyph pixels sampled (darkest 30-40% by luminance)
3. Anti-aliased edge pixels excluded
4. Background sampled from uniform adjacent region (5-10+ pixels)
5. Low color variance in background region
6. Median RGB computed for both foreground and background
7. Recalculated contrast from hex differs from measured by ≤0.2

**Output fields for pixel-sampled:**
- `samplingMethod: "pixel"`
- `status: "confirmed"` or `"borderline"`
- `contrastRatio` (measured value)
- `foregroundRgb`, `backgroundRgb`, `foregroundHex`, `backgroundHex`
- Confidence: 80–95%
- Verification line: "Contrast ratio computed from sampled screenshot pixels."

## Inferred (Cannot Confirm)

`samplingMethod: "inferred"` when ANY of:
- Colors mapped from CSS classes/tokens
- Colors snapped to nearest palette value
- Single pixel sampled (insufficient)
- Edge/blended pixels used
- Background assumed without verification
- High variance (gradients, overlays, images)
- `colorAttributionUnreliable: true`

**Output for inferred:**
- `samplingMethod: "inferred"`
- `status: "potential"` (always)
- NO `contrastRatio` (not reliably computable)
- NO `foregroundRgb`/`backgroundRgb` (not reliably sampled)
- `potentialRiskReason`: explains why pixel sampling failed
- Confidence: 50–70%

## Input Type Rules

| Input      | samplingMethod      | Status                | Confidence |
|------------|---------------------|-----------------------|-----------:|
| Screenshot | pixel (if criteria met) | Confirmed/Borderline | 80–95%    |
| Screenshot | inferred            | Potential Risk        | 50–70%    |
| ZIP        | inferred (always)   | Potential Risk        | 50–70%    |
| GitHub     | inferred (always)   | Potential Risk        | 50–70%    |

## Forbidden Behaviors

- Never claim confirmed WCAG failure unless `samplingMethod: "pixel"`
- Never assign confidence >70% to inferred results
- Never report exact contrast ratios when inferred
- Never omit `samplingMethod` field
- Never snap colors to design tokens and present as measured
