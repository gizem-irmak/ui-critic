# Memory: features/analysis-rules/a1-contrast-v21-mandatory-coverage

Updated: just now

## A1 — Insufficient Text Contrast (Mandatory Coverage Rule v21)

This is the **definitive, immutable** rule specification for A1. All previous logic, fallbacks, heuristics, and suppression behavior are superseded.

### Critical Enforcement Rule

**MANDATORY COVERAGE**: For every detected text element, ALWAYS emit an A1 evaluation record.
- Uncertainty DOWNGRADES classification, it NEVER eliminates reporting.
- Silence is NOT an allowed outcome for A1.
- Do not return early. Do not suppress findings.

### Rule Objective

Detect text elements that may not meet WCAG 2.1 AA contrast requirements and report findings per element, explicitly stating:
- Where the issue occurs
- What contrast was calculated
- Whether the issue is confirmed or potential
- Why it is classified as potential when uncertainty exists

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
- **If confidence is low: Still emit the A1 record with explicit reason**

### Step 2 — Background Sampling (Best-Effort, Never Blocking)

Classify background as:
- **Certain** → one dominant color, low variance
- **Uncertain** → multiple colors, gradient, image, overlay
- **Unmeasurable** → insufficient valid pixels

**Critical**: Background uncertainty must NEVER stop evaluation.

### Step 3 — Contrast Estimation (Must Always Be Attempted)

| Background Status | Action |
|-------------------|--------|
| Certain | Compute single WCAG ratio |
| Uncertain | Compute worst-case (min) and best-case (max) from candidates |
| Unmeasurable | Mark "not measurable", do NOT fabricate |

### Step 4 — Classification Logic (Strict, Non-Silent)

**Confirmed Violation**:
- Best-case contrast < threshold (even uncertain backgrounds)
- Background certain AND ratio clearly below threshold
- ➡️ Emit Confirmed (Blocking)

**Potential Risk**:
- Background uncertain OR unmeasurable
- Foreground confidence reduced
- Contrast range spans threshold
- ➡️ Emit Potential (Non-blocking)

**PASS (only case with no emission)**:
- Worst-case contrast ≥ threshold
- Even the most conservative estimate passes

### Step 5 — Worst-Case Rule (Prevents Missed Obvious Issues)

| Condition | Result |
|-----------|--------|
| Best-case < threshold | Confirmed violation |
| Worst-case ≥ threshold | PASS |
| Otherwise (range spans threshold) | Potential risk |

### Step 6 — Mandatory Reason Codes

Every Potential finding MUST include at least one reason code:
- `BG_MIXED` — multiple background colors detected
- `BG_GRADIENT` — gradient background
- `BG_IMAGE` — image or textured background
- `BG_OVERLAY` — transparency or overlay suspected
- `BG_TOO_SMALL_REGION` — insufficient background pixels
- `FG_ANTIALIASING` — glyph sampling unstable
- `LOW_CONFIDENCE` — combined confidence below threshold
- `STATIC_ANALYSIS` — colors inferred from code (ZIP/GitHub only)

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
- Explicit uncertainty reason(s)
- Short, actionable guidance

---

## Convergence Constraint

| Finding Type | Convergence Impact |
|--------------|-------------------|
| Confirmed violations | COUNT toward threshold; MAY block convergence |
| Potential findings | Tracked and reported; NEVER block convergence |

---

## Technical Implementation

### Classification Function

```typescript
function classifyA1Contrast(sample: A1Sample, threshold: number): {
  classification: 'confirmed' | 'potential' | 'pass';
  reason: string;
  effectiveRatio: number;
}
```

### Decision Tree

```
1. Compute contrastBest and contrastWorst from sample
2. If contrastBest < threshold → CONFIRMED (blocking)
3. If contrastWorst >= threshold → PASS (no report)
4. Otherwise → POTENTIAL (non-blocking, with reason codes)
```

### Edge Function Behavior

| Edge Function | Unmeasurable Elements | Uncertain Elements |
|--------------|----------------------|-------------------|
| analyze-ui | Emit as Potential (BG_TOO_SMALL_REGION) | Emit as Potential with reason codes |
| analyze-zip | Always Potential (STATIC_ANALYSIS) | N/A |
| analyze-github | Always Potential (STATIC_ANALYSIS) | N/A |
