# Memory: features/analysis-rules/u4-context-aware-suppression
Updated: now

Rule U4 (Recognition-to-Recall Regression) uses a **two-stage architecture** where Stage 1 is candidate-only extraction and Stage 2 is mandatory LLM decision.

## Architecture

### Stage 1 — Deterministic Candidate Extraction (No Classification)
Extracts candidates across 4 subtypes. Does NOT classify, emit, or assign status. Builds evidence bundles with:
- Code snippets, nearby headings, mitigation signals, raw evidence descriptions

### Stage 2 — LLM Decision Layer (Mandatory)
ALL candidates go to LLM. The LLM is the SOLE decision maker and must answer:
1. Does this reduce recognition-based interaction?
2. Is recall burden plausibly increased?
3. Are there visible mitigations?
4. Is semantic intent clearly categorical?

If ANY answer is uncertain → candidate is SUPPRESSED.

## Global Constraints (Mandatory)
- U4 MUST NEVER output "confirmed" — status is ALWAYS "potential"
- Maximum confidence: **0.65** (range: 0.45–0.65)
- If evidence is ambiguous → suppress
- If categorical intent cannot be verified → suppress
- Do NOT assume text inputs require structured selection
- Do NOT infer enum expectation from generic labels: reason, message, description, notes, details
- Truncation/overflow is U3 scope — never flag under U4
- U4 prioritizes false-positive avoidance over sensitivity

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

1. **U4.1 — Structured Selection → Free-Text** (LLM-decided)
   - Candidates: text inputs with semantic labels (category, status, etc.) without nearby selection components
   - LLM reports ONLY if finite categorical domain is strongly evidenced
   - Suppressed if: label implies open description, domain unclear, no enum evidence

2. **U4.2 — Hidden Selection State** (LLM-decided, component-aware)
   - Candidates: Tabs/ToggleGroup without active state indicators
   - **Import resolution**: checks component definition file for `data-[state=active]:` styling
   - LLM reports ONLY if active state truly not persistent in both usage AND definition
   - Suppressed if: active styling, aria-selected, or visible context exists (locally OR in component definition)

3. **U4.3 — Multi-Step Context Regression** (LLM-decided, conservative grounding)
   - Candidates: flows with ≥2 steps (counted conservatively)
   - Pre-LLM suppression when strong mitigations present (see rules above)
   - LLM reports ONLY if ALL mitigations missing (step indicator, back nav, summary, persistent context)
   - If ANY mitigation exists → suppress

4. **U4.4 — Generic Context-Free CTAs** (LLM-decided)
   - Candidates: generic buttons (Next, Submit, etc.) that transition steps or commit data
   - LLM reports ONLY if action outcome not contextually clarified
   - Suppressed if: headings clarify, universally obvious action

## Post-Processing
- ALL findings come from LLM only — no deterministic emission
- Every element forced to status="potential", confidence capped at 0.65
- blocksConvergence is always false
- evaluationMethod is always "llm_assisted"
- Single aggregated violation object (no confirmed/potential split)

## False Positive Prevention
- Never trigger based solely on: text input presence, missing step indicator without multi-step logic, minimalist styling, truncation, short labels
- LLM is explicitly allowed to decline reporting
- Generic labels (reason, message, description, notes, details) excluded from U4.1
- Prefer "unknown" over false when evidence is incomplete — do not infer
