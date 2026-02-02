# Memory: features/analysis-rules/a1-contrast-v10-pixel-sampling-first
Updated: just now

Rule A1 (Insufficient Text Contrast) prioritizes **pixel-based sampling** for screenshot inputs.

## Design Principle

**Screenshots are a source of truth for visual properties.**
Pixel-based contrast calculation is the DEFAULT for screenshot inputs.

## Pixel Sampling First (Mandatory for Screenshots)

For screenshot inputs, ALWAYS attempt pixel-level sampling FIRST:

1. **Sample foreground (text) color**: Interior glyph pixels, averaged RGB (exclude anti-aliased edges)
2. **Sample background color**: Immediate area behind text, uniform adjacent region
3. **Compute contrast ratio**: WCAG 2.1 relative luminance formula

## Classification Based on Sampling Success

| Background Type        | Sampling Method | Status    | Confidence |
|------------------------|-----------------|-----------|------------|
| Solid/uniform color    | pixel           | confirmed | 85–95%     |
| Gradient/image/overlay | inferred        | potential | 50–70%     |

## Confirmed Violation (Pixel-Sampled)

When pixel sampling succeeds:
- `samplingMethod: "pixel"`
- `status: "confirmed"` (if ratio < 4.5:1) or `"borderline"` (if 4.3–4.5:1)
- Report `contrastRatio`, `foregroundHex`, `backgroundHex`, RGB values
- Verification: "Pixel-based screenshot analysis."
- **Do NOT label as heuristic or potential risk**

## Potential Risk (Only When Sampling Truly Fails)

Report as Potential Risk ONLY if:
- Background is gradient, image, or complex pattern
- Text overlays transparent/semi-transparent areas
- Foreground/background cannot be isolated

Output:
- `samplingMethod: "inferred"`
- `status: "potential"`
- `potentialRiskReason`: explain why sampling failed
- NO exact `contrastRatio`

## Forbidden Messaging

DO NOT SAY for screenshot inputs:
- "Exact color values cannot be determined from a screenshot"
- "Contrast is ambiguous based on visual inspection"
- "Cannot measure contrast from visual inspection alone"

## ZIP / GitHub Inputs

Always `samplingMethod: "inferred"`, `status: "potential"`, 50–70% confidence.
