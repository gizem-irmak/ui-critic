# Memory: features/analysis-rules/a1-contrast-v11-robust-clustering

Updated: just now

Rule A1 (Insufficient Text Contrast) uses **robust pixel clustering** for screenshot inputs to avoid false positives from anti-aliasing and palette quantization.

## Design Principle

**Screenshots are a source of truth for visual properties.**
Use clustering-based sampling to match what a user color-picker would measure on the text stroke.

## Robust Pixel Clustering Methodology (Screenshots)

1. **Sample many pixels**: Collect 50-200 pixels from the text region
2. **Cluster into fg/bg (k=2)**: Using luminance thresholding or k-means
3. **Identify foreground**: Darkest stable cluster = core glyph strokes (interior pixels)
4. **Exclude anti-aliased edges**: Pixels with intermediate luminance between clusters
5. **Compute median RGB**: From the darkest cluster only
6. **Report RAW sampled hex**: Never map to Tailwind tokens or nearest palette color

## Sampling Reliability Checks (Mandatory)

| Check | Threshold | Action if Failed |
|-------|-----------|------------------|
| Foreground variance | stddev(luminance) > 15 | Demote to Potential Risk |
| Background variance | stddev(luminance) > 20 | Demote to Potential Risk |
| Cluster separation | gap < 20 luminance units | Demote to Potential Risk |
| Cluster overlap | pixels fall between clusters | Demote to Potential Risk |

## Classification Rules

| Reliability | Sampling Method | Status | Confidence |
|-------------|-----------------|--------|------------|
| Passes all checks | pixel | confirmed | 85–95% |
| Any check fails | inferred | potential | 50–70% |

## Confirmed Violation (Reliable Clustering)

When sampling reliability passes:
- `samplingMethod: "pixel"`
- `status: "confirmed"` (if ratio < 4.5:1)
- Report RAW `foregroundHex`, `backgroundHex` (NOT palette-mapped)
- Report `contrastRatio`
- Verification: "Contrast ratio computed from sampled screenshot pixels."

## Potential Risk (Sampling Unreliable)

When reliability check fails:
- `samplingMethod: "inferred"`
- `status: "potential"`
- `potentialRiskReason`: "Foreground/background separation unstable due to font rendering or anti-aliasing"
- NO exact `contrastRatio` or hex values

## Forbidden Behaviors

- Do NOT map sampled colors to Tailwind tokens or "nearest palette color" in Confirmed mode
- Do NOT output Confirmed ratio when cluster separation is unstable
- Do NOT say "Exact color values cannot be determined from a screenshot"

## ZIP / GitHub Inputs

Always `samplingMethod: "inferred"`, `status: "potential"`, 50–70% confidence.
