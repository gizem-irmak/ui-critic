# Memory: features/analysis-rules/a1-contrast-v16-element-specificity

Updated: just now

Rule A1 (Insufficient Text Contrast) requires **element-level specificity** for all findings—generic or anonymous warnings are forbidden.

## Core Principle

**Do not present untraceable or non-actionable contrast warnings.**
Every A1 finding must identify a specific element with description, location, and measurement failure reason.

## Element-Level Specificity Requirement

A1 "Potential Risk" findings are only reported if the system can identify:

1. **Descriptive label** (e.g., "credits badge label", "page subtitle")
2. **Approximate location** (e.g., "course card", "header section")
3. **Specific measurement failure reason** (e.g., "insufficient background pixels", "mixed luminance")
4. **Individual confidence score**

### Suppression Rules

| Condition | Action |
|-----------|--------|
| No text elements identified | Suppress entirely (no generic warning) |
| Element lacks description AND (role + location) | Suppress that element's finding |
| Aggregate finding ("2 elements could not be measured") | FORBIDDEN |

### Evidence Format

Each reported finding uses element-specific evidence:
```
evidence: "credits badge label in course card"
diagnosis: "credits badge label contrast could not be measured reliably (insufficient background pixels)."
```

## Luminance Separation Suppression

When contrast measurement is inconclusive due to sampling issues (not actual low contrast), the finding is **suppressed entirely** (treated as PASS) if:

1. **Clear luminance separation** (≥50 luma units between foreground and background)
2. **Measured ratio ≥ 3.0:1** (not extremely low contrast)
3. **OR very high separation** (≥70 luma units regardless of other factors)

## Fallback Hierarchy

When initial sampling fails to obtain sufficient background pixels:

### 1. Auto-Expand Sampling Region
- Progressively expand ring around text: +3px → +8px → +16px → +32px
- Stop when ≥15 non-text pixels are available

### 2. Color Clustering (k-means, k=2-3)
- Applied when background variance > 20 stddev
- Select largest cluster as primary background

### 3. Contrast Range Calculation
- When multiple significant clusters exist (≥15% of pixels each)
- Compute contrast against all background candidates
- Report `contrastRange: { min, max }` instead of single ratio

## Interior-Stroke Sampling Methodology

### Foreground (Text) Color
1. Sample 160 pixels from text region grid
2. Select the **darkest 30–40%** of pixels (interior glyph strokes)
3. Use **median RGB** of this darkest subset as foreground color

### Background Color
1. Sample ring around text region
2. Exclude pixels darker than foreground max luminance + 2
3. Apply fallback hierarchy if insufficient pixels

## Tri-State Classification

| Classification | Criteria | Blocks Convergence |
|----------------|----------|-------------------|
| **Confirmed Fail** | All checks pass + no fallbacks + ratio < 4.0:1 | YES |
| **Borderline** | Near-threshold OR secondary element OR fallback used | NO |
| **Potential Risk** | Reliability fails + element has specificity | NO |
| **Suppressed** | No specificity OR clear luminance separation | - |

## Forbidden Behaviors

- Do NOT report aggregate A1 findings ("2 elements could not be measured")
- Do NOT report anonymous elements without description/location
- Do NOT report when luminance separation is clear despite sampling issues
- Do NOT snap sampled colors to Tailwind tokens
