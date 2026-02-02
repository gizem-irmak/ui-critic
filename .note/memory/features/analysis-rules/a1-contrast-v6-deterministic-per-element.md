# Memory: features/analysis-rules/a1-contrast-v13-interior-stroke-sampling

Updated: just now

Rule A1 (Insufficient Text Contrast) uses **interior-stroke sampling** for screenshot inputs to match what a user color-picker would measure on text strokes.

## Design Principle

**Screenshots are a source of truth for visual properties.**
Only reliable measurements can block convergence; unreliable measurements become advisory Potential Risks.

## Interior-Stroke Sampling Methodology

### Foreground (Text) Color
1. Sample 50-200 pixels from text region
2. Convert pixels to luminance
3. Select the **darkest 30-40%** of pixels (interior glyph strokes)
4. This excludes anti-aliased edges and halos
5. Use **median RGB** of this darkest subset as foreground color

### Background Color
1. Sample a small ring/frame around text region (expand bounding box by few pixels)
2. Exclude pixels that belong to text (dark subset from above)
3. Use **median RGB** of remaining pixels as background color

### Contrast Computation
- Use WCAG 2.1 relative luminance formula on sampled median RGB values
- Convert to hex for reporting (estimated from pixels, not verified tokens)
- **Never snap to palette tokens** (no Tailwind color mapping)

## Reliability Checks (All Must Pass for Confirmed)

| Check | Requirement | Failure Reason |
|-------|-------------|----------------|
| Hex-to-Ratio Verification | Recomputed ratio from hex matches measured ±0.2 | "Hex-to-ratio verification failed: measured X.X vs recomputed Y.Y" |
| Pixel Support | ≥15-20 foreground pixels | "Insufficient foreground pixels for reliable sampling" |
| Color Distance | ≥20 luminance units apart | "Foreground and background too similar for reliable measurement" |
| Foreground Variance | stddev(luminance) ≤ 15 | "Foreground variance too high — text rendering unstable" |
| Background Variance | stddev(luminance) ≤ 20 | "Background variance too high — non-uniform background" |
| Multi-Sample Consistency | 3 samples with 2-5px offset, ratios differ ≤ ±0.2 | "Multi-sample consistency failed: ratios varied by X.X" |

## Tri-State Classification

| Classification | Criteria | Status | Blocks Convergence | Confidence |
|----------------|----------|--------|-------------------|------------|
| **Confirmed Fail** | All checks pass + ratio < 4.0:1 | confirmed | YES | 85-95% |
| **Borderline** | Near-threshold (4.0-4.5:1) OR any check fails OR secondary element | borderline | NO | 50-75% |
| **Potential Risk** | Any reliability check fails + low contrast suspected | potential | NO | 50-75% |
| **Pass** | All checks pass + ratio ≥ 4.5:1 | - | - | - |

## Output Requirements

### Confirmed Fail (Reliable)
- `samplingMethod: "pixel"`
- `status: "confirmed"`
- Report `contrastRatio`, `foregroundHex`, `backgroundHex` (RAW sampled, not palette-mapped)
- Include `samplingReliability` object with all check results
- **Blocks convergence**

### Borderline / Potential Risk (Unreliable)
- `samplingMethod: "inferred"`
- `status: "borderline"` or `status: "potential"`
- `potentialRiskReason`: Specific failure reason
- `advisoryGuidance`: "Upload a PNG at 100% zoom or verify with DevTools/axe for accurate measurement."
- May include estimated hex but with uncertainty
- **NEVER blocks convergence**

## Forbidden Behaviors

- Do NOT snap sampled colors to Tailwind tokens or nearest palette color
- Do NOT output Confirmed when ANY reliability check fails
- Do NOT mark borderline ratios (4.0-4.5:1) as Confirmed
- Do NOT say "Exact color values cannot be determined from a screenshot"
- Do NOT assign confidence >75% to unreliable findings
- Do NOT group multiple unrelated elements under one finding

## ZIP / GitHub Inputs

Always `samplingMethod: "inferred"`, `status: "potential"`, 50-70% confidence.
Static code analysis cannot access rendered pixels.
