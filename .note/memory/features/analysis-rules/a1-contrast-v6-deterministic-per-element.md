# Memory: features/analysis-rules/a1-contrast-v28-plausibility-gate

Updated: just now

## A1 — Insufficient Text Contrast (Plausibility Gate v28)

This is the **definitive, immutable** rule specification for A1. All previous logic, fallbacks, heuristics, and suppression behavior are superseded.

### v28 Key Changes

1. **Foreground/Background Plausibility Gate** (NEW)
2. **Inner Glyph Core Sampling (20-30%)**
3. **Background-Based + Foreground Validation Classification**
4. **New Reason Codes: FG_BG_BLEED, ANTIALIAS_DOMINANT**

---

## v28 FOREGROUND/BACKGROUND PLAUSIBILITY GATE

Before classifying a contrast result as CONFIRMED, validate that the sampled foreground truly represents glyph pixels (not background).

### Foreground Sampling (Inner Glyph Core)

For each text element:
- Sample foreground from the **INNER GLYPH CORE region** (exclude edges)
- Use only the **darkest 20-30%** of pixels within the text bounding box
- This avoids anti-aliasing and background bleed into foreground

### Background Sampling (Ring Method)

- Sample background from a **ring around the text bounding box** (NOT inside)
- Use local-priority sampling (8px margin first)
- Weight by proximity to text

### Plausibility Validation

If the sampled foreground is within a small distance of the sampled background:
- **Color distance < 30 RGB** (same color region)
- **Both colors near-white (luma > 200) AND luma distance < 15**
- **Foreground luma stddev > 25** (anti-aliasing dominance)

When any of these conditions are met for visually prominent text (titles/headings):
- **DO NOT mark CONFIRMED**
- **Downgrade to POTENTIAL** with reason codes
- Include explanation in diagnosis

### New Reason Codes (v28)

| Code | Meaning |
|------|---------|
| `FG_BG_BLEED` | Foreground sampling likely captured background pixels |
| `ANTIALIAS_DOMINANT` | Anti-aliased edge pixels dominate foreground sampling |

---

## WCAG Tiered Thresholds (v25)

| Text Classification | Minimum Contrast | Criteria |
|---------------------|------------------|----------|
| Normal text | 4.5:1 | Default for all text |
| Large text | 3.0:1 | Dynamic detection (see v27 rules below) |

### Large Text Classification (v27 — UI Role Awareness)

Classify text as "large" if **ANY** of the following conditions are met:

1. **UI Role-Based** (v27 — check first): Text functions as:
   - Top-level navigation item (menu links, primary nav, header navigation)
   - Section or page heading (labels sections, even if subtle)
   - Sidebar or filter group label (organizes filter options or sidebar sections)
   - Uppercase category or grouping label (ALL-CAPS categorization labels)
   
   These roles receive 3:1 threshold even if not bold or only slightly larger than body text.
   Do NOT apply 4.5:1 unless visually comparable to paragraph text.

2. **Relative Size**: Text height ≥ 1.2× the median body text height in the same screenshot
3. **Bold + Size**: Text height ≥ 14pt (~18.7px) AND text appears bold (heavier stroke weight)
4. **Semantic + Visual Weight**: Text functions as a UI label, section heading, filter label, navigation item, or control label AND is visually larger or heavier than surrounding body text

### Dynamic Estimation Process

1. Scan all text elements to determine the median body text height
2. For each element, check in order:
   - Does it serve a UI ROLE (nav item, heading, group label, uppercase category)? → "large"
   - Is height ≥ 1.2× median? → "large"
   - Is height ≥ ~18.7px AND bold? → "large"
   - Is it a prominent UI label/heading visually larger than body text? → "large"
   - None of the above? → "normal"

When uncertain about size/weight, check UI role first. Only default to "normal" when NO conditions are met.

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
