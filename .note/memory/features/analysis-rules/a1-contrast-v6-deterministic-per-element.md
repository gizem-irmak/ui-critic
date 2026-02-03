# Memory: features/analysis-rules/a1-contrast-v14-fallback-strategies

Updated: just now

Rule A1 (Insufficient Text Contrast) uses **interior-stroke sampling with robust fallbacks** for screenshot inputs to handle challenging backgrounds.

## Design Principle

**Screenshots are a source of truth for visual properties.**
When direct sampling fails, apply fallback strategies before marking as unmeasurable.

## Fallback Hierarchy

When initial sampling fails to obtain sufficient background pixels:

### 1. Auto-Expand Sampling Region
- Progressively expand ring around text: +3px → +8px → +16px → +32px
- Stop when ≥15 non-text pixels are available
- Mark as `fallbackMethod: "expanded"` with `expansionPx` value

### 2. Color Clustering (k-means, k=2-3)
- Applied when background variance > 20 stddev
- Select largest cluster as primary background
- Mark as `fallbackMethod: "clustered"` with `clusterCount`

### 3. Contrast Range Calculation
- When multiple significant clusters exist (≥15% of pixels each)
- Compute contrast against all background candidates
- Report `contrastRange: { min, max }` instead of single ratio
- Classification:
  - **PASS**: worst-case (min) ≥ 4.5:1
  - **FAIL**: best-case (max) < 4.5:1
  - **Needs Review**: range spans threshold

## Interior-Stroke Sampling Methodology

### Foreground (Text) Color
1. Sample 160 pixels from text region grid
2. Convert pixels to luminance
3. Select the **darkest 30-40%** of pixels (interior glyph strokes)
4. Use **median RGB** of this darkest subset as foreground color

### Background Color
1. Sample ring around text region (expand by ringPx pixels)
2. Exclude pixels darker than foreground max luminance + 2
3. Apply fallback hierarchy if insufficient pixels
4. Use **median RGB** (or cluster centroid) as background color

## Reliability Checks (All Must Pass for Confirmed)

| Check | Requirement | Failure Action |
|-------|-------------|----------------|
| Multi-Sample Consistency | 3 samples with 2-5px offset, ratios differ ≤ ±0.2 | Mark unreliable |
| Hex-to-Ratio Verification | Recomputed ratio from hex matches measured ±0.2 | Mark unreliable |
| Pixel Support | ≥15 foreground pixels | Mark unreliable |
| Color Distance | ≥20 luminance units apart | Mark unreliable |
| Foreground Variance | stddev(luminance) ≤ 15 | Mark unreliable |
| Background Variance | stddev ≤ 20 (unless clustering used) | Apply clustering fallback |

## Confidence Penalties

| Fallback Method | Confidence Penalty |
|-----------------|-------------------|
| Direct sampling | 0% |
| Expanded region | -8% |
| Color clustering | -12% |
| Range-based | -15% |
| Unreliable | -25% to -40% |

## Tri-State Classification

| Classification | Criteria | Status | Blocks Convergence |
|----------------|----------|--------|-------------------|
| **Confirmed Fail** | All checks pass + no fallbacks + ratio < 4.0:1 | confirmed | YES |
| **Borderline** | Near-threshold OR secondary element OR fallback used | borderline | NO |
| **Potential Risk** | Any reliability check fails | potential | NO |
| **Pass** | Worst-case ratio ≥ threshold | - | - |

## Output Structure

```typescript
{
  contrastRatio?: number;          // Primary measured ratio
  contrastRange?: { min, max };    // For range-based measurements
  samplingFallback?: {
    method: string;                // 'direct ring sampling', 'expanded region (+16px)', etc.
    expansionPx?: number;
    clusterCount?: number;
    rangeSpansThreshold?: boolean;
  };
  samplingReliability?: {
    pixelSupport: string;
    foregroundVariance: string;
    backgroundVariance: string;
    colorDistance: string;
    hexVerification: string;
    multiSampleConsistency: string;
    fallbackMethod: string;
  };
}
```

## Forbidden Behaviors

- Do NOT stop with "unmeasurable" without trying all fallbacks
- Do NOT output Confirmed when any fallback was used
- Do NOT snap sampled colors to Tailwind tokens
- Do NOT assign confidence >85% when fallbacks were used
