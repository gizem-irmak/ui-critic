# Memory: features/analysis-rules/a1-contrast-v18-robust-screenshot-detection

Updated: just now

Rule A1 (Insufficient Text Contrast) implements **robust pixel-based detection** for screenshot-only UI evaluation. The methodology uses interior-stroke sampling to reliably measure contrast without DOM or CSS access.

## Core Principle

**Report A1 only when a contrast failure can be reliably measured and attributed to a specific UI element.** Suppress findings when measurement is unreliable AND failure is not visually plausible. However, **NEVER suppress obvious low-contrast failures** even with minor sampling noise.

## 1. Interior-Stroke Sampling Methodology

### Foreground (Text) Color
1. Sample 160 pixels from text region grid
2. Convert all pixels to luminance
3. **Select the DARKEST 30–40%** of pixels by luminance (interior glyph strokes)
4. This excludes anti-aliased edges which have intermediate luminance values
5. Use **median RGB** of this darkest subset as foreground color
6. Report RAW sampled hex — never snap to design tokens

### Background Color
1. Sample pixels from narrow ring surrounding text region
2. Start with 3px ring, progressively expand: 3→8→16→32px if needed
3. Exclude pixels darker than foreground max luminance + 2
4. Apply k-means clustering for high-variance backgrounds
5. Use **median RGB** of remaining pixels as background

## 2. Contrast Computation

- Use WCAG 2.1 relative luminance formula on sampled median RGB
- Treat all reported colors as pixel-derived estimates
- Threshold: 4.5:1 for normal text, 3.0:1 for large text (≥18px or ≥14px bold)
- Do NOT normalize or snap colors to design tokens

## 3. 7-Point Reliability Gate

All checks must pass for "reliable" (Confirmed) classification:

| Check | Requirement | If Failed |
|-------|-------------|-----------|
| Multi-sample consistency | 3 offset samples, ratio variance ≤ 0.2 | Unreliable |
| Hex verification | Recomputed contrast delta ≤ 0.2 | Unreliable |
| Foreground pixel count | ≥ 15 pixels | Unreliable |
| Background pixel count | ≥ 15 pixels | Unreliable |
| Luminance distance | ≥ 20 units | Unreliable |
| Foreground variance | stddev ≤ 15 | Unreliable |
| Background variance | stddev ≤ 20 (unless clustering used) | Unreliable |

## 4. Decision Rules (Strict)

### Classification

| Status | Criteria | Blocks Convergence |
|--------|----------|-------------------|
| **Confirmed Fail** | All reliability checks pass + ratio < 4.0:1 + no fallbacks | YES |
| **Borderline** | Near threshold (4.0–4.5) OR secondary element OR fallback used | NO |
| **Pass (No Report)** | ratio ≥ 4.5:1 OR sampling uncertain but failure implausible | — |

### Suppression Policy

Suppress A1 finding entirely (treat as PASS) when:

| Condition | Action |
|-----------|--------|
| Luminance separation ≥ 60 | Always suppress (clearly readable) |
| Luminance separation ≥ 40 AND ratio ≥ 2.5 | Suppress (distinguishable text) |
| Luminance separation ≥ 25 AND ratio ≥ 3.0 | Suppress (not plausible failure) |
| Background variance high, foreground stable, separation ≥ 30 | Suppress (complexity issue) |
| Range-based worst-case ≥ 4.5:1 | Suppress (passes threshold) |
| Measurement error (insufficient pixels) | Suppress (no aggregate counts) |

### Obvious-Failure Safeguard — NEVER Suppress

| Condition | Action |
|-----------|--------|
| Ratio < 3.0 AND separation < 35 | DO NOT suppress (obvious failure) |
| Both colors "light" (luma > 150), separation < 40, ratio < 4.0 | DO NOT suppress |
| Both colors "dark" (luma < 100), separation < 40, ratio < 4.0 | DO NOT suppress |
| Luminance separation < 20 AND high variance on fg/bg | DO NOT suppress |
| Range-based best-case < 4.5:1 | DO NOT suppress (clear failure) |

**Examples of obvious failures that MUST be reported:**
- Light gray text (#9CA3AF) on white background (#FFFFFF)
- Pastel text on pastel background
- Dark gray text on dark gray background
- Any case where measured ratio is clearly below threshold

## 5. Reporting Discipline

### What IS Reported
For each Confirmed or Borderline finding:
1. **Descriptive label** (e.g., "credits badge label", "page subtitle")
2. **Approximate location** (e.g., "course card", "header section")
3. **Measured contrast ratio** (pixel-sampled value)
4. **Foreground/background hex** (sampled, not tokenized)
5. **Individual confidence score**
6. **Sampling reliability details**

### What is NOT Reported
- **Aggregate counts**: No "7 elements could not be measured"
- **Anonymous findings**: No findings without element-level specificity
- **Potential Risks for uncertain measurement**: When uncertain AND failure implausible, suppress entirely
- **Technical limitation disclaimers**: Do not surface sampling uncertainty to users

## 6. Fallback Strategies

When direct ring sampling fails, use progressive fallbacks:

1. **Expanded region**: +8px, +16px, +32px expansion
2. **Color clustering**: k-means to find dominant background color
3. **Range-based**: Report min/max contrast when multiple background candidates exist

Fallback usage automatically demotes findings to "Borderline" (non-blocking).

## Forbidden Behaviors

- Do NOT report A1 "Potential Risks" when measurement fails and failure is implausible
- Do NOT report aggregate counts ("X elements could not be measured")
- Do NOT report anonymous elements without description/location
- Do NOT equate algorithmic uncertainty with accessibility risk
- Do NOT snap sampled colors to Tailwind tokens or palette names
- Do NOT suppress obvious low-contrast failures (light gray on white, etc.)
