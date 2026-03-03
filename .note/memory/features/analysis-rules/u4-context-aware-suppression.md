# Memory: features/analysis-rules/u4-context-aware-suppression
Updated: now

Rule U4 (Recognition-to-Recall Regression) uses a **two-stage architecture** where Stage 1 is candidate-only extraction and Stage 2 is mandatory LLM decision, with an optional Stage 2.5 LLM validator for suppression-only.

## Architecture

### Stage 1 — Deterministic Candidate Extraction (No Classification)
Extracts candidates across 4 subtypes. Does NOT classify, emit, or assign status. Builds evidence bundles with:
- Code snippets, nearby headings, mitigation signals, raw evidence descriptions
- U4.1 enrichment: candidateKind, knownOptionsDetected, knownOptionsExamples, nearbyText, actionContext

### Stage 1.5 — Confirmation-Phrase Suppression (Hard, Deterministic)
U4.1 candidates are checked for confirmation-phrase patterns BEFORE reaching LLM:
1. Detect DESTRUCTIVE context: `delete`, `cannot be undone`, `permanent`, `irreversible`, etc.
2. Detect visible required phrase: `Type DELETE to confirm`, `Enter CONFIRM to proceed`, etc.
3. If BOTH destructive context AND visible phrase → **hard suppress** (not a recall issue, it's copying)
4. If destructive context but no visible phrase → mark as `candidateKind: 'confirmation_phrase'` (ambiguous)

### Stage 2 — LLM Decision Layer (Mandatory)
ALL candidates go to LLM. The LLM is the SOLE decision maker and must answer:
1. Does this reduce recognition-based interaction?
2. Is recall burden plausibly increased?
3. Are there visible mitigations?
4. Is semantic intent clearly categorical?

If ANY answer is uncertain → candidate is SUPPRESSED.

### Stage 2.5 — Optional LLM Validator (suppression-only)
Controlled by `u4_llm_validator_enabled` config flag (default: false).
- Runs ONLY on candidates with confidence in [0.45, 0.70]
- Can ONLY suppress or downgrade — never creates new findings
- Input: structured JSON per candidate with field_label, nearby_text, action_context, candidate_kind, etc.
- Output: `{ keep_issue: true|false, reason, confidence_adjust: -0.20..+0.10 }`
- Invalid LLM output → fallback to deterministic decision

## Global Constraints (Mandatory)
- U4 MUST NEVER output "confirmed" — status is ALWAYS "potential"
- Maximum confidence: **0.65** (range: 0.45–0.65)
- If evidence is ambiguous → suppress
- If categorical intent cannot be verified → suppress
- Do NOT assume text inputs require structured selection
- Do NOT infer enum expectation from generic labels: reason, message, description, notes, details
- Truncation/overflow is U3 scope — never flag under U4
- U4 prioritizes false-positive avoidance over sensitivity

## U4.1 Categorical-Only Trigger
U4.1 now triggers ONLY when:
- Field label/placeholder matches categorical domain keywords (specialty, country, status, etc.)
- Field label does NOT match freeform keywords (notes, message, description, etc.)
- Field is NOT a confirmation-phrase pattern (see Stage 1.5 above)

### Known-Set Evidence Detection
Confidence is boosted when:
- A predefined array is found: `const specialties = [...]`, `const categories: string[] = [...]`
- Enum validation detected: `z.enum([...])`, `enum TypeName {...}`
- If no known set exists → keep as low-confidence Potential (≤ 0.55) or suppress

### Evidence Text
For kept U4.1 items: "User must recall valid values instead of selecting from a list/autocomplete."
Includes known options examples when detected.

## U4.2 Component-Aware Import Resolution (Anti-False-Positive)
When Tabs/TabsTrigger/ToggleGroup usage is detected in a page file:
1. The engine resolves the import source path (e.g., `@/components/ui/tabs`)
2. Loads the referenced file from the analyzed artifact (zip/github)
3. Checks for persistent active-state tokens: `data-[state=active]:`, `aria-selected`, `isActive`, `isSelected`
4. If found → sets `active_state_in_component_definition` mitigation and **SUPPRESSES U4.2 entirely**
5. U4.2 only reports when NO active state exists in BOTH local usage AND resolved component definition

## U4.3 Conservative Multi-Step Grounding (Anti-False-Positive)

### Step Count Sources (ONLY these are valid)
- **Source A**: Explicit steps array with `label`/`title`/`name` properties
- **Source B**: Stepper component with ≥2 StepItem/StepTrigger elements in JSX
- **Source C**: Conditional render branches (`step === 0/1/2/3`) tied to a SINGLE state variable, max 10
- If none match → `stepCount = "unknown"` (never guess)

### Mitigation Signals (tri-state: true / false / "unknown")
- **hasStepIndicator**: Step labels in nav, Stepper components, "Step X of Y", aria-current="step", steps.map rendering labels
- **hasBackNav**: Button with "Previous"/"Back"/"Go Back"/"Return" text, step decrement handler, aria-label with back text
- **persistentContext**: Selected values rendered in JSX on later steps, Breadcrumbs, summary panels
- **summaryStep**: "Review"/"Summary"/"Confirm" heading AND selected data rendered

### Pre-LLM Suppression Rules
U4.3 is suppressed (never sent to LLM) when:
1. `hasStepIndicator == true AND hasBackNav == true`
2. `persistentContext == true AND summaryStep == true AND hasBackNav != false`
3. `stepCount <= 4 AND hasStepIndicator == true`

### LLM Send Criteria
Only sent to LLM when ALL of:
- `stepCount >= 5 OR stepCount == "unknown"`
- `hasStepIndicator != true`
- `persistentContext != true`

## Subtypes

1. **U4.1 — Structured Selection → Free-Text** (Deterministic gate + LLM-decided)
   - Candidates: text inputs with categorical labels (specialty, country, etc.) without nearby selection components
   - Hard-suppressed if confirmation-phrase pattern with visible instruction
   - Known-set evidence boosts confidence
   - LLM reports ONLY if finite categorical domain is strongly evidenced

2. **U4.2 — Hidden Selection State** (LLM-decided, component-aware)
   - Candidates: Tabs/ToggleGroup without active state indicators
   - **Import resolution**: checks component definition file for `data-[state=active]:` styling
   - LLM reports ONLY if active state truly not persistent in both usage AND definition

3. **U4.3 — Multi-Step Context Regression** (LLM-decided, conservative grounding)
   - Candidates: flows with ≥2 steps (counted conservatively)
   - Pre-LLM suppression when strong mitigations present (see rules above)
   - LLM reports ONLY if ALL mitigations missing

4. **U4.4 — Generic Context-Free CTAs** (LLM-decided)
   - Candidates: generic buttons (Next, Submit, etc.) that transition steps or commit data
   - LLM reports ONLY if action outcome not contextually clarified

## Post-Processing
- ALL findings come from LLM only — no deterministic emission
- Every element forced to status="potential", confidence capped at 0.65
- blocksConvergence is always false
- evaluationMethod is always "llm_assisted"
- Single aggregated violation object (no confirmed/potential split)

## Tests (u4-classification.test.ts)
- 20 tests covering: confirmation-phrase suppression, categorical field detection, non-categorical exclusion, regex validation, known-set detection
