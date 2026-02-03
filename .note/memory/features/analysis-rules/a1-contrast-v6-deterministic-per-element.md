# Memory: features/analysis-rules/a1-contrast-v25-tiered-thresholds

Updated: just now

## A1 — Insufficient Text Contrast (Tiered Thresholds v25)

This is the **definitive, immutable** rule specification for A1. All previous logic, fallbacks, heuristics, and suppression behavior are superseded.

### v25 Key Changes

1. **Comprehensive Mandatory Detection Scope**
2. **Local-Priority Background Sampling**
3. **Background-Based Classification (not confidence-based)**
4. **Tiered WCAG Thresholds: 4.5:1 (normal) / 3.0:1 (large text)**

---

## WCAG Tiered Thresholds (v25)

| Text Classification | Minimum Contrast | Criteria |
|---------------------|------------------|----------|
| Normal text | 4.5:1 | Default for all text |
| Large text | 3.0:1 | ≥ 18pt normal OR ≥ 14pt bold |
| Navigation items | 3.0:1 | Top-level nav/menu links (exception) |

### Large Text Classification

Classify text as "large" when:
- Estimated text height ≥ 18pt (~24px) for normal-weight text, OR
- Estimated text height ≥ 14pt (~18.7px) AND text appears bold (heavier stroke weight)

Visual indicators for large text:
- Main headings (h1, h2, hero titles)
- Bold section headers with significant height
- Banner headlines, feature titles

### Navigation Exception (v25.1)

Top-level navigation items and primary menu links MUST use the 3:1 threshold,
REGARDLESS of their actual font size. Apply this exception when:
- Text appears in a top navigation bar/header menu
- Text is a primary navigation link or menu item
- Text is in a sidebar main navigation section
- Text is a prominent tab label in a primary tab bar

Do NOT apply if:
- The navigation text is visually comparable to body paragraph text
- The text is a secondary link (footer links, breadcrumbs, utility links)

When uncertain, classify as "normal" (conservative approach).

---

## Detection Scope — NO EXCLUSIONS

**CRITICAL**: ALL visible text elements MUST be evaluated. Do NOT exclude based on:
- Visual prominence (secondary, muted, faded, subtle)
- Semantic role (metadata, captions, badges, labels, tags)
- Stylistic intent (intentionally low-contrast for aesthetic)
- Text color (gray, yellow, blue, any colored text)
- Text size or weight (small text must still be evaluated)
- Perceived importance or emphasis
- Font size or bounding box dimensions
- Color brightness or luminance

### TEXT DETECTION OVERRIDE FOR A1

The text detection pipeline MUST expose ALL visible text to A1 evaluation.
Filtering rules that apply to other analyses (A2, A4, etc.) MUST NOT apply to A1.
If users can read it, A1 must evaluate it.

### MUST INCLUDE (comprehensive list):
- Secondary or muted text
- Descriptions, summaries, captions
- Author names, usernames, timestamps
- Tags, labels, badges, chips, pills
- Colored text (yellow prices, blue links, gray hints)
- Placeholder text, helper text
- Price labels, discount percentages
- Footer text, copyright notices
- Small text, light-weight text
- Any other readable text visible to users

**RULE**: If a user can read the text, it MUST be checked for WCAG contrast compliance.

---

## Local-Priority Background Sampling (v24)

For pill-shaped components (badges, chips, tags):
- Sample background pixels within a **small local margin (6-10px)** around the text bounding box
- **Weight pixels by proximity** to text — nearer pixels dominate over distant ones
- If local region shows a **uniform color**, use that color directly (CERTAIN background)
- Do NOT classify background as white/global if a uniform local background exists

### Background Sampling Priority Order

1. **LOCAL MARGIN FIRST** (8px around text bbox)
   - Captures badge/pill/chip backgrounds correctly
   - Uses proximity weighting (closer pixels get higher weight)
   - If uniform color detected → `local_uniform` method → CERTAIN

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
