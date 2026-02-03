# Memory: features/analysis-rules/a1-contrast-v23-background-based-classification

Updated: just now

## A1 — Insufficient Text Contrast (Background-Based Classification Rule v23)

This is the **definitive, immutable** rule specification for A1. All previous logic, fallbacks, heuristics, and suppression behavior are superseded.

### v23 Key Change: Low Confidence MUST NOT Auto-Downgrade

**CRITICAL**: Low confidence alone MUST NOT automatically downgrade A1 to Potential.

Classification is based on **BACKGROUND CERTAINTY**, not sampling confidence:
- If background is visually uniform (certain) AND contrast < threshold → **CONFIRMED**
- Confidence affects **reporting detail** (e.g., "sampling confidence reduced"), NOT classification
- Potential is ONLY used when **background cannot be reliably determined**

### When to Use POTENTIAL (Exhaustive List)

A1 should be classified as Potential **ONLY** when:
1. Background has **multiple dominant colors** (BG_MIXED)
2. Background has **gradient pattern** (BG_GRADIENT)
3. Background has **image/texture overlay** (BG_IMAGE, BG_OVERLAY)
4. Text **spans multiple background regions** (spanMultipleRegions)
5. Contrast **cannot be computed at all** (unmeasurable)

Do NOT downgrade obvious WCAG failures to Potential due to low confidence alone.

### Rule Objective

Detect text elements that may not meet WCAG 2.1 AA contrast requirements and report findings per element, explicitly stating:
- Where the issue occurs
- What contrast was calculated
- Whether the issue is confirmed or potential
- Why it is classified as potential when background is uncertain

### WCAG Thresholds (Immutable)

| Text Type | Minimum Contrast |
|-----------|------------------|
| Normal text | 4.5:1 |
| Large text (≥18pt or ≥14pt bold) | 3.0:1 |

---

## Detection Scope

Apply this rule to EVERY detected text element:
- Small text, secondary/muted text
- Badges, labels, metadata, helper text
- Do NOT exclude based on size, prominence, or visual importance

---

## Step-by-Step Processing (Mandatory)

### Step 1 — Foreground Color Extraction (Always Required)

For each text element:
- Attempt to extract foreground from glyph pixels (darkest 30-40% by luminance)
- Record foreground color (hex) and confidence
- **If confidence is low: Still emit the A1 record — confidence affects detail, not classification**

### Step 2 — Background Sampling (Best-Effort, Never Blocking)

Classify background as:
- **Certain** → one dominant color, low variance, no gradients/overlays
- **Uncertain** → multiple colors, gradient, image, overlay, mixed regions
- **Unmeasurable** → insufficient valid pixels

**Critical**: Background uncertainty determines classification tier.

### Step 3 — Contrast Estimation (Must Always Be Attempted)

| Background Status | Action |
|-------------------|--------|
| Certain | Compute single WCAG ratio |
| Uncertain | Compute worst-case (min) and best-case (max) from candidates |
| Unmeasurable | Mark "not measurable", do NOT fabricate |

### Step 4 — Classification Logic (v23: Background-Based, Not Confidence-Based)

**CONFIRMED Violation** (background is certain):
- Background has single dominant color, no gradients/images/overlays
- Contrast ratio < WCAG threshold
- **Low confidence does NOT prevent confirmation**
- ➡️ Emit Confirmed (Blocking)

**Potential Risk** (background is uncertain):
- Background has multiple dominant colors (BG_MIXED)
- Background has gradient pattern (BG_GRADIENT)
- Background has image/overlay (BG_IMAGE, BG_OVERLAY)
- Text spans multiple regions
- Contrast cannot be computed
- ➡️ Emit Potential (Non-blocking)

**PASS (only case with no emission)**:
- Worst-case contrast ≥ threshold
- Even the most conservative estimate passes

### Step 5 — Confidence Handling (v23 Change)

| Factor | Effect |
|--------|--------|
| Low confidence + certain background | CONFIRMED (note reduced confidence in diagnosis) |
| Low confidence + uncertain background | POTENTIAL (background uncertainty is the reason) |
| High confidence + certain background | CONFIRMED |
| High confidence + uncertain background | POTENTIAL (background is still uncertain) |

**Confidence affects**: Diagnosis text detail (e.g., "sampling confidence reduced")
**Confidence does NOT affect**: Confirmed vs Potential classification

### Step 6 — Mandatory Reason Codes (Only for POTENTIAL)

Every Potential finding MUST include at least one reason code explaining **background uncertainty**:
- `BG_MIXED` — multiple background colors detected
- `BG_GRADIENT` — gradient background
- `BG_IMAGE` — image or textured background
- `BG_OVERLAY` — transparency or overlay suspected
- `BG_TOO_SMALL_REGION` — insufficient background pixels around text
- `FG_ANTIALIASING` — glyph sampling unstable (affects background detection)
- `STATIC_ANALYSIS` — colors inferred from code (ZIP/GitHub only)

**v23 REMOVED**: `LOW_CONFIDENCE` is NO LONGER a valid reason code for downgrading.

---

## Required Output (Per Element)

Each A1 entry MUST include:
- Element identifier (screen + component or bounding box)
- Text snippet (if available)
- Foreground color + confidence
- Background: dominant color OR candidate list OR "unmeasurable"
- Contrast: exact ratio OR min–max range OR "not measurable"
- WCAG threshold applied
- Classification: Confirmed—Blocking OR Potential—Non-blocking
- Explicit uncertainty reason(s) if potential
- Short, actionable guidance

---

## Convergence Constraint

| Finding Type | Convergence Impact |
|--------------|-------------------|
| Confirmed violations | COUNT toward threshold; MAY block convergence |
| Potential findings | Tracked and reported; NEVER block convergence |

---

## Technical Implementation

### Classification Function (v23)

```typescript
function classifyA1Contrast(
  sample: A1Sample, 
  threshold: number,
  backgroundCertainty: A1BackgroundCertainty
): {
  classification: 'confirmed' | 'potential' | 'pass';
  reason: string;
  effectiveRatio: number;
  isBackgroundBased: boolean;
}
```

### Decision Tree (v23)

```
1. If worst-case contrast >= threshold → PASS
2. Check background certainty:
   a. If background is CERTAIN (uniform):
      - contrast < threshold → CONFIRMED (regardless of confidence)
   b. If background is UNCERTAIN (mixed/gradient/image):
      - → POTENTIAL (with reason codes)
3. Low confidence NEVER causes downgrade from CONFIRMED to POTENTIAL
```

### Edge Function Behavior

| Edge Function | Certain Background | Uncertain Background |
|---------------|-------------------|---------------------|
| analyze-ui | CONFIRMED if ratio < threshold | POTENTIAL with reason codes |
| analyze-zip | Always POTENTIAL (STATIC_ANALYSIS) | N/A |
| analyze-github | Always POTENTIAL (STATIC_ANALYSIS) | N/A |
