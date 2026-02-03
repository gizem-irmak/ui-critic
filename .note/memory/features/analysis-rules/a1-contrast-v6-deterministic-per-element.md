# Memory: features/analysis-rules/a1-contrast-v15-luminance-suppression

Updated: just now

Rule A1 (Insufficient Text Contrast) uses **interior-stroke sampling with robust fallbacks and luminance-based suppression** for screenshot inputs.

## Design Principle

**Do not equate algorithmic uncertainty with accessibility risk.**
When sampling fails but luminance separation is clear, suppress the finding as PASS.

## Luminance Separation Suppression (NEW in v15)

When contrast measurement is inconclusive due to sampling issues (not actual low contrast), the finding is **suppressed entirely** (treated as PASS) if:

1. **Clear luminance separation** (≥50 luma units between foreground and background)
2. **Measured ratio ≥ 3.0:1** (not extremely low contrast)
3. **OR very high separation** (≥70 luma units regardless of other factors)

### Why This Works

- Anti-aliased text, shadows, pills, and rounded containers often cause sampling instability
- But if the foreground is **predominantly darker** than the background (or vice versa), the text is visually distinguishable
- Reporting "Potential Risk" for clearly readable text creates noise and undermines trust

### Suppression Logic

```typescript
if (lumaSeparation >= 50 && ratio >= 3.0) {
  // Clear separation — suppress finding
  return { suppress: true, reason: `Clear luminance separation (Δluma=${lumaSeparation})` };
}
if (lumaSeparation >= 70) {
  // Very high separation — always suppress
  return { suppress: true, reason: `Very high luminance separation (Δluma=${lumaSeparation})` };
}
```

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
  - **Needs Review**: range spans threshold (may be suppressed if luminance separation is clear)

## Interior-Stroke Sampling Methodology

### Foreground (Text) Color
1. Sample 160 pixels from text region grid
2. Convert pixels to luminance
3. Select the **darkest 30–40%** of pixels (interior glyph strokes)
4. Use **median RGB** of this darkest subset as foreground color

### Background Color
1. Sample ring around text region (expand by ringPx pixels)
2. Exclude pixels darker than foreground max luminance + 2
3. Apply fallback hierarchy if insufficient pixels
4. Use **median RGB** (or cluster centroid) as background color

## Reliability Checks (All Must Pass for Confirmed)

| Check | Requirement | Failure Action |
|-------|-------------|----------------|
| Multi-Sample Consistency | 3 samples with 2-5px offset, ratios differ ≤ ±0.2 | Check suppression, else mark unreliable |
| Hex-to-Ratio Verification | Recomputed ratio from hex matches measured ±0.2 | Check suppression, else mark unreliable |
| Pixel Support | ≥15 foreground pixels | Mark unreliable |
| Color Distance | ≥20 luminance units apart | Mark unreliable |
| Foreground Variance | stddev(luminance) ≤ 15 | Check suppression, else mark unreliable |
| Background Variance | stddev ≤ 20 (unless clustering used) | Check suppression, else apply clustering |

## Decision Tree

```
Measurement inconclusive?
├── YES: Check luminance separation
│   ├── Clear separation (Δluma ≥50 AND ratio ≥3.0, OR Δluma ≥70)?
│   │   └── SUPPRESS (treat as PASS)
│   └── Low separation (Δluma <30) OR luma overlap plausible?
│       └── Report as Potential Risk (non-blocking)
└── NO: Reliable measurement
    ├── Ratio < 4.0:1 AND no fallbacks → Confirmed Fail
    ├── Ratio 4.0–4.5:1 OR fallbacks used → Borderline
    └── Ratio ≥ 4.5:1 → PASS
```

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
| **Potential Risk** | Reliability check fails AND suppression not triggered | potential | NO |
| **Pass (suppressed)** | Reliability fails BUT clear luminance separation | - | - |
| **Pass** | Worst-case ratio ≥ threshold | - | - |

## Forbidden Behaviors

- Do NOT report A1 when luminance separation is clear despite sampling issues
- Do NOT equate algorithmic uncertainty with accessibility risk
- Do NOT output Confirmed when any fallback was used
- Do NOT snap sampled colors to Tailwind tokens
- Do NOT assign confidence >85% when fallbacks were used
```

## Forbidden Behaviors

- Do NOT stop with "unmeasurable" without trying all fallbacks
- Do NOT output Confirmed when any fallback was used
- Do NOT snap sampled colors to Tailwind tokens
- Do NOT assign confidence >85% when fallbacks were used
