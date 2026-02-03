# Memory: features/analysis-rules/a1-contrast-v19-worst-case-bounding

Updated: just now

Rule A1 (Insufficient Text Contrast) implements **worst-case contrast bounding** for screenshot analysis to prevent false passes while still suppressing inconclusive measurements.

## Core Principle

**Use conservative worst-case colors to decide suppression.** Do not suppress solely because measurement is unstable — only suppress when worst-case contrast meets threshold.

## 1. Worst-Case Color Estimation

### Foreground (FG_worst): Lightest Plausible Stroke Color
1. Sample 160 pixels from text region grid
2. Select darkest 30-40% by luminance (interior strokes, exclude anti-aliased edges)
3. **FG_worst = 80-85th percentile luminance** among these stroke pixels
4. This is the lightest plausible text color (conservative bound)

### Background (BG_worst): Lightest Plausible Background
1. Sample ring around text region with progressive expansion (3→32px)
2. Exclude pixels darker than foreground max luminance + 2
3. **BG_worst = 80-90th percentile luminance** among background pixels
4. This is the lightest plausible background (conservative bound)

### Contrast Computation
- **contrast_worst = contrast(FG_worst, BG_worst)**
- Also compute median-based ratio for reporting

## 2. Suppression Decision (Primary Rule)

| Condition | Action |
|-----------|--------|
| **contrast_worst < 4.0:1** | DO NOT suppress → Report as **Confirmed Fail** |
| **4.0 ≤ contrast_worst < 4.5** | DO NOT suppress → Report as **Fail** |
| **contrast_worst ≥ 4.5:1** | Suppress → PASS (no report) |

**Key insight**: If even the lightest plausible color pair fails threshold, the finding is real — report it regardless of sampling noise.

## 3. Additional Safeguards (Never Suppress)

| Condition | Action |
|-----------|--------|
| Range-based `max < 4.5` | Report as failure |
| Both colors "light" (luma > 150) + ratio < 3.5 + separation < 50 | Report |
| Both colors "dark" (luma < 100) + ratio < 3.5 + separation < 50 | Report |

## 4. 7-Point Reliability Gate (for Confirmed status)

All checks must pass for highest confidence:

| Check | Requirement | If Failed |
|-------|-------------|-----------|
| Multi-sample consistency | 3 offset samples, ratio variance ≤ 0.2 | Reduced confidence |
| Hex verification | Recomputed contrast delta ≤ 0.2 | Reduced confidence |
| Foreground pixel count | ≥ 15 pixels | Error |
| Background pixel count | ≥ 15 pixels | Error |
| Luminance distance | ≥ 20 units | Reduced confidence |
| Foreground variance | stddev ≤ 15 | Reduced confidence |
| Background variance | stddev ≤ 20 (unless clustering) | Reduced confidence |

## 5. Reporting Structure

For each finding, report:
1. **Element description** (e.g., "credits badge label in course card")
2. **Measured contrast ratio** (median-based)
3. **Worst-case contrast** (percentile-based conservative bound)
4. **Foreground/background hex** (median RGB converted)
5. **Worst-case colors** (fgWorstHex, bgWorstHex)
6. **Individual confidence score**

## 6. Fallback Strategies

When direct ring sampling fails:
1. **Expanded region**: +8px, +16px, +32px expansion
2. **Color clustering**: k-means for high-variance backgrounds
3. **Range-based**: Report min/max contrast for mixed backgrounds

## Forbidden Behaviors

- Do NOT suppress based solely on measurement instability
- Do NOT suppress when worst-case contrast < 4.5:1
- Do NOT report aggregate counts ("X elements could not be measured")
- Do NOT report anonymous elements without description/location
- Do NOT snap sampled colors to Tailwind tokens
