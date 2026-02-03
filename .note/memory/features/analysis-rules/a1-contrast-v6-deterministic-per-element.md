# Memory: features/analysis-rules/a1-contrast-v17-strict-suppression

Updated: just now

Rule A1 (Insufficient Text Contrast) enforces **strict suppression** when contrast cannot be reliably measured. Algorithmic uncertainty is treated as **PASS** (no report), not as an accessibility risk.

## Core Principle

**Only report A1 when a contrast failure can be reliably measured and attributed to a specific UI element.**

If contrast measurement fails due to technical limitations, suppress the finding entirely rather than reporting it under "Potential Risks." Do NOT equate algorithmic uncertainty with accessibility risk.

## Strict Suppression Policy

A1 findings are **suppressed (treated as PASS)** when:

### Suppression Triggers

| Condition | Action |
|-----------|--------|
| Luminance separation ≥ 60 | Always suppress (clearly readable) |
| Luminance separation ≥ 40 AND ratio ≥ 2.5 | Suppress (distinguishable text) |
| Luminance separation ≥ 25 AND ratio ≥ 3.0 | Suppress (not plausible failure) |
| Background variance high, foreground stable, separation ≥ 30 | Suppress (complexity issue, not contrast) |
| Range-based worst-case ≥ 4.5:1 | Suppress (passes threshold) |
| Measurement error (insufficient pixels) | Suppress (no aggregate counts) |
| Any unreliable measurement | Suppress (uncertainty = PASS) |

### DO NOT Suppress (Low Contrast Plausible)

| Condition | Action |
|-----------|--------|
| Luminance separation < 25 AND high variance on fg/bg | Do NOT suppress (overlap risk) |
| Luminance separation < 20 | Do NOT suppress (possible low contrast) |
| Range-based best-case < 4.5:1 | Do NOT suppress (clear failure) |
| Ratio < 3.5 AND separation < 35 | Do NOT suppress (marginal) |

## What is NOT Reported

- **Aggregate counts**: No "7 elements could not be measured"
- **Anonymous findings**: No findings without element-level specificity
- **Potential Risks for A1**: When measurement is uncertain, suppress entirely
- **Technical limitation disclaimers**: Do not surface sampling uncertainty to users

## Element-Level Specificity (for Reported Findings)

When A1 IS reported (reliable measurement, clear failure), it must include:

1. **Descriptive label** (e.g., "credits badge label", "page subtitle")
2. **Approximate location** (e.g., "course card", "header section")
3. **Measured contrast ratio** (pixel-sampled value)
4. **Individual confidence score**

## Classification (for Reported Findings Only)

| Classification | Criteria | Blocks Convergence |
|----------------|----------|-------------------|
| **Confirmed Fail** | Reliable sampling + ratio < 4.0:1 + no fallbacks | YES |
| **Borderline** | Reliable + near threshold (4.0–4.5) OR secondary element OR fallback used | NO |

Note: "Potential Risk" status is no longer emitted for A1. Unreliable measurements are suppressed.

## Interior-Stroke Sampling Methodology

When measurement IS reliable:

### Foreground (Text) Color
1. Sample 160 pixels from text region grid
2. Select the **darkest 30–40%** of pixels (interior glyph strokes)
3. Use **median RGB** of this darkest subset as foreground color

### Background Color
1. Sample ring around text region (progressive expansion: 3→8→16→32px)
2. Exclude pixels darker than foreground max luminance + 2
3. Apply clustering for high-variance backgrounds

## 7-Point Reliability Gate

All checks must pass for "reliable" classification:
1. Multi-sample consistency (ratio variance ≤ 0.2)
2. Hex verification (recomputed delta ≤ 0.2)
3. Foreground pixel count ≥ 15
4. Background pixel count ≥ 15
5. Luminance distance ≥ 20
6. Foreground variance stddev ≤ 15
7. Background variance stddev ≤ 20 (unless clustering used)

## Forbidden Behaviors

- Do NOT report A1 "Potential Risks" — suppress unreliable measurements entirely
- Do NOT report aggregate counts ("2 elements could not be measured")
- Do NOT report anonymous elements without description/location
- Do NOT equate algorithmic uncertainty with accessibility risk
