# Memory: features/analysis-rules/a1-contrast-v20-authoritative-rule

Updated: just now

## A1 — Insufficient Text Contrast (Authoritative Rule Definition v20)

This is the **definitive, immutable** rule specification for A1. All previous logic, fallbacks, heuristics, and legacy handling are superseded.

### Rule Objective

Detect cases where text does not meet WCAG 2.1 AA minimum contrast requirements and classify the finding as either a **Confirmed Violation** or a **Heuristic Potential Risk**, based strictly on input certainty.

### WCAG Thresholds (Immutable)

| Text Type | Minimum Contrast |
|-----------|------------------|
| Normal text | 4.5:1 |
| Large text (≥18pt or ≥14pt bold) | 3.0:1 |

### Supported Input Types

1. Rendered UI screenshots
2. Exported source code (ZIP)
3. GitHub repository link

---

## Classification Logic by Input Type

### 1. Screenshot-Based Detection

When rendered UI screenshots are provided:

**Extraction:**
- Sample foreground color from interior glyph stroke pixels (darkest 30-40%)
- Sample background color from immediate surrounding ring pixels
- Use progressive ring expansion (3→32px) if needed

**Background Certainty Rules:**
The background is **certain** ONLY if:
- A single dominant background color is detected
- No gradients, images, or overlays are present
- Text does not overlap multiple background regions
- Anti-aliasing does not dominate color sampling

**Screenshot Classification Decision:**

| Condition | Classification |
|-----------|----------------|
| FG and BG clearly identifiable, single dominant BG | **Confirmed Violation** |
| Background is mixed, gradient, image-based, or ambiguous | **Heuristic Potential Risk** |
| Anti-aliasing dominates color sampling | **Heuristic Potential Risk** |
| Text spans multiple background regions | **Heuristic Potential Risk** |

**Confidence Assignment:**
- Confirmed: confidence ≥ 0.75, background certainty met
- Heuristic: confidence < 0.75 or background uncertain

### 2. Source Code / ZIP Input

When analysis is based only on static source code:

- **Do NOT** attempt to confirm contrast failures
- **Do NOT** treat inferred color pairs as deterministic
- **➡️ ALL A1 findings from source code = Heuristic Potential Risk**

### 3. GitHub Repository Input

- Treat identically to ZIP input
- Static analysis only
- **➡️ ALL A1 findings from GitHub = Heuristic Potential Risk**

### 4. Hybrid Input (Screenshot + Code)

- Screenshot analysis takes precedence
- Code may be used only for reference or traceability
- **➡️ Confirmed classification ONLY if screenshot certainty conditions are met**

---

## Convergence Constraint (Strict)

| Finding Type | Convergence Impact |
|--------------|-------------------|
| **Confirmed A1 violations** | Count toward threshold; MAY block convergence |
| **Heuristic A1 findings** | Tracked and reported; NEVER block convergence |

The `blocksConvergence` field explicitly indicates whether each finding affects convergence:
- `blocksConvergence: true` — Confirmed violations (screenshot with certain background)
- `blocksConvergence: false` — Heuristic findings (ZIP, GitHub, or uncertain screenshots)

---

## Enforcement Clause

- If input certainty is insufficient at any stage, **default to heuristic classification**
- **Never escalate heuristic A1 findings to confirmed** without rendered visual evidence
- Do NOT report aggregate or anonymous counts (e.g., "7 elements could not be measured")
- Every reported finding must identify a specific element with location

---

## Technical Implementation

### A1Sample Type Extensions

```typescript
type A1BackgroundCertainty = {
  isCertain: boolean;
  reason?: string;
  hasGradient?: boolean;
  hasImage?: boolean;
  hasOverlay?: boolean;
  spanMultipleRegions?: boolean;
  antiAliasingDominates?: boolean;
  mixedBackground?: boolean;
};

// Added to A1Sample
backgroundCertainty: A1BackgroundCertainty;
```

### Classification Decision Tree (Screenshot)

```
1. Compute effectiveRatio (use worst-case if range-based)
2. If effectiveRatio >= threshold → PASS (no report)
3. Check backgroundCertainty.isCertain:
   - If TRUE and effectiveRatio < 4.0 and confidence >= 0.75:
     → status: "confirmed", blocksConvergence: true
   - Otherwise:
     → status: "potential", blocksConvergence: false
```

### Edge Function Behavior

| Edge Function | A1 Status | blocksConvergence |
|--------------|-----------|-------------------|
| analyze-ui (screenshots) | "confirmed" or "potential" | Based on background certainty |
| analyze-zip | Always "potential" | Always `false` |
| analyze-github | Always "potential" | Always `false` |
