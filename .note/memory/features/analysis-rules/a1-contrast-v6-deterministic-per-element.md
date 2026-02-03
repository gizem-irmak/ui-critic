# Memory: features/analysis-rules/a1-contrast-v20-authoritative-rule

Updated: just now

## A1 — Insufficient Text Contrast (Authoritative Rule Definition)

This rule definition supersedes all previous logic, fallbacks, heuristics, and legacy handling for A1.

### Rule Objective

Detect cases where text does not meet WCAG 2.1 AA minimum contrast requirements and classify the finding as either a **Confirmed Violation** or a **Heuristic Potential Risk**, based strictly on input certainty.

---

## WCAG Thresholds (Do Not Deviate)

| Text Type | Minimum Contrast |
|-----------|------------------|
| Normal text | 4.5:1 |
| Large text (≥ 18pt or ≥ 14pt bold) | 3.0:1 |

---

## Supported Input Types

1. **Rendered UI Screenshots** — Pixel-based analysis
2. **Exported Source Code (ZIP)** — Static code analysis
3. **GitHub Repository Link** — Static repository analysis

---

## Detection & Classification Logic

### 1. Screenshot-Based Detection

When rendered UI screenshots are provided:

**Extraction:**
- Sample foreground color from text glyph pixels (interior stroke methodology)
- Sample background color from immediate surrounding pixels (ring sampling with progressive expansion)

**Contrast Calculation:**
- Compute contrast ratio using the WCAG luminance formula
- All colors are pixel-derived estimates

**Background Certainty Rules:**

The background is considered **certain** only if:
- A single dominant background color is detected
- No gradients, images, or overlays are present
- Text does not overlap multiple background regions
- Background variance is low (stddev ≤ 25)
- No significant region expansion was required

**Screenshot Classification Decision (Mandatory):**

| Condition | Classification |
|-----------|----------------|
| FG and BG clearly identifiable | **Confirmed Violation** |
| Background is mixed, gradient, image-based, or ambiguous | Heuristic Potential Risk |
| Anti-aliasing dominates color sampling | Heuristic Potential Risk |
| Text spans multiple background regions | Heuristic Potential Risk |
| Range-based contrast spans WCAG threshold | Heuristic Potential Risk |

**Confidence Assignment:**
- Confirmed findings: 0.78–0.92 (based on reliability)
- Heuristic findings: 0.45–0.68 (based on reliability)

### 2. Source Code / ZIP Input

When analysis is based only on static source code:

- **Do not** attempt to confirm contrast failures
- **Do not** treat inferred color pairs as deterministic
- ➡️ **All A1 findings from source code alone must be classified as Heuristic Potential Risks**

### 3. GitHub Repository Input

Treat identically to ZIP input:
- Static analysis only
- ➡️ **Always classify A1 findings as Heuristic Potential Risks**

### 4. Hybrid Input (Screenshot + Code)

- Screenshot analysis takes precedence
- Code may be used only for reference or traceability
- ➡️ Confirmed classification is allowed **only if** screenshot certainty conditions are met

---

## Convergence Constraint (Strict)

| Finding Type | Convergence Impact |
|--------------|-------------------|
| **Confirmed A1 violations** | Count toward convergence thresholds; May block convergence |
| **Heuristic A1 findings** | Must be reported; Must be tracked; **Must NOT block convergence**; Must NOT trigger mandatory corrective prompts |

---

## Enforcement Clause

- If input certainty is insufficient at any stage, default to heuristic classification
- **Never** escalate heuristic A1 findings to confirmed without rendered visual evidence
- Heuristic findings receive `advisoryGuidance` instead of `correctivePrompt`

---

## Implementation Details

### Background Certainty Assessment (`assessA1BackgroundCertainty`)

Checks performed in order:
1. Multiple background clusters detected → Heuristic
2. High background variance (stddev > 25) without clustering → Heuristic
3. Range-based measurement spans WCAG threshold → Heuristic
4. Required significant expansion (≥ 16px) → Heuristic
5. Otherwise → Confirmed allowed

### Screenshot Decision Logic (`decideA1ScreenshotClassification`)

1. Compute effective ratio (use worst-case for range-based measurements)
2. If ratio ≥ threshold → PASS (no report)
3. If ratio < threshold AND background certain → Confirmed Violation
4. If ratio < threshold AND background ambiguous → Heuristic Potential Risk

### Reporting Structure

For Confirmed findings:
- `status: 'confirmed'`
- `correctivePrompt` provided
- No `advisoryGuidance`

For Heuristic findings:
- `status: 'potential'`
- `correctivePrompt` empty
- `advisoryGuidance` provided
- `potentialRiskReason` explains classification
- `inputLimitation` describes analysis constraints
