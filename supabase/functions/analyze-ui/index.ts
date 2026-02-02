import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Complete rule registry for the 3-pass analysis
const rules = {
  accessibility: [
    { id: 'A1', name: 'Insufficient text contrast', diagnosis: 'Low contrast may reduce readability and fail WCAG AA compliance.', correctivePrompt: 'Use a high-contrast color palette compliant with WCAG AA (minimum 4.5:1 for normal text).' },
    { id: 'A2', name: 'Small informational text size', diagnosis: 'WCAG 2.1 does not mandate a minimum font size; however, larger font sizes (approximately 14–16px) are widely adopted in usability and accessibility practice to support readability, particularly for users with low vision.', correctivePrompt: 'Increase text below 13px to at least 14px (text-sm) for informational or state-indicating content. Use 16px (text-base) for primary informational content in dialogs, alerts, tooltips, and chart labels. Retain very small text only for decorative or non-essential elements. Do not alter layout structure, spacing, or component hierarchy.' },
    { id: 'A3', name: 'Insufficient line spacing', diagnosis: 'Poor spacing may reduce readability, especially for users with cognitive or visual impairments.', correctivePrompt: 'Increase line height and paragraph spacing to improve text readability.' },
    { id: 'A4', name: 'Small tap / click targets', diagnosis: 'Interactive elements do not explicitly enforce minimum tap target size (44×44 CSS px), which is commonly recommended in usability and accessibility guidelines (WCAG 2.1 Target Size is AAA, not AA). Padding or box sizing at runtime may increase the clickable area, but static analysis cannot confirm rendered dimensions.', correctivePrompt: 'Increase interactive element dimensions to at least 44×44 CSS px using min-width and min-height constraints or equivalent padding. Apply only to elements intended for user input (buttons, icon buttons). Do not modify layout structure, visual hierarchy, or component behavior beyond interactive sizing.' },
    { id: 'A5', name: 'Poor focus visibility', diagnosis: 'Lack of visible focus reduces keyboard accessibility.', correctivePrompt: 'Ensure all interactive elements have clearly visible focus states.' },
  ],
  usability: [
    { id: 'U1', name: 'Unclear primary action', diagnosis: 'Users may struggle to identify the main action.', correctivePrompt: 'Ensure exactly one primary action per action group uses a filled/default variant (e.g., variant="default" or bg-primary). Demote other actions to outline, ghost, or link variants. If more than two secondary actions exist, consider grouping them into an overflow menu ("More" or "..."). Do not alter layout structure.' },
    { id: 'U2', name: 'Multiple competing CTAs', diagnosis: 'Competing CTAs increase cognitive load and confusion.', correctivePrompt: 'Reduce emphasis on secondary actions to ensure a single, clear primary CTA.' },
    { id: 'U3', name: 'Inconsistent typography', diagnosis: 'Typography inconsistency reduces visual coherence.', correctivePrompt: 'Use a consistent typography system with limited font families and standardized heading and body styles.' },
    { id: 'U4', name: 'Excessive color usage', diagnosis: 'Excessive color usage can reduce clarity and visual balance.', correctivePrompt: 'Limit the color palette and use color consistently to support visual hierarchy.' },
    { id: 'U5', name: 'Weak grouping or alignment', diagnosis: 'Poor grouping can reduce scannability and comprehension.', correctivePrompt: 'Improve alignment and grouping to visually associate related elements.' },
    { id: 'U6', name: 'Unclear or insufficient error feedback', diagnosis: 'Insufficient error feedback may prevent users from correcting mistakes.', correctivePrompt: 'Provide clear, descriptive error messages near relevant fields using text, not color alone.' },
    { id: 'U7', name: 'Insufficient visible interaction feedback', diagnosis: 'Users may be uncertain whether actions were registered.', correctivePrompt: 'Add visible feedback after user actions (loading indicators, confirmations, or state changes).' },
    { id: 'U8', name: 'Incomplete or unclear navigation', diagnosis: 'Users may not understand how to move between screens or recover.', correctivePrompt: 'Ensure clear navigation paths including back, forward, and cancel options.' },
    { id: 'U9', name: 'Lack of cross-page visual coherence', diagnosis: 'Inconsistency reduces learnability and confidence.', correctivePrompt: 'Ensure consistent layout, navigation placement, typography, and color usage across screens.' },
    { id: 'U10', name: 'Truncated or clipped text', diagnosis: 'Truncated text may obscure meaning.', correctivePrompt: 'Ensure all text is fully visible; adjust layout, wrapping, or container sizes.' },
    { id: 'U11', name: 'Inappropriate control type', diagnosis: 'Inappropriate controls increase cognitive effort.', correctivePrompt: 'Replace chip-based controls with clearer text-based options where meaning must be explicit.' },
    { id: 'U12', name: 'Missing confirmation for high-impact actions', diagnosis: 'Users may trigger irreversible actions accidentally.', correctivePrompt: 'Add confirmation or warning steps for irreversible or high-impact actions.' },
  ],
  ethics: [
    { id: 'E1', name: 'Monetized option visually dominant', diagnosis: 'Visual dominance may nudge unintended choices.', correctivePrompt: 'Reduce emphasis on monetized actions and ensure alternatives are equally visible.' },
    { id: 'E2', name: 'Hidden or de-emphasized opt-out', diagnosis: 'Hidden opt-outs undermine user autonomy.', correctivePrompt: 'Make opt-out options clearly visible with equal hierarchy and contrast.' },
    { id: 'E3', name: 'Misleading visual hierarchy', diagnosis: 'Hierarchy may falsely suggest mandatory actions.', correctivePrompt: 'Adjust hierarchy to accurately reflect optional vs mandatory actions.' },
    { id: 'E4', name: 'Overuse of urgency cues', diagnosis: 'Excessive urgency pressures users unfairly.', correctivePrompt: 'Reduce urgency cues and present choices neutrally.' },
  ],
};

const buildAnalysisPrompt = (categories: string[], selectedRules: string[]) => {
  const selectedRulesSet = new Set(selectedRules);
  const includesA1 = selectedRulesSet.has('A1');
  
  return `You are an expert UI/UX auditor performing a comprehensive 3-pass analysis of a user interface. Analyze the provided screenshot(s) following this structured methodology:

## PASS 1 — Accessibility (WCAG AA)
Run visual inspection for accessibility issues:
- Text contrast ratios (minimum 4.5:1 for normal text)
- Font sizes (minimum 16px for body text)
- Line spacing and readability
- Focus indicator visibility

### A2 (Small informational text size) — PRECISE VISUAL DETECTION RULES:

**VISUAL SIZE THRESHOLDS (approximate visual assessment):**
1. **VIOLATION** (typeBadge: "VIOLATION"): Text appears noticeably small, estimated <13px
   - Only for INFORMATIONAL content (descriptions, labels, help text)
   - Confidence: 55-65% (visual estimation has inherent uncertainty)
   
2. **WARNING** (typeBadge: "WARNING"): Text appears borderline small, estimated 13-14px
   - Flag as readability concern
   - Confidence: 45-55%
   
3. **NO ACTION**: Text appears normal sized (≈14px or larger)
   - Do NOT include in violations array
   - Skip entirely

**SEMANTIC ROLE VISUAL CLASSIFICATION:**
Identify UI element purpose by visual context and location:

**INFORMATIONAL ELEMENTS (Primary A2 targets):**
- Dialog/modal description text
- Form field labels and helper text
- Card descriptions and captions
- Alert/notification body text
- Metadata displays (dates, counts, status text)

**SECONDARY/DECORATIVE ELEMENTS (Only flag if clearly <13px):**
- Badges, tags, status indicators
- Keyboard shortcut hints
- Tooltip content
- Breadcrumb separators

**EXCLUDED ELEMENTS (DO NOT EVALUATE):**
- Icon-only elements, action buttons
- Navigation menu items (intentionally styled)
- Button labels (interactive elements)
- Code blocks, monospace text
- Large headings or display text

**CONFIDENCE ADJUSTMENT FACTORS:**
1. **Visual certainty** (±15%):
   - Text clearly tiny compared to surroundings → +10%
   - Text size ambiguous or borderline → -10%
   
2. **Context clarity** (±10%):
   - Standalone informational text → +5%
   - Part of complex UI pattern → -5%

**OUTPUT FORMAT FOR A2 FINDINGS:**
\`\`\`json
{
  "ruleId": "A2",
  "ruleName": "Small informational text size",
  "category": "accessibility",
  "typeBadge": "VIOLATION" or "WARNING",
  "sizeCategory": "<13px" or "13-14px",
  "evidence": "Description text in dialog appears noticeably small",
  "diagnosis": "Informational text in [location] appears to use small font size. WCAG 2.1 does not mandate a minimum font size; however, larger font sizes (approximately 14–16px) are widely adopted in usability and accessibility practice to support readability, particularly for users with low vision.",
  "contextualHint": "Increase small text to at least 14px for informational content; use 16px for primary dialog, alert, and tooltip text.",
  "confidence": 0.55,
  "semanticRole": "informational" or "secondary"
}
\`\`\`

**STRICT RULES:**
- Text appearing ~14px or normal → DO NOT report
- Only flag visually tiny text for secondary elements
- Include typeBadge and sizeCategory in output
- Frame as best-practice concern, never WCAG violation
- Lower confidence than code analysis (visual estimation)

**DO NOT:**
- Flag normal-sized text as violations
- Use "fails", "violates WCAG", or compliance language
- Assume text size without clear visual evidence
- Flag interactive elements (buttons, links)
- Over-report borderline cases

### A4 (Small tap / click targets) — STRICT CLASSIFICATION & WORDING RULES:

**VISUAL ANALYSIS LIMITATION:**
Visual inspection cannot measure exact rendered dimensions. Padding, spacing, and layout constraints may increase the actual clickable area beyond what is visually apparent. Compliance CANNOT be confirmed from screenshots alone.

**GUIDELINE FRAMING:**
- 44×44 CSS px is commonly recommended in usability and accessibility guidelines
- WCAG 2.1 Target Size (Level AAA) suggests 44×44px, but this is NOT an AA requirement
- Do NOT state that WCAG mandates 44×44 at AA level
- Frame as: "commonly recommended touch target size" or "usability guideline"

**CLASSIFICATION:**
- ALWAYS classify A4 as "⚠️ Potential Risk (Heuristic)" — NEVER "Confirmed"
- Visual inspection CANNOT confirm tap target violations without actual DOM measurement

**CONFIDENCE REASONING:**
Confidence is based on:
1. **Visual size assessment** (±15%): Elements that appear noticeably small → higher confidence of potential risk
2. **Element type** (±10%): Icon-only buttons, close buttons → higher risk of small targets
3. **Visual analysis limitation** (-15%): Always reduce confidence since exact dimensions cannot be measured

**WHAT TO REPORT:**
1. Only report interactive elements (buttons, links, clickable elements) that visually appear to lack adequate size
2. DO NOT report elements that appear to have sufficient visual size (buttons with visible padding, large touch areas)

**DO NOT:**
- Infer or assume final tap target size from visual estimation alone
- Mention internal glyphs, spans, icons, or characters (e.g., "×", "X", icons)
- Describe user difficulty as a confirmed outcome
- Use language implying measurement or certainty
- Use "non-compliant" or "fails" — prefer "may be below recommended touch target size"

**REQUIRED WORDING:**
- Refer to elements as "button" or "interactive element" — not internal content
- Use neutral, academic phrasing: "does not explicitly enforce", "cannot be guaranteed", "may be below"
- Include the component/location where the issue occurs

**OUTPUT TEMPLATE:**
"The [button/interactive element] in [component/location] appears to be below the commonly recommended touch target size of 44×44 CSS px. Although padding or layout constraints may increase the actual clickable area, this cannot be confirmed from visual inspection alone. (WCAG 2.1 Target Size is AAA, not AA.)"

**Report each potentially undersized element SEPARATELY** — do not group into one violation

### A5 (Poor focus visibility) — STRICT CLASSIFICATION & DETECTION RULES:

**ABSOLUTE RULE:**
If an element appears to have the default browser focus outline, it MUST NOT be reported under A5.
Lack of a custom focus-visible style alone is NOT an accessibility issue — browser defaults are acceptable.

**PREREQUISITE — VISIBLE FOCUS STATE:**
ONLY flag A5 issues if the screenshot shows evidence that focus indicators are missing or inadequate.
If you cannot determine focus state from the screenshot → DO NOT REPORT

**FOCUSABILITY DETERMINATION — STRICT CRITERIA:**
An element is ONLY considered focusable if:
1. It is a button, link (\`<a>\`), form input, select, or textarea
2. It appears to be an interactive control that would receive keyboard focus

**DO NOT CLASSIFY AS FOCUSABLE:**
- Decorative elements, static text, images
- Cards, containers, or wrappers that are not interactive

**IGNORE COMPLETELY:**
- All hover states — hover is NOT focus
- Hover feedback must NEVER be used as evidence for or against focus visibility

**CLASSIFICATION CATEGORIES:**

1. **NOT APPLICABLE — SKIP ENTIRELY:**
   - Element is NOT interactive/focusable
   - OR screenshot does not show focus state
   - DO NOT REPORT — do not include in violations array

2. **PASS — SKIP ENTIRELY:**
   - Screenshot shows visible focus indicator (ring, border, outline, glow)
   - DO NOT REPORT — do not include in violations array

3. **HEURISTIC RISK — REPORT:**
   - Element IS interactive AND appears to rely ONLY on background color change for focus
   - Set \`typeBadge: "HEURISTIC"\`
   - Set confidence to 40-50% (screenshots cannot confirm focus states)
   - Rationale: "Focus indication may rely only on background/text color change."

4. **CONFIRMED VIOLATION — REPORT:**
   - Element IS interactive AND visually appears to LACK any visible focus indicator
   - Set \`typeBadge: "CONFIRMED"\`
   - Set confidence to 50-60% (medium-low for screenshot analysis)

**OUTPUT FORMAT FOR A5 VIOLATIONS ONLY:**
\`\`\`json
{
  "ruleId": "A5",
  "ruleName": "Poor focus visibility",
  "category": "accessibility",
  "typeBadge": "CONFIRMED" or "HEURISTIC",
  "evidence": "Button appears to lack visible focus indicator",
  "diagnosis": "The primary action button may lack a visible focus indicator for keyboard users.",
  "contextualHint": "Add visible focus ring or border for keyboard accessibility.",
  "confidence": 0.55
}
\`\`\`

**OUTPUT CONSTRAINT — MANDATORY:**
- The "violations" array must contain ONLY categories 3 and 4 (HEURISTIC RISK and CONFIRMED)
- NEVER include PASS or NOT APPLICABLE cases in violations
- NEVER speculate based on "might be subtle" or assumptions
- Report ONLY actual accessibility risks observed in the screenshot

${includesA1 ? `
### SPECIAL HANDLING FOR A1 (Text Contrast) — PER-ELEMENT DETERMINISTIC ANALYSIS

**CRITICAL: Evaluate contrast at the INDIVIDUAL ELEMENT level. Each text element must be assessed independently—do NOT group multiple elements under a single color value.**

**ROBUST COLOR SAMPLING METHODOLOGY (MANDATORY FOR SCREENSHOTS):**

**FOREGROUND COLOR EXTRACTION (Text Color):**
1. Identify text glyph pixels by detecting high-contrast edges against the background
2. Apply inward erosion of 1-2 pixels from glyph edges to exclude anti-aliased/mixed pixels
3. Sample 5-10 pixels from the INTERIOR of glyph strokes only
4. Compute the MEDIAN RGB value of sampled pixels—ignore outliers
5. Convert median RGB to hex for reporting

**BACKGROUND COLOR EXTRACTION:**
1. Sample pixels from areas IMMEDIATELY ADJACENT to text but OUTSIDE the glyph mask
2. Stay within the same visual container/component (avoid sampling from adjacent components)
3. Sample 5-10 pixels from uniform background regions
4. Compute the MEDIAN RGB value—if variance is high (σ > 15), flag as non-uniform
5. Convert median RGB to hex for reporting

**CRITICAL SAMPLING RULES:**
- Use sampled RGB values DIRECTLY for contrast computation
- Do NOT snap sampled colors to predefined design tokens or palette names
- Do NOT assume colors match known gray-scale values (e.g., "gray-400")
- Report actual measured hex values (e.g., "#6B7280") not token names

**COLOR ESTIMATE VALIDATION:**
If the reported hex value would imply WCAG compliance but the computed contrast ratio indicates failure (or vice versa):
- Flag the color estimate as "approximate"
- Prioritize the measured contrast ratio over the hex implication
- Include note: "Color values derived from screenshot pixels are approximations"

**CLASSIFICATION THRESHOLDS:**
- **WCAG AA Failure**: ratio < 4.5:1 for normal text (< 18px or < 14px bold)
- **WCAG AA Failure**: ratio < 3:1 for large text (≥ 18px or ≥ 14px bold)
- **Borderline Contrast**: ratio between 4.3:1 and 4.5:1 for normal text (4.0-4.5:1 zone) — NOT a definitive failure
- **PASS**: ratio ≥ 4.5:1 for normal text, or ≥ 3:1 for large text — DO NOT INCLUDE IN VIOLATIONS

**PER-ELEMENT ANALYSIS METHODOLOGY:**
For EACH visible text element in the screenshot:
1. **Identify element role** — button label, heading, body text, caption, badge, metadata, etc.
2. **Sample foreground color** — Use glyph interior sampling with erosion (exclude anti-aliased edges)
3. **Sample background color** — Use adjacent uniform region sampling (same container)
4. **Compute WCAG contrast ratio** — Use relative luminance formula on sampled RGB values
5. **Classify individually:**
   - If ratio < 4.3:1 for normal text → **Confirmed Violation** (status: "confirmed")
   - If ratio 4.3:1 to 4.5:1 for normal text → **Borderline Contrast** (status: "borderline", reduced confidence 0.65-0.75)
   - If ratio ≥ 4.5:1 for normal text → **PASS** — exclude from violations array entirely
   - Apply 3:1 threshold equivalently for large/bold text

**BORDERLINE CONTRAST HANDLING:**
When measured contrast falls near the WCAG threshold (4.3:1 to 4.5:1 for normal text):
- Set \`status: "borderline"\` instead of "confirmed" or "potential"
- Reduce confidence to 0.65-0.75 (acknowledge threshold proximity)
- Include advisory language: "Borderline contrast near WCAG AA threshold"
- Do NOT classify as a definitive failure—let user decide on fix priority

**EDGE CASE HANDLING:**
- **Anti-aliasing**: Apply 1-2px inward erosion, sample 5-10 interior pixels, use median color
- **Outlier pixels**: Discard pixels that deviate >20% from median before final calculation
- **Background variance**: If background pixels vary significantly (σ > 15), mark as "potential" with potentialRiskReason: "non-uniform background prevents stable sampling"
- **Gradient/image backgrounds**: Mark as "potential" with potentialRiskReason: "gradient or image background"
- **Transparent/overlay text**: Mark as "potential" with potentialRiskReason: "transparency prevents color extraction"

**OUTPUT FORMAT FOR EACH ELEMENT (one entry per element):**
\`\`\`json
{
  "ruleId": "A1",
  "ruleName": "Insufficient text contrast",
  "category": "accessibility",
  "status": "confirmed" | "borderline" | "potential",
  "elementRole": "caption" | "badge" | "metadata" | "body text" | "button label" | "heading" | etc.,
  "evidence": "Credits badge in course card header",
  "elementDescription": "Credits badge label text",
  "foregroundHex": "#9CA3AF",
  "backgroundHex": "#FFFFFF",
  "contrastRatio": 2.8,
  "thresholdUsed": 4.5,
  "colorApproximate": true,
  "diagnosis": "Credits badge text (#9CA3AF on #FFFFFF) has 2.8:1 contrast, failing WCAG AA 4.5:1 minimum. Color values derived from screenshot pixels are approximations.",
  "contextualHint": "Increase badge text contrast to meet 4.5:1.",
  "confidence": 0.92
}
\`\`\`

**OUTPUT FORMAT FOR BORDERLINE CONTRAST:**
\`\`\`json
{
  "ruleId": "A1",
  "status": "borderline",
  "elementRole": "metadata",
  "evidence": "Date text in course card",
  "elementDescription": "Course date metadata",
  "foregroundHex": "#6B7280",
  "backgroundHex": "#FFFFFF",
  "contrastRatio": 4.4,
  "thresholdUsed": 4.5,
  "colorApproximate": true,
  "diagnosis": "Date text (#6B7280 on #FFFFFF) has 4.4:1 contrast—borderline near WCAG AA 4.5:1 threshold. Color values are approximations.",
  "contextualHint": "Consider increasing contrast slightly for safety margin.",
  "confidence": 0.70
}
\`\`\`

**CONFIDENCE REQUIREMENTS:**
- **Confirmed violation (ratio < 4.3:1)**: 0.88–0.95
- **Borderline contrast (ratio 4.3:1–4.5:1)**: 0.65–0.75 (reduced due to threshold proximity)
- **Potential risk (computation impossible)**: 0.50–0.70

**MANDATORY FIELDS:**
- \`status\`: "confirmed", "borderline", or "potential"
- \`elementRole\`: Semantic role of the text element
- \`foregroundHex\`: Sampled text color as hex (from glyph interior pixels)
- \`backgroundHex\`: Sampled background color as hex (from adjacent uniform region)
- \`contrastRatio\`: Computed ratio as number
- \`thresholdUsed\`: Which WCAG threshold applies (4.5 or 3.0)
- \`elementDescription\`: What element is affected
- \`evidence\`: Location in UI
- \`colorApproximate\`: true (always for screenshot-derived values)

**ABSOLUTELY DO NOT:**
- Group multiple elements under one color/finding—each element is separate
- Include PASS results (ratio ≥ threshold) in violations array
- Classify borderline (4.3-4.5:1) as definitive failure—use "borderline" status
- Use "ambiguous by visual inspection" when ratio IS computable
- Report A1 without foregroundHex + backgroundHex + contrastRatio (unless truly potential)
- Snap sampled colors to design tokens—use actual measured hex values
- Sample anti-aliased edge pixels—always use glyph interior with erosion
` : ''}

Report violations ONLY if there is strong visual evidence.

Accessibility rules to check:
${rules.accessibility.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name} — ${r.diagnosis}`).join('\n')}

## PASS 2 — Usability (HCI)
Independently reason about the UI based on HCI principles. Do NOT rely solely on code warnings.
Perform qualitative judgment based on UI intent and visual hierarchy.

### U1 (Unclear primary action) — COMPREHENSIVE EVIDENCE-BASED DETECTION RULES:

**GOAL:** Detect unclear primary action issues whenever visual hierarchy fails, based only on observable visual evidence. Do not speculate. Do not infer intent.

**CRITICAL — VISUAL EMPHASIS DETECTION:**
When analyzing button styling in screenshots, carefully distinguish between:
- **FILLED/PRIMARY button**: Solid background color (e.g., blue, dark, primary color filled)
- **OUTLINED button**: Border only, transparent/white background
- **GHOST button**: No border, transparent background, text only
- **TEXT/LINK button**: Just text, possibly underlined, no background or border

---

**ACTION GROUP DETECTION (CRITICAL - expanded container patterns):**
Treat ANY of the following as an action group for U1 detection:
1. **Dialog footers / modal footers**: Action areas at bottom of dialogs/modals
2. **Card footers / CardActions**: Card action areas at bottom of cards
3. **Footer button rows**: Horizontal button arrangements at bottom of containers
4. **Action bars / toolbars**: Rows of action buttons
5. **Button groups**: Multiple buttons visually grouped together in a row
6. **Form action sections**: Buttons at the end of forms
7. **Any horizontal flex container with multiple buttons**: Parent containing 2+ button-like elements

**CTA/BUTTON RECOGNITION (expanded - avoid missing styled buttons):**
Treat ALL of the following as CTAs for U1 analysis:
- Buttons with visible labels (Save, Share, Apply, Submit, Create, Delete, etc.)
- Icon-only action buttons with clear action intent
- Buttons in card footers, dialog footers, or action bars
- Any element that appears clickable with action-oriented text

---

**U1 MUST TRIGGER if ANY of the following evidence-based cases are met:**

---

**CASE A — Equal emphasis between primary and secondary actions**

Trigger U1 when ALL are true:
- Two or more actions are VISUALLY present in the same action area (dialog footer, card actions, button group)
- A primary action is identifiable (e.g., Submit, Save, Confirm, Apply, Create, Send, Continue)
- The primary action has equal or lower visual emphasis than at least one secondary action
  (e.g., BOTH appear as outlined buttons, or secondary appears more prominent)

**Example evidence for CASE A:**
"Dialog footer shows 'Cancel' and 'Submit'. BOTH appear as outlined buttons with identical visual weight."

---

**CASE B — Multiple equally emphasized actions (competing primaries) [CRITICAL]**

**TRIGGER CONDITION:** Emit U1 when ALL are true within ONE detected action group:
1. Two or more CTAs (>=2 is sufficient) are VISUALLY present in the SAME action group/container
2. Two or more CTAs appear with HIGH emphasis styling (filled/solid backgrounds)
3. The HIGH emphasis CTAs share the SAME visual prominence (no single dominant CTA)

**HIGH-EMPHASIS VISUAL INDICATORS:**
A button is HIGH emphasis if it shows:
- Solid/filled background color (blue, dark, primary color)
- Prominent visual weight compared to container background
- Colored/dark fill (not just border or transparent)

**LOW/MEDIUM-EMPHASIS VISUAL INDICATORS:**
A button is LOW/MEDIUM emphasis if it shows:
- Only a border/outline (transparent background)
- Ghost styling (minimal visual presence)
- Text-only or link appearance

**ACTION GROUP DETECTION (expanded):**
Treat ALL of the following as action groups for Case B detection:
- Dialog footers (DialogFooter, modal footer)
- Card footers and action areas (CardFooter, card actions, CardActions)
- Footer button rows
- Action bars (action bar, toolbar)
- Button groups (sibling buttons within same parent container/row)
- Form action sections

**CRITICAL FOR CASE B:**
- Does NOT require a de-emphasized action to exist
- Detection is based on observable visual styles, NOT inferred intent from labels
- If multiple buttons all appear with filled/solid backgrounds → TRIGGER
- Confidence: 70-80% when 2+ filled/primary-styled buttons are detected

**FALSE POSITIVE AVOIDANCE:**
- Do NOT trigger if exactly one button is high-emphasis and others are outline/ghost/link
- Do NOT trigger if only one action exists in the group
- Do NOT trigger if actions are clearly separated by context (e.g., one in header, one in footer)

**Example evidence for CASE B (use these patterns):**
"Card footer shows 'Save', 'Share', and 'Apply' buttons. All three appear as filled buttons with identical visual prominence - no clear primary action."
"Form footer shows 'Apply' and 'Submit' buttons. Both appear as filled buttons with identical visual prominence."
"CardActions area shows multiple CTAs (Save, Share, Apply). All appear equally emphasized with solid backgrounds."
"Action bar shows Save, Share, Apply buttons. All appear as filled/primary buttons with equal visual weight."

**Output wording for CASE B:**
- Describe as "multiple equally emphasized actions" or "no clear primary action among high-emphasis buttons"
- List affected components/locations (e.g., ProposalCard / CardActions, SettingsForm / footer)
- Do NOT mention secondary actions being weaker (since none are in Case B)

---

**CASE C — Hidden affordance in default state**

Trigger U1 when ALL are true:
- An important action lacks clear button affordance in its visible DEFAULT state
- The element appears as plain text or has minimal styling that doesn't suggest clickability
- Button-like styling (background, border, shadow) is not visible in the screenshot

**Example evidence for CASE C:**
"Primary action appears as plain text without visible button styling (no background, border, or shadow visible)."

---

**CASE D — Primary action visually de-emphasized**

Trigger U1 when ALL are true:
- A primary action is visible (submit, confirm, save, etc.)
- It appears with low emphasis styling (outlined, ghost, or text-only)
- Secondary or less important actions appear with higher emphasis (filled/solid background)

**Example evidence for CASE D:**
"Submit button appears outlined while Cancel button appears filled. Primary action is less prominent than secondary."

---

**STRICT FALSE-POSITIVE PREVENTION — DO NOT TRIGGER U1 if ANY are true:**
- Only ONE action is visible (no competing actions)
- The primary action is clearly MORE visually prominent (filled/solid background) than others (outlined/ghost)
- Action hierarchy cannot be evaluated due to incomplete visibility
- The issue relies on speculation ("if", "could", "might", "would")
- Cannot visually determine styling for BOTH actions in the screenshot

---

**NO SPECULATION RULE — ABSOLUTE:**
- If you cannot SEE both the primary and secondary actions in the screenshot → DO NOT emit U1
- If you cannot determine the styling difference from the visual → DO NOT emit U1
- If the primary button appears FILLED and secondary appears OUTLINED → that is CORRECT hierarchy, NOT a violation
- DO NOT use conditional language ("if", "could", "might", "would", "may") to justify a violation
- DO NOT speculate about buttons that might exist outside the visible area

---

**OUTPUT FORMAT (when evidence is complete):**
\`\`\`json
{
  "ruleId": "U1",
  "ruleName": "Unclear primary action",
  "category": "usability",
  "caseType": "A" | "B" | "C" | "D",
  "evidence": "[Specific visual observation for the triggered case - mention container, buttons, visual appearance]",
  "primaryAction": "[Button label and visual appearance]",
  "secondaryAction": "[Button label and visual appearance]" (if applicable),
  "stylingComparison": "[Explicit comparison of visual treatments observed]",
  "affectedContainer": "[CardFooter | DialogFooter | button group | action bar | etc.]",
  "diagnosis": "Users may struggle to identify the main action because [evidence-based reason]. [Explain visual hierarchy failure].",
  "contextualHint": "In [location], make '[primary action label]' the filled/prominent button and demote '[other actions]' to outline/ghost styling.",
  "confidence": 0.65-0.80
}
\`\`\`

---

**PASS-SILENCE POLICY — ABSOLUTE:**
U1 must produce output ONLY when a violation is detected. All other cases must be SILENT.

**EXPLICIT PASS CASES (DO NOT OUTPUT ANYTHING):**
1. **Single action present**: Only one button/action exists in an action group → PASS (no output)
2. **Utility action alone**: A single utility action (Clear, Reset, Refresh, Filter, Cancel) without competing actions → PASS (no output)
3. **Clear hierarchy exists**: Primary action is filled/solid AND secondary actions are outlined/ghost → PASS (no output)
4. **One dominant action**: Multiple actions exist but exactly one is visually dominant (filled/solid) → PASS (no output)
5. **No visual hierarchy issue**: Action styling is appropriate for context → PASS (no output)

**FORBIDDEN FOR PASS CASES:**
- DO NOT emit text explaining why something is acceptable
- DO NOT emit confidence scores for PASS cases
- DO NOT emit corrective prompts for PASS cases
- DO NOT emit contextual hints for PASS cases
- DO NOT include PASS cases in the violations array

**VIOLATION-ONLY OUTPUT:**
- Only emit U1 when one of Cases A, B, C, or D is TRIGGERED with complete evidence
- If none apply → produce NO OUTPUT for U1 (do not include in violations array)

---

**AGGREGATION:**
- Emit ONE aggregated U1 entry per run (only when violated)
- Reference only detected UI components or locations (not guideline text as component names)
- Use heuristic language ("may reduce clarity", "may increase cognitive load")
- Confidence: 65–80% depending on clarity of evidence

For EACH of the following rules, explicitly decide whether it is violated or not:
${rules.usability.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name} — ${r.diagnosis}`).join('\n')}

Consider:
- Visual hierarchy and primary action clarity
- Typography consistency
- Color palette coherence
- Element grouping and alignment
- Feedback mechanisms
- Navigation clarity

## PASS 3 — Ethical & Dark Pattern Risks
Reason about potential manipulation or deceptive design:
- Visual emphasis that may nudge unintended choices
- Opt-out visibility and accessibility
- Urgency cues and their appropriateness
- Hierarchy suggesting mandatory vs optional actions

Ethics rules to check:
${rules.ethics.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name} — ${r.diagnosis}`).join('\n')}

## IMPORTANT CONSTRAINTS
- Even if no code-level violations are found, usability and ethical analysis MUST still be performed
- Absence of evidence does NOT imply absence of usability or ethical issues
- For each category, output triggered rules OR explicitly state "No violations detected after reasoning"
- Be thorough but avoid false positives - only report violations with clear evidence
${includesA1 ? '- For A1 (contrast): NEVER claim "confirmed" status - always use "potential" for screenshot analysis' : ''}

## OUTPUT FORMAT (JSON)
For EACH violation, you MUST provide:
1. **diagnosis**: Detailed, evidence-based explanation of WHY the rule is violated. Reference UI elements conceptually (e.g., "success message", "filter chips", "primary button").
2. **contextualHint**: A short (1 sentence) high-level hint summarizing WHERE the issue appears and WHAT kind of adjustment is needed. Keep it descriptive, not implementation-level.
${includesA1 ? `3. For A1 only: Include "status": "potential" and "evidence": describing what you observed visually.` : ''}

IMPORTANT CONSTRAINTS:
- Do NOT include file paths, class names, or code snippets in diagnosis or contextualHint
- Do NOT provide implementation-level fixes
- Keep contextualHint tool-agnostic and reusable across Bolt, Replit, and Lovable

Respond with a JSON object in this exact structure:
{
  "violations": [
    {
      "ruleId": "A1",
      "ruleName": "Insufficient text contrast",
      "category": "accessibility",
      "status": "potential",
      "evidence": "Light gray descriptive text appears against a white background in the card components",
      "diagnosis": "The secondary text in card components may have insufficient contrast. The light gray color against the white background appears to fall below WCAG AA standards, though exact measurement requires code inspection.",
      "contextualHint": "Verify and increase contrast for secondary text in card components.",
      "confidence": 0.7
    },
    {
      "ruleId": "U1",
      "ruleName": "Unclear primary action",
      "category": "usability",
      "diagnosis": "Multiple buttons with similar visual weight compete for attention...",
      "contextualHint": "Establish clearer visual hierarchy between primary and secondary actions.",
      "confidence": 0.85
    }
  ],
  "passNotes": {
    "accessibility": "Summary of accessibility pass findings",
    "usability": "Summary of usability pass findings",
    "ethics": "Summary of ethics pass findings"
  }
}`;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { images, categories, selectedRules, inputType, toolUsed } = await req.json();

    if (!images || images.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No images provided for analysis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate selectedRules
    const selectedRulesSet = new Set(selectedRules || []);
    if (selectedRulesSet.size === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No rules selected for analysis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Selected rules for analysis: ${Array.from(selectedRulesSet).join(', ')}`);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log(`Starting 3-pass analysis for ${images.length} image(s)`);
    console.log(`Categories: ${categories.join(', ')}`);
    console.log(`Tool used: ${toolUsed}`);

    // Build the analysis prompt
    const systemPrompt = buildAnalysisPrompt(categories, selectedRules);

    // Prepare messages with images
    const imageContents = images.map((img: string) => ({
      type: "image_url",
      image_url: {
        url: img.startsWith('data:') ? img : `data:image/png;base64,${img}`,
      },
    }));

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze the following UI screenshot(s) from a ${toolUsed} project. Perform the complete 3-pass analysis (Accessibility, Usability, Ethics) and return findings in the specified JSON format.`,
          },
          ...imageContents,
        ],
      },
    ];

    // Call the AI gateway with vision capabilities
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro", // Using pro for better vision analysis
        messages,
        temperature: 0.3, // Lower temperature for more consistent analysis
        max_tokens: 16000, // Ensure sufficient tokens for complete response
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: "Payment required. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content;
    const finishReason = aiResponse.choices?.[0]?.finish_reason;

    if (!content) {
      throw new Error("No content in AI response");
    }

    console.log("AI response received, parsing...");

    // Check if response was truncated due to token limits
    if (finishReason === 'length') {
      console.warn("AI response was truncated due to token limits, attempting to salvage partial response");
    }

    // Parse the JSON response from the AI with improved error handling
    let analysisResult;
    try {
      // Extract JSON from the response (it might be wrapped in markdown code blocks)
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      let jsonStr = jsonMatch ? jsonMatch[1] : content;
      
      // Clean up the JSON string
      jsonStr = jsonStr.trim();
      
      // If response appears truncated (ends mid-string or mid-object), try to repair
      if (!jsonStr.endsWith('}') && !jsonStr.endsWith(']')) {
        console.warn("JSON appears truncated, attempting repair...");
        
        // Find last complete object in violations array
        const lastCompleteMatch = jsonStr.match(/([\s\S]*"contextualHint"\s*:\s*"[^"]*"[^}]*})/);
        if (lastCompleteMatch) {
          jsonStr = lastCompleteMatch[1];
          
          // Count remaining open structures
          const openBraces = (jsonStr.match(/{/g) || []).length;
          const closeBraces = (jsonStr.match(/}/g) || []).length;
          const openBrackets = (jsonStr.match(/\[/g) || []).length;
          const closeBrackets = (jsonStr.match(/\]/g) || []).length;
          
          // Close violations array if needed
          if (openBrackets > closeBrackets) {
            jsonStr += ']';
          }
          // Add empty passNotes and close root object
          if (!jsonStr.includes('"passNotes"')) {
            jsonStr += ', "passNotes": {}';
          }
          if (openBraces > closeBraces) {
            jsonStr += '}';
          }
        } else {
          // Fallback: return empty result if we can't salvage
          console.error("Could not salvage truncated response, returning empty result");
          analysisResult = { violations: [], passNotes: {} };
        }
      }
      
      if (!analysisResult) {
        analysisResult = JSON.parse(jsonStr);
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", content.substring(0, 500));
      
      // Final fallback: return empty violations with error note
      console.warn("Using fallback empty result due to parse failure");
      analysisResult = { 
        violations: [], 
        passNotes: { 
          _error: "AI response parsing failed - please retry analysis" 
        } 
      };
    }

    // Enhance violations with corrective prompts from our rule registry
    // Also ensure A1 violations from screenshots are marked as "potential"
    // Separate A2 violations for aggregation, filter out invalid A5 cases
    
    const allRulesForViolations = [...rules.accessibility, ...rules.usability, ...rules.ethics];
    
    // CRITICAL: Filter violations to ONLY include selected rules
    // This ensures unselected rules are never reported, even if AI returns them
    const filteredBySelection = (analysisResult.violations || []).filter((v: any) => {
      const isSelected = selectedRulesSet.has(v.ruleId);
      if (!isSelected) {
        console.log(`Filtering out violation for unselected rule: ${v.ruleId}`);
      }
      return isSelected;
    });
    
    console.log(`Filtered ${(analysisResult.violations || []).length - filteredBySelection.length} violations from unselected rules`);
    
    // Separate A1, A2, A4, and A5 violations for aggregation (only from selected rules)
    const a1Violations: any[] = [];
    const a2Violations: any[] = [];
    const a4Violations: any[] = [];
    const a5Violations: any[] = [];
    const otherViolations: any[] = [];
    
    filteredBySelection.forEach((v: any) => {
      if (v.ruleId === 'A1') {
        a1Violations.push(v);
      } else if (v.ruleId === 'A2') {
        a2Violations.push(v);
      } else if (v.ruleId === 'A4') {
        a4Violations.push(v);
      } else if (v.ruleId === 'A5') {
        a5Violations.push(v);
      } else {
        otherViolations.push(v);
      }
    });
    
    // ========== U1 EVIDENCE GATING (Cases A, B, C, D) ==========
    // Filter out speculative U1 violations that lack proper evidence
    // Supports 4 cases: A (equal emphasis), B (competing primaries), C (hidden affordance), D (de-emphasized primary)
    const u1Violations: any[] = [];
    const nonU1OtherViolations: any[] = [];
    
    otherViolations.forEach((v: any) => {
      if (v.ruleId === 'U1') {
        u1Violations.push(v);
      } else {
        nonU1OtherViolations.push(v);
      }
    });
    
    // Validate U1 violations with strict evidence requirements for all 4 cases
    // PASS-SILENCE POLICY: Only true violations pass through; all PASS cases are silently filtered
    const validatedU1Violations = u1Violations.filter((v: any) => {
      const evidence = (v.evidence || '').toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const contextualHint = (v.contextualHint || '').toLowerCase();
      const caseType = (v.caseType || '').toUpperCase();
      const combined = evidence + ' ' + diagnosis + ' ' + contextualHint;
      
      // ========== PASS CASE SUPPRESSION ==========
      // Filter out any PASS explanations or non-violation outputs
      
      // PASS FILTER 1: Explicit PASS language or explanatory non-violation text
      const isPassExplanation = /(?:is\s+)?(?:appropriate|acceptable|correct|clear|proper|adequate|sufficient)|hierarchy\s+is\s+(?:clear|correct|appropriate)|no\s+(?:issue|violation|problem)|pass(?:es)?|not\s+a\s+(?:concern|issue|violation)|(?:single|lone)\s+(?:action|button)\s+(?:is|does)|utility\s+(?:action|button)\s+(?:is|does)|correctly\s+(?:styled|emphasized)|proper\s+(?:hierarchy|emphasis)/.test(combined);
      if (isPassExplanation) {
        console.log(`U1: Filtering out PASS explanation: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // PASS FILTER 2: Single action contexts (no competing actions)
      const mentionsSingleAction = /(?:only|single|lone|one)\s+(?:action|button|cta)|no\s+(?:other|competing|secondary)\s+(?:action|button)|standalone\s+(?:action|button)/.test(combined);
      const noMultipleActions = !/(?:two|both|multiple|several|2|3)\s+(?:action|button)|(?:action|button)s?\s+(?:and|,)/.test(combined);
      if (mentionsSingleAction || (noMultipleActions && !/equal|competing|same|identical|no.*clear|multiple|both/.test(combined))) {
        // Check if this is truly describing a single action scenario
        const buttonCount = (combined.match(/\bbutton/g) || []).length;
        const actionCount = (combined.match(/\baction/g) || []).length;
        if (buttonCount <= 1 && actionCount <= 1) {
          console.log(`U1: Filtering out single action context (PASS): ${v.evidence?.substring(0, 100)}`);
          return false;
        }
      }
      
      // PASS FILTER 3: Utility action alone without competing primary
      const isUtilityActionAlone = /(?:clear|reset|refresh|filter|cancel|dismiss|close)\s+(?:all\s+)?(?:button|action|filter).*(?:alone|only|single|standalone)|only\s+(?:a\s+)?(?:clear|reset|refresh|filter)\s+(?:button|action)/.test(combined);
      if (isUtilityActionAlone) {
        console.log(`U1: Filtering out utility action alone (PASS): ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // PASS FILTER 4: Clear hierarchy stated (primary filled, secondary outlined)
      const statesCorrectHierarchy = /primary\s+(?:is|appears?)\s+(?:filled|solid|prominent).*secondary\s+(?:is|appears?)\s+(?:outlined?|ghost)|(?:submit|confirm|save).*filled.*(?:cancel|dismiss).*(?:outlined?|ghost)|clear\s+(?:visual\s+)?hierarchy|(?:filled|solid)\s+primary.*(?:outlined?|ghost)\s+secondary/.test(combined);
      if (statesCorrectHierarchy && !/equal|competing|same|identical|no.*clear|multiple.*filled/.test(combined)) {
        console.log(`U1: Filtering out correct hierarchy description (PASS): ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // ========== SPECULATIVE LANGUAGE FILTER ==========
      // FILTER: Speculative language indicates incomplete evidence (applies to ALL cases)
      const hasSpeculativeLanguage = /\bif\b.*\b(also|uses?|were?|is)\b|\bcould\b|\bmight\b|\bwould\b|\bmay\b(?!\s+struggle)|\bpossibly\b|\bpotentially\b|\bassuming\b|\bif the\b/.test(combined);
      if (hasSpeculativeLanguage) {
        console.log(`U1: Filtering out speculative violation: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // ========== CASE A: Equal emphasis between primary and secondary ==========
      const isCaseA = caseType === 'A' || /equal.*emphasis|identical|same.*styl|both.*outline|both.*ghost|both.*filled|no.*distinction|equal.*weight/.test(combined);
      
      if (isCaseA) {
        // Must mention at least two distinct actions/buttons
        const hasTwoActions = /\btwo\b|\bboth\b|\band\b.*\bbutton|\bcancel.*submit\b|\bsubmit.*cancel\b|\bprimary.*secondary\b|\bsecondary.*primary\b|\bconfirm.*cancel\b|\bcancel.*confirm\b/.test(combined);
        const mentionsMultipleButtons = (combined.match(/\bbutton/g) || []).length >= 2;
        if (!hasTwoActions && !mentionsMultipleButtons) {
          console.log(`U1 Case A: Filtering out - does not evidence two actions: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Must identify visual styling comparison
        const hasStylingEvidence = /variant|outline|ghost|default|primary|solid|filled|identical|equal.*emphasis|similar.*appearance|same.*styl|no.*distinction|equal.*weight|visual.*weight/.test(combined);
        if (!hasStylingEvidence) {
          console.log(`U1 Case A: Filtering out - no styling comparison evidence: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Check for false positives: primary is filled AND secondary is outline/ghost → PASS
        const primaryIsFilled = /(?:submit|primary|confirm|save|create|send|continue).*(?:filled|solid|prominent|dark|colored|bg-)/.test(combined) ||
                                /primary.*(?:filled|solid|prominent)/.test(combined);
        const secondaryIsOutlined = /(?:cancel|secondary|dismiss|close).*(?:outline|ghost|transparent|border)/.test(combined) ||
                                    /secondary.*(?:outline|ghost)/.test(combined);
        
        if (primaryIsFilled && secondaryIsOutlined) {
          console.log(`U1 Case A: Filtering out - correct hierarchy (primary=filled, secondary=outlined): ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Must explicitly state BOTH buttons appear similar
        const claimsEqualEmphasis = /equal.*emphasis|identical|same.*styl|both.*outline|both.*ghost|both.*filled|no.*distinction|equal.*weight/.test(combined);
        const explicitlyBothSimilar = /both.*(?:appear|look|are|use).*(?:outline|ghost|filled|identical|same)|neither.*(?:filled|prominent)|no.*visual.*distinction/.test(combined);
        
        if (claimsEqualEmphasis && !explicitlyBothSimilar) {
          console.log(`U1 Case A: Filtering out - claims equal emphasis without explicit comparison: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        console.log(`U1 Case A: Valid violation with evidence: ${v.evidence?.substring(0, 100)}`);
        return true;
      }
      
      // ========== CASE B: Multiple competing primary actions ==========
      // Expanded to detect competing primaries in Card footers, action bars, button groups
      // Key patterns: multiple filled buttons, card/footer context, multiple action labels
      // CRITICAL: For shadcn Button - when variant prop is omitted, defaults to variant="default" (filled/high emphasis)
      const isCaseB = caseType === 'B' || 
        /(?:two|2|multiple|both|all).*(?:filled|primary|high.*emphasis)/.test(combined) ||
        /competing.*(?:primary|action)/.test(combined) ||
        /all.*(?:filled|prominent)/.test(combined) ||
        /no.*(?:clear|single).*(?:primary|dominant|hierarchy)/.test(combined) ||
        /equally.*(?:emphasized|prominent)/.test(combined) ||
        /same.*(?:emphasis|prominence|visual)/.test(combined) ||
        /multiple.*equally/.test(combined) ||
        /identical.*(?:visual|prominence|weight|styling)/.test(combined) ||
        // Card/footer context with action labels
        /(?:card|footer|cardfooter|cardactions|action\s*(?:bar|area|group)).*(?:save|share|apply|submit|publish)/.test(combined) ||
        // Multiple action labels together
        /(?:save|share|apply).*(?:and|,|\/)\s*(?:save|share|apply|submit|publish)/.test(combined) ||
        // ProposalCard or similar card components with multiple actions
        /(?:proposal|settings|edit|detail).*(?:card|panel|section).*(?:save|share|apply|submit)/.test(combined);
      
      if (isCaseB) {
        // Must evidence 2+ actions or buttons (>=2 is enough to trigger)
        const hasTwoOrMore = /two|2|both|multiple|all.*button|several|three|3/.test(combined);
        const buttonCount = (combined.match(/\bbutton/g) || []).length;
        const ctaCount = (combined.match(/\bcta/g) || []).length;
        // Expanded action label detection
        const actionLabels = (combined.match(/\b(save|share|apply|submit|publish|send|create|confirm|delete|remove|draft|update|export|download)\b/g) || []);
        const uniqueActionLabels = new Set(actionLabels);
        
        // Count action mentions even without explicit "button" word
        const hasMultipleActionMentions = uniqueActionLabels.size >= 2;
        
        if (!hasTwoOrMore && buttonCount < 2 && ctaCount < 2 && !hasMultipleActionMentions) {
          console.log(`U1 Case B: Filtering out - does not evidence 2+ actions: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Evidence for high emphasis: filled/solid styling (visual inspection for screenshots)
        // CRITICAL: For vision analysis, look for buttons that appear equally styled/prominent
        const hasMultipleHighEmphasis = 
          // Explicit multiple high-emphasis mentions
          /(?:both|two|2|all|multiple|three|3).*(?:filled|primary|solid|prominent|dark|colored|high.*emphasis)/.test(combined) ||
          // Multiple filled patterns
          /(?:filled|primary|solid).*(?:and|,|\/)\s*(?:filled|primary|solid)/.test(combined) ||
          // No clear/single primary
          /no.*(?:single|clear).*(?:dominant|primary|hierarchy)/.test(combined) ||
          // Equal emphasis
          /equally.*(?:emphasized|prominent|styled|weighted)/.test(combined) ||
          /same.*(?:emphasis|prominence|styling|visual|weight|color|background)/.test(combined) ||
          /multiple.*equally/.test(combined) ||
          // All appear as filled/solid
          /all\s+(?:three|two|2|3|\d+)?\s*(?:buttons?|ctas?|actions?)\s*(?:appear|look|are|have)/.test(combined) ||
          /(?:buttons?|ctas?)\s+all\s+(?:appear|look|are)/.test(combined) ||
          // Identical visual treatment
          /identical.*(?:styling|visual|weight|prominence|appearance|color)/.test(combined) ||
          // No visually distinguished
          /no.*(?:visually?\s+)?(?:distinguished|dominant|clear\s+primary)/.test(combined) ||
          // Equal visual weight/prominence
          /equal\s+(?:visual\s+)?(?:weight|prominence|emphasis)/.test(combined);
        
        // Also check for card action group context with multiple action labels
        const isCardActionContext = 
          /(?:card|cardfooter|cardactions|footer|action\s*(?:bar|area|group)|button\s*(?:group|row))/.test(combined);
        
        // If we have card context + multiple action labels, that's strong evidence for Case B
        const cardWithMultipleActions = isCardActionContext && hasMultipleActionMentions;
        
        if (!hasMultipleHighEmphasis && !cardWithMultipleActions) {
          console.log(`U1 Case B: Filtering out - no evidence of multiple high-emphasis actions: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // FALSE POSITIVE CHECK: If exactly one action is clearly dominant with demoted others, this is NOT Case B
        const singlePrimaryExists = /(?:single|one|only).*(?:primary|filled|prominent)/.test(combined) && 
                                    !/no.*(?:single|clear)|(?:two|both|multiple)/.test(combined);
        const othersAreDemoted = /(?:other|rest|remaining).*(?:outline|ghost|secondary|demoted)/.test(combined);
        if (singlePrimaryExists && othersAreDemoted) {
          console.log(`U1 Case B: Filtering out - single primary action exists with demoted others (correct hierarchy): ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Check for false positive: actions are clearly separated by context (header vs footer)
        const separatedByContext = /(?:header|top).*(?:footer|bottom)|one\s+in\s+(?:header|top).*one\s+in\s+(?:footer|bottom)/.test(combined);
        if (separatedByContext) {
          console.log(`U1 Case B: Filtering out - actions separated by context (header/footer): ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        console.log(`U1 Case B: Valid violation - multiple equally emphasized actions: ${v.evidence?.substring(0, 100)}`);
        return true;
      }
      
      // ========== CASE C: Hidden affordance in default state ==========
      const isCaseC = caseType === 'C' || /hidden.*affordance|no.*visible.*(?:background|border|styling)|plain.*text|lacks.*button.*styling|discover.*click/.test(combined);
      
      if (isCaseC) {
        // Must evidence lack of button affordance
        const hasHiddenAffordanceEvidence = /no.*(?:background|border|shadow)|text.*only|plain.*text|link.*style|minimal.*styling|lacks.*affordance|not.*visible|no.*button.*styling/.test(combined);
        if (!hasHiddenAffordanceEvidence) {
          console.log(`U1 Case C: Filtering out - no evidence of hidden affordance: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Must identify the element as a primary/important action
        const isPrimaryAction = /(?:submit|confirm|save|create|send|primary|important|main).*(?:action|button)/.test(combined);
        if (!isPrimaryAction) {
          console.log(`U1 Case C: Filtering out - element not identified as primary action: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        console.log(`U1 Case C: Valid violation with evidence: ${v.evidence?.substring(0, 100)}`);
        return true;
      }
      
      // ========== CASE D: Primary action visually de-emphasized ==========
      const isCaseD = caseType === 'D' || /primary.*(?:outline|ghost|less.*prominent)|secondary.*(?:more|higher).*(?:prominent|emphasis)|inverted.*hierarchy/.test(combined);
      
      if (isCaseD) {
        // Must evidence primary has low emphasis
        const primaryLowEmphasis = /(?:submit|confirm|save|primary).*(?:outline|ghost|text|de-emphasis|less.*prominent)|primary.*(?:appears?|looks?).*(?:outline|ghost|secondary)/.test(combined);
        if (!primaryLowEmphasis) {
          console.log(`U1 Case D: Filtering out - no evidence of primary de-emphasis: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Must evidence secondary has higher emphasis
        const secondaryHighEmphasis = /(?:cancel|secondary|dismiss).*(?:filled|solid|more.*prominent|higher.*emphasis)|secondary.*(?:appears?|looks?).*(?:filled|primary|prominent)/.test(combined);
        if (!secondaryHighEmphasis) {
          console.log(`U1 Case D: Filtering out - no evidence of secondary having higher emphasis: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        console.log(`U1 Case D: Valid violation with evidence: ${v.evidence?.substring(0, 100)}`);
        return true;
      }
      
      // ========== Fallback: Generic U1 validation for untagged cases ==========
      // Must mention at least two distinct actions/buttons
      const hasTwoActions = /\btwo\b|\bboth\b|\band\b.*\bbutton|\bcancel.*submit\b|\bsubmit.*cancel\b|\bprimary.*secondary\b|\bsecondary.*primary\b|\bconfirm.*cancel\b|\bcancel.*confirm\b/.test(combined);
      const mentionsMultipleButtons = (combined.match(/\bbutton/g) || []).length >= 2;
      if (!hasTwoActions && !mentionsMultipleButtons) {
        console.log(`U1: Filtering out - does not evidence two actions: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // Must identify styling comparison
      const hasStylingEvidence = /variant|outline|ghost|default|primary|solid|filled|identical|equal.*emphasis|similar.*appearance|same.*styl|no.*distinction|equal.*weight|visual.*weight/.test(combined);
      if (!hasStylingEvidence) {
        console.log(`U1: Filtering out - no styling comparison evidence: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // Check for false positives
      const primaryIsFilled = /(?:submit|primary|confirm|save|create|send|continue).*(?:filled|solid|prominent|dark|colored|bg-)/.test(combined) ||
                              /primary.*(?:filled|solid|prominent)/.test(combined);
      const secondaryIsOutlined = /(?:cancel|secondary|dismiss|close).*(?:outline|ghost|transparent|border)/.test(combined) ||
                                  /secondary.*(?:outline|ghost)/.test(combined);
      
      if (primaryIsFilled && secondaryIsOutlined) {
        console.log(`U1: Filtering out - correct hierarchy (primary=filled, secondary=outlined): ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      console.log(`U1: Valid violation with evidence: ${v.evidence?.substring(0, 100)}`);
      return true;
    });
    
    if (u1Violations.length > 0 && validatedU1Violations.length === 0) {
      console.log(`U1: No valid violations found (${u1Violations.length} filtered out as speculative or lacking evidence)`);
    }
    
    // Process non-A1/A2/A4/A5/U1 violations
    const filteredOtherViolations = [...nonU1OtherViolations, ...validatedU1Violations]
      .map((v: any) => {
        const rule = allRulesForViolations.find(r => r.id === v.ruleId);
        
        return {
          ...v,
          correctivePrompt: rule?.correctivePrompt || v.correctivePrompt || '',
        };
      });

    // ========== A1 AGGREGATION LOGIC (Screenshot Analysis - PER-ELEMENT DETERMINISTIC) ==========
    // For screenshots: A1 evaluates EACH text element INDIVIDUALLY:
    // - Confirmed Violation: ratio clearly < threshold (< 4.3:1 for normal text)
    // - Borderline Contrast: ratio near threshold (4.3:1 to 4.5:1) - reduced confidence
    // - Pass: ratio meets threshold (DO NOT include in violations)
    // - Potential Risk: ONLY when measurement is genuinely impossible
    interface A1AffectedItemUI {
      screenshotIndex?: number; // Which screenshot (1-based)
      location: string; // UI region description
      componentName?: string; // Component if identifiable
      elementRole?: string; // Semantic role: caption, badge, metadata, heading, etc.
      elementDescription?: string; // What type of text element
      foregroundHex?: string; // Sampled foreground color (REQUIRED for confirmed)
      backgroundHex?: string; // Sampled background color (REQUIRED for confirmed)
      contrastRatio?: number; // Computed contrast ratio (REQUIRED for confirmed)
      thresholdUsed?: number; // 4.5 or 3.0 based on text size
      potentialRiskReason?: string; // Why ratio couldn't be computed (for potential only)
      riskLevel: 'high' | 'medium' | 'low';
      status: 'confirmed' | 'borderline' | 'potential'; // Per-element classification
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }
    
    const a1DedupeMapUI = new Map<string, A1AffectedItemUI>();
    
    for (const v of a1Violations) {
      const evidence = (v.evidence || '').toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidence + ' ' + diagnosis;
      
      // Extract screenshot index if mentioned
      const screenshotMatch = (v.evidence || '').match(/screenshot\s*#?(\d+)/i);
      const screenshotIndex = screenshotMatch ? parseInt(screenshotMatch[1], 10) : undefined;
      
      // Extract location from evidence
      const locationMatch = (v.evidence || v.contextualHint || '').match(/(?:in\s+(?:the\s+)?)?([a-zA-Z\s]+(?:dialog|modal|card|form|section|area|component|panel|header|footer|sidebar|button|navigation|content|page|screen|badge|text|label|metadata)?)/i);
      const location = locationMatch?.[1]?.trim() || v.evidence || v.contextualHint || 'UI element';
      
      // Extract component name if mentioned (PascalCase)
      const componentMatch = (v.evidence || '').match(/\b([A-Z][a-zA-Z0-9]*(?:Card|Button|Dialog|Modal|Form|Header|Footer|Nav|Sidebar|Panel|Badge|Label|Text|Description)?)\b/);
      const componentName = componentMatch?.[1] && componentMatch[1].length > 3 ? componentMatch[1] : undefined;
      
      // Extract element role for per-element reporting
      const elementRole = v.elementRole || 
        (/badge/i.test(combined) ? 'badge' :
         /caption/i.test(combined) ? 'caption' :
         /metadata|date|time|credit/i.test(combined) ? 'metadata' :
         /heading|title/i.test(combined) ? 'heading' :
         /button|cta/i.test(combined) ? 'button label' :
         /body|paragraph/i.test(combined) ? 'body text' :
         /label/i.test(combined) ? 'label' :
         'text element');
      
      // Parse contrastRatio as number if it's a string
      let contrastRatio: number | undefined = undefined;
      if (v.contrastRatio !== undefined) {
        contrastRatio = typeof v.contrastRatio === 'string' 
          ? parseFloat(v.contrastRatio.replace(':1', '').trim())
          : v.contrastRatio;
      }
      
      // Determine threshold based on text size
      const threshold = v.thresholdUsed || 4.5;
      const borderlineThreshold = threshold === 4.5 ? 4.3 : 2.7; // ~95% of threshold for borderline zone
      
      // PER-ELEMENT STATUS CLASSIFICATION:
      // 1. If ratio >= threshold → PASS (exclude from violations entirely)
      // 2. If ratio between borderlineThreshold and threshold → BORDERLINE (near-threshold, reduced confidence)
      // 3. If ratio < borderlineThreshold → CONFIRMED VIOLATION
      // 4. If measurement impossible → POTENTIAL
      let status: 'confirmed' | 'borderline' | 'potential' = 'confirmed';
      let potentialRiskReason: string | undefined = undefined;
      
      // First check if element PASSES (meets threshold) - EXCLUDE from violations
      if (contrastRatio !== undefined && contrastRatio >= threshold) {
        console.log(`A1 PASS: ${v.evidence || 'element'} has ratio ${contrastRatio}:1 >= ${threshold}:1 threshold`);
        continue; // Skip this element - it passes WCAG AA
      }
      
      // Check for borderline vs confirmed violation
      if (v.status === 'potential' && v.potentialRiskReason) {
        // Legitimate potential risk - measurement genuinely impossible
        status = 'potential';
        potentialRiskReason = v.potentialRiskReason;
      } else if (v.status === 'borderline' || 
                 (contrastRatio !== undefined && contrastRatio >= borderlineThreshold && contrastRatio < threshold)) {
        // Borderline contrast - near threshold (4.3-4.5:1 zone for normal text)
        status = 'borderline';
      } else if (contrastRatio !== undefined && v.foregroundHex && v.backgroundHex) {
        // Clear violation with computed data
        status = 'confirmed';
      } else if (/gradient|image|overlay|transparent|non-uniform|cannot sample|cannot compute/.test(combined)) {
        // LLM indicated measurement is impossible
        status = 'potential';
        potentialRiskReason = 'Background complexity prevents stable contrast measurement';
      } else {
        // Default to confirmed for screenshot input
        status = 'confirmed';
      }
      
      // Determine risk level based on contrast ratio or description
      let riskLevel: 'high' | 'medium' | 'low' = v.riskLevel || 'medium';
      if (contrastRatio !== undefined) {
        // Risk level based on how far below threshold
        const threshold = v.thresholdUsed || 4.5;
        if (contrastRatio < threshold * 0.5) riskLevel = 'high'; // Less than 50% of threshold
        else if (contrastRatio < threshold * 0.75) riskLevel = 'medium'; // 50-75% of threshold
        else riskLevel = 'low'; // Close to threshold
      } else if (!v.riskLevel) {
        // Infer from description for potential risks
        if (/very light|very faint|barely visible|hard to read|extremely light/.test(combined)) {
          riskLevel = 'high';
        } else if (/light gray|faint|low contrast/.test(combined)) {
          riskLevel = 'medium';
        }
      }
      
      // CONFIDENCE BASED ON STATUS AND DATA QUALITY:
      // - Confirmed (ratio < 4.3:1) with full data: 0.88-0.95
      // - Confirmed without full data: 0.80-0.88
      // - Borderline (ratio 4.3-4.5:1): 0.65-0.75 (reduced due to threshold proximity)
      // - Potential (measurement impossible): 0.50-0.70
      let confidence = v.confidence || 0.55;
      if (status === 'confirmed') {
        if (contrastRatio !== undefined && v.foregroundHex && v.backgroundHex) {
          // Full data available → high confidence
          confidence = Math.min(Math.max(confidence, 0.88), 0.95);
        } else {
          // Confirmed but missing some data
          confidence = Math.min(Math.max(confidence, 0.80), 0.88);
        }
      } else if (status === 'borderline') {
        // Borderline contrast - reduced confidence due to threshold proximity
        confidence = Math.min(Math.max(confidence, 0.65), 0.75);
      } else {
        // Potential risk - measurement was impossible
        confidence = Math.min(Math.max(confidence, 0.50), 0.70);
      }
      
      // Build rationale based on status and available data
      let rationale = v.diagnosis || '';
      if (!rationale) {
        const thresholdVal = v.thresholdUsed || 4.5;
        const colorInfo = v.foregroundHex && v.backgroundHex 
          ? ` (${v.foregroundHex} on ${v.backgroundHex})`
          : '';
        
        if (status === 'confirmed') {
          const ratioInfo = contrastRatio !== undefined
            ? ` has ${contrastRatio}:1 contrast, failing WCAG AA minimum of ${thresholdVal}:1.`
            : ' fails to meet WCAG AA contrast requirements.';
          rationale = `${v.elementDescription || elementRole || `Text in ${location}`}${colorInfo}${ratioInfo}`;
        } else if (status === 'borderline') {
          rationale = `${v.elementDescription || elementRole || `Text in ${location}`}${colorInfo} has ${contrastRatio}:1 contrast—borderline near WCAG AA ${thresholdVal}:1 threshold.`;
        } else {
          rationale = `Text in ${location} cannot be measured for contrast due to ${potentialRiskReason || 'background complexity'}. Manual verification recommended.`;
        }
      }
      
      // Deduplication key - include contrastRatio in key for precise deduping
      const dedupeKey = `${screenshotIndex || 0}|${location}|${contrastRatio || 'unknown'}`;
      
      if (a1DedupeMapUI.has(dedupeKey)) {
        const existing = a1DedupeMapUI.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
        }
        // Upgrade to confirmed if any finding in same location is confirmed
        if (status === 'confirmed') {
          existing.status = 'confirmed';
        }
      } else {
        const item: A1AffectedItemUI = {
          screenshotIndex,
          location,
          componentName,
          elementRole,
          elementDescription: v.elementDescription,
          foregroundHex: v.foregroundHex,
          backgroundHex: v.backgroundHex,
          contrastRatio: contrastRatio,
          thresholdUsed: v.thresholdUsed,
          potentialRiskReason: potentialRiskReason,
          riskLevel,
          status,
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
        };
        a1DedupeMapUI.set(dedupeKey, item);
      }
    }
    
    const a1AffectedItemsUI = Array.from(a1DedupeMapUI.values());
    
    // Create aggregated A1 result if there are any items
    let aggregatedA1UI: any = null;
    if (a1AffectedItemsUI.length > 0) {
      // Count by status and risk level
      const confirmedCount = a1AffectedItemsUI.filter(i => i.status === 'confirmed').length;
      const borderlineCount = a1AffectedItemsUI.filter(i => i.status === 'borderline').length;
      const potentialCount = a1AffectedItemsUI.filter(i => i.status === 'potential').length;
      const highRiskCount = a1AffectedItemsUI.filter(i => i.riskLevel === 'high').length;
      const mediumRiskCount = a1AffectedItemsUI.filter(i => i.riskLevel === 'medium').length;
      const lowRiskCount = a1AffectedItemsUI.filter(i => i.riskLevel === 'low').length;
      
      // Determine overall status (confirmed > borderline > potential)
      // Confirmed violations are blocking; borderline are advisory; potential are unmeasurable
      let overallStatus: 'confirmed' | 'borderline' | 'potential' = 'potential';
      if (confirmedCount > 0) overallStatus = 'confirmed';
      else if (borderlineCount > 0) overallStatus = 'borderline';
      
      // Determine overall risk level (highest tier present)
      let overallRiskLevel: 'high' | 'medium' | 'low' = 'low';
      if (highRiskCount > 0) overallRiskLevel = 'high';
      else if (mediumRiskCount > 0) overallRiskLevel = 'medium';
      
      // Calculate overall confidence (max of all findings)
      const overallConfidence = Math.max(...a1AffectedItemsUI.map(i => i.confidence));
      
      // Build confidence reason - includes borderline items
      const itemsWithRatio = a1AffectedItemsUI.filter(i => i.contrastRatio !== undefined);
      let confidenceReason = '';
      if (overallStatus === 'confirmed') {
        confidenceReason = itemsWithRatio.length > 0
          ? `Contrast ratios computed for ${itemsWithRatio.length} element(s). ` +
            `${confirmedCount} confirmed violation(s) with measured ratios below WCAG AA thresholds.` +
            (borderlineCount > 0 ? ` ${borderlineCount} borderline element(s) near threshold.` : '')
          : `${confirmedCount} finding(s) with insufficient contrast identified via screenshot analysis.`;
      } else if (overallStatus === 'borderline') {
        confidenceReason = `${borderlineCount} element(s) have borderline contrast near WCAG AA threshold (4.3:1–4.5:1 zone). ` +
          `These are near-threshold findings—consider increasing contrast for safety margin.`;
      } else {
        confidenceReason = `${potentialCount} element(s) could not be measured due to background complexity. ` +
          `Manual verification with browser dev tools recommended.`;
      }
      
      // Build unique location names list
      const invalidLocations = new Set([
        'ui area', 'area', 'component', 'element', 'item', 'text', 'the', 'unknown', 'ui element'
      ]);
      
      const uniqueLocations = new Set<string>();
      for (const item of a1AffectedItemsUI) {
        const loc = item.elementDescription || item.componentName || item.location || '';
        if (loc && loc.length > 2 && !invalidLocations.has(loc.toLowerCase())) {
          uniqueLocations.add(loc);
        }
      }
      
      // Build deduplicated list (max 4, with "and N more")
      const uniqueLocationsArray = Array.from(uniqueLocations);
      const displayLimit = 4;
      const displayedLocations = uniqueLocationsArray.slice(0, displayLimit);
      const moreCount = uniqueLocationsArray.length - displayLimit;
      const moreText = moreCount > 0 ? ` and ${moreCount} more` : '';
      
      const areaCountText = uniqueLocationsArray.length > 0 
        ? `${uniqueLocationsArray.length} element(s): ${displayedLocations.join(', ')}${moreText}`
        : `${a1AffectedItemsUI.length} location(s)`;
      
      // Build risk/status breakdown text - include borderline
      const statusBreakdown = [
        confirmedCount > 0 ? `${confirmedCount} confirmed` : '',
        borderlineCount > 0 ? `${borderlineCount} borderline` : '',
        potentialCount > 0 ? `${potentialCount} potential` : '',
      ].filter(Boolean).join(', ');
      
      const riskBreakdown = [
        highRiskCount > 0 ? `${highRiskCount} high-risk` : '',
        mediumRiskCount > 0 ? `${mediumRiskCount} medium-risk` : '',
        lowRiskCount > 0 ? `${lowRiskCount} low-risk` : '',
      ].filter(Boolean).join(', ');
      
      // Build summary based on status - per-element findings
      const confirmedWithRatios = a1AffectedItemsUI.filter(i => i.status === 'confirmed' && i.contrastRatio);
      const borderlineWithRatios = a1AffectedItemsUI.filter(i => i.status === 'borderline' && i.contrastRatio);
      
      const confirmedRatioDetails = confirmedWithRatios.length > 0
        ? ` Measured: ${confirmedWithRatios.slice(0, 3).map(i => `${i.contrastRatio}:1`).join(', ')}${confirmedWithRatios.length > 3 ? ` (+${confirmedWithRatios.length - 3} more)` : ''}.`
        : '';
      const borderlineRatioDetails = borderlineWithRatios.length > 0
        ? ` Borderline: ${borderlineWithRatios.slice(0, 2).map(i => `${i.contrastRatio}:1`).join(', ')}.`
        : '';
      
      let summary = '';
      if (overallStatus === 'confirmed') {
        summary = `${confirmedCount} text contrast violation(s) in ${areaCountText} fail WCAG AA requirements.${confirmedRatioDetails}${borderlineCount > 0 ? ` ${borderlineCount} additional element(s) have borderline contrast.` : ''}`;
      } else if (overallStatus === 'borderline') {
        summary = `${borderlineCount} element(s) in ${areaCountText} have borderline contrast near WCAG AA threshold.${borderlineRatioDetails} Consider increasing contrast for safety margin.`;
      } else {
        summary = `${potentialCount} element(s) could not be measured for contrast (${a1AffectedItemsUI.map(i => i.potentialRiskReason || 'background complexity').filter((v, i, a) => a.indexOf(v) === i).join(', ')}).`;
      }
      
      let contextualHint = '';
      if (overallStatus === 'confirmed') {
        contextualHint = 'Increase text color contrast to meet WCAG AA minimum (4.5:1 for normal text, 3:1 for large text).';
      } else if (overallStatus === 'borderline') {
        contextualHint = 'Consider increasing contrast slightly above 4.5:1 to provide safety margin for borderline elements.';
      } else {
        contextualHint = 'Use browser dev tools to compute exact contrast ratios for elements with complex backgrounds.';
      }
      
      const a1Rule = allRulesForViolations.find(r => r.id === 'A1');
      
      // Build specific, actionable corrective prompt for confirmed violations (screenshot input)
      // Include: affected element, colors, ratio, fix directive, application-wide scope
      let correctivePrompt = '';
      if (overallStatus === 'confirmed') {
        // Get the first confirmed item with the most specific data
        const confirmedItems = a1AffectedItemsUI.filter(i => i.status === 'confirmed');
        const primaryItem = confirmedItems.find(i => i.foregroundHex && i.backgroundHex) || confirmedItems[0];
        
        if (primaryItem) {
          // Build element description (e.g., "course card metadata text", "header subtitle")
          const elementDesc = primaryItem.elementDescription 
            ? primaryItem.elementDescription.toLowerCase()
            : primaryItem.componentName 
              ? `${primaryItem.componentName} text`
              : `text in ${primaryItem.location}`;
          
          // Build color details if available
          const colorDetails = primaryItem.foregroundHex && primaryItem.backgroundHex
            ? ` The foreground color ${primaryItem.foregroundHex} on ${primaryItem.backgroundHex} background`
            : ' The current text color';
          
          // Build ratio details
          const ratioDetails = primaryItem.contrastRatio
            ? ` results in insufficient contrast (${primaryItem.contrastRatio}:1).`
            : ' has insufficient contrast for WCAG AA compliance.';
          
          // Determine suggested fix based on detected colors
          const suggestedFix = primaryItem.foregroundHex?.toLowerCase().includes('9ca3af') ||
                              primaryItem.foregroundHex?.toLowerCase().includes('d1d5db') ||
                              /gray-300|gray-400|text-gray/.test(primaryItem.location || '')
            ? 'Replace low-contrast gray text (e.g., text-gray-300/400) with higher-contrast tokens such as text-gray-700 or theme foreground colors.'
            : 'Replace low-contrast text colors with higher-contrast tokens (e.g., text-gray-700 or theme foreground) to meet WCAG AA 4.5:1 minimum for normal text.';
          
          // List all unique affected locations for application-wide scope
          const allLocations = Array.from(new Set(confirmedItems.map(i => i.location).filter(Boolean)));
          const locationScope = allLocations.length > 1
            ? ` Apply this change to all affected elements: ${allLocations.slice(0, 3).join(', ')}${allLocations.length > 3 ? `, and ${allLocations.length - 3} more` : ''}.`
            : '';
          
          correctivePrompt = `In the ${elementDesc},${colorDetails}${ratioDetails} ${suggestedFix}${locationScope} Ensure contrast fixes are applied consistently across all similar elements throughout the application.`;
        } else {
          // Fallback generic prompt if no detailed data
          correctivePrompt = 'Replace low-contrast text colors with higher-contrast tokens (e.g., text-gray-700 or theme foreground colors) to meet WCAG AA 4.5:1 minimum for normal text. Apply this change consistently across all affected areas throughout the application.';
        }
      }
      // No mandatory corrective prompt for potential risks - advisory guidance only
      
      // No input limitation for confirmed violations (screenshot is definitive for obvious issues)
      // Borderline gets advisory about threshold proximity
      let inputLimitation: string | undefined = undefined;
      if (overallStatus === 'potential') {
        inputLimitation = 'Background complexity prevents stable contrast measurement. Use browser dev tools to compute exact ratio.';
      } else if (overallStatus === 'borderline') {
        inputLimitation = 'Contrast falls near WCAG AA threshold (4.3:1–4.5:1). Consider increasing for safety margin.';
      }
      
      // Advisory guidance for potential risks and borderline findings
      let advisoryGuidance: string | undefined = undefined;
      if (overallStatus === 'potential') {
        advisoryGuidance = 'This is a potential risk due to unmeasurable contrast. Actual compliance depends on computed ratio.';
      } else if (overallStatus === 'borderline') {
        advisoryGuidance = 'Borderline contrast near WCAG AA threshold—technically may pass, but increasing contrast provides safety margin.';
      }
      
      aggregatedA1UI = {
        ruleId: 'A1',
        ruleName: 'Insufficient text contrast',
        category: 'accessibility',
        status: overallStatus,
        inputType: 'screenshots', // Explicit input type tracking
        overall_confidence: Math.round(overallConfidence * 100) / 100,
        confidence_reason: confidenceReason,
        summary,
        riskLevel: overallRiskLevel,
        inputLimitation,
        advisoryGuidance,
        affected_items: a1AffectedItemsUI.map(item => ({
          screenshotIndex: item.screenshotIndex,
          location: item.location,
          componentName: item.componentName,
          elementRole: item.elementRole,
          elementDescription: item.elementDescription,
          foregroundHex: item.foregroundHex,
          backgroundHex: item.backgroundHex,
          contrastRatio: item.contrastRatio,
          thresholdUsed: item.thresholdUsed,
          riskLevel: item.riskLevel,
          status: item.status,
          confidence: item.confidence,
          rationale: item.rationale,
          ...(item.occurrence_count && item.occurrence_count > 1 ? { occurrence_count: item.occurrence_count } : {}),
        })),
        // For confirmed violations, also pass through top-level contrast data for display
        ...(overallStatus === 'confirmed' && a1AffectedItemsUI[0]?.foregroundHex ? {
          foregroundHex: a1AffectedItemsUI[0].foregroundHex,
          backgroundHex: a1AffectedItemsUI[0].backgroundHex,
          contrastRatio: a1AffectedItemsUI[0].contrastRatio,
          elementDescription: a1AffectedItemsUI[0].elementDescription,
        } : {}),
        diagnosis: summary,
        contextualHint,
        correctivePrompt,
        confidence: Math.round(overallConfidence * 100) / 100,
      };
      
      console.log(`A1 aggregated: ${a1Violations.length} findings → 1 result (${statusBreakdown}, ${riskBreakdown})`);
    }

    // ========== A2 AGGREGATION LOGIC (Screenshot Analysis) ==========
    interface A2AffectedItemUI {
      component_name: string;
      location: string;
      size_estimate: string;
      semantic_role: string;
      severity: 'violation' | 'warning';
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }
    
    const dedupeMapUI = new Map<string, A2AffectedItemUI>();
    
    for (const v of a2Violations) {
      const evidence = (v.evidence || '').toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidence + ' ' + diagnosis;
      
      // FILTER: Normal-sized text (~14px or larger) should NOT be reported
      const mentionsNormalSize = /normal size|normal-sized|adequate|14px|~14px|approximately 14|appears normal/.test(combined);
      const mentionsSmall = /noticeably small|very small|tiny|<13|smaller than 13|clearly small/.test(combined);
      
      // If text appears normal sized and not explicitly small, filter out
      if (mentionsNormalSize && !mentionsSmall) {
        console.log(`Filtering out A2 (normal text size): ${v.evidence}`);
        continue;
      }
      
      // Filter out excluded elements
      const isExcludedElement = /\bbutton\b|icon|navigation|menu item|action button/.test(combined);
      if (isExcludedElement && !/description|label|helper|caption/.test(combined)) {
        console.log(`Filtering out A2 (excluded element): ${v.evidence}`);
        continue;
      }
      
      // Extract info from evidence/diagnosis for screenshots
      // Priority: 1) Named UI element, 2) Location description, 3) Fallback to location only
      const locationMatch = (v.evidence || v.contextualHint || '').match(/(?:in\s+(?:the\s+)?)?([a-zA-Z\s]+(?:dialog|modal|card|form|section|area|component|panel|header|footer|sidebar|tooltip|popover|alert|banner)?)/i);
      const componentMatch = (v.evidence || '').match(/([A-Z][a-zA-Z0-9]*(?:Description|Label|Text|Badge|Caption|Content|Title|Subtitle|Header|Footer)?)/);
      
      // Resolve component name - avoid placeholders like "Text" alone
      let componentName = '';
      if (componentMatch?.[1] && componentMatch[1].length > 4) {
        componentName = componentMatch[1];
      }
      // If no specific component, leave empty and rely on location
      
      const location = locationMatch?.[1]?.trim() || v.contextualHint || 'UI area';
      
      // Determine size estimate
      const sizeEstimate = mentionsSmall ? '<13px (visually estimated)' : '13-14px (visually estimated)';
      
      // Determine semantic role
      const semanticRole = /description|label|helper|caption|alert|dialog|form|body text/i.test(combined)
        ? 'informational' 
        : 'secondary';
      
      // Determine severity
      const severity: 'violation' | 'warning' = mentionsSmall ? 'violation' : 'warning';
      
      // Calculate confidence (lower for screenshot analysis)
      let confidence = v.confidence || 0.55;
      if (semanticRole === 'informational') confidence = Math.min(confidence + 0.1, 0.75);
      if (mentionsSmall) confidence = Math.min(confidence + 0.05, 0.75);
      else confidence = Math.max(confidence - 0.1, 0.35);
      
      const rationale = v.diagnosis || `Text appears ${severity === 'violation' ? 'noticeably small' : 'borderline small'} for ${semanticRole} content.`;
      
      // Deduplication key
      const dedupeKey = `${location}|${componentName}|${severity}`;
      
      if (dedupeMapUI.has(dedupeKey)) {
        const existing = dedupeMapUI.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
        }
      } else {
        const item: A2AffectedItemUI = {
          component_name: componentName,
          location,
          size_estimate: sizeEstimate,
          semantic_role: semanticRole,
          severity,
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
        };
        dedupeMapUI.set(dedupeKey, item);
      }
    }
    
    const affectedItemsUI = Array.from(dedupeMapUI.values());
    
    // Create aggregated A2 result if there are any items
    let aggregatedA2UI: any = null;
    if (affectedItemsUI.length > 0) {
      // Calculate overall confidence
      const highImpactItems = affectedItemsUI.filter(i => i.semantic_role === 'informational');
      let overallConfidence: number;
      let confidenceReason: string;
      
      if (highImpactItems.length > 0) {
        overallConfidence = Math.max(...highImpactItems.map(i => i.confidence));
        confidenceReason = `Based on maximum confidence (${overallConfidence.toFixed(2)}) from ${highImpactItems.length} informational element(s).`;
      } else {
        const sortedConfidences = affectedItemsUI.map(i => i.confidence).sort((a, b) => a - b);
        const midIdx = Math.floor(sortedConfidences.length / 2);
        overallConfidence = sortedConfidences.length % 2 === 0
          ? (sortedConfidences[midIdx - 1] + sortedConfidences[midIdx]) / 2
          : sortedConfidences[midIdx];
        confidenceReason = `Based on median confidence (${overallConfidence.toFixed(2)}) across ${affectedItemsUI.length} secondary element(s).`;
      }
      
      const violationCount = affectedItemsUI.filter(i => i.severity === 'violation').length;
      const warningCount = affectedItemsUI.filter(i => i.severity === 'warning').length;
      
      // Build summary with DEDUPLICATED and FILTERED component/location names
      // 1. Extract unique names, filtering out invalid identifiers
      const invalidIdentifiers = new Set([
        'variants', 'variant', 'props', 'className', 'classname', 'style', 'styles',
        'default', 'config', 'options', 'settings', 'utils', 'helpers', 'constants',
        'types', 'index', 'main', 'app', 'root', 'container', 'wrapper', 'layout',
        'component', 'components', 'element', 'elements', 'item', 'items', 'text',
        'unknown', 'undefined', 'null', 'true', 'false', 'ui area', 'area'
      ]);
      
      const uniqueNames = new Set<string>();
      for (const item of affectedItemsUI) {
        // Prefer component_name, then location
        const name = item.component_name || item.location || '';
        // Filter out invalid identifiers (case-insensitive check)
        if (name && name.length > 2 && !invalidIdentifiers.has(name.toLowerCase())) {
          // Also filter out generic location names
          if (!/^(the\s+)?ui\s*(area|section|component)?$/i.test(name)) {
            uniqueNames.add(name);
          }
        }
      }
      
      // 2. Build deduplicated list (max 4, with "and N more")
      const uniqueNamesArray = Array.from(uniqueNames);
      const displayLimit = 4;
      const displayedNames = uniqueNamesArray.slice(0, displayLimit);
      const moreCount = uniqueNamesArray.length - displayLimit;
      const moreText = moreCount > 0 ? ` and ${moreCount} more` : '';
      
      // 3. Build summary with "X unique area(s)" wording
      const locationList = displayedNames.join(', ');
      const areaCountText = uniqueNamesArray.length > 0 
        ? `${uniqueNamesArray.length} unique area(s): ${locationList}${moreText}`
        : `${affectedItemsUI.length} location(s)`;
      
      const summary = `Small text size visually detected in ${areaCountText}. ` +
        `${violationCount > 0 ? `${violationCount} appear noticeably small` : ''}` +
        `${violationCount > 0 && warningCount > 0 ? ' and ' : ''}` +
        `${warningCount > 0 ? `${warningCount} appear borderline` : ''}. ` +
        `WCAG 2.1 does not mandate a minimum font size; however, larger font sizes (approximately 14–16px) are widely adopted in usability and accessibility practice to support readability, particularly for users with low vision.`;
      
      const a2Rule = allRulesForViolations.find(r => r.id === 'A2');
      
      aggregatedA2UI = {
        ruleId: 'A2',
        ruleName: 'Small informational text size',
        category: 'accessibility',
        overall_confidence: Math.round(overallConfidence * 100) / 100,
        confidence_reason: confidenceReason,
        summary,
        affected_items: affectedItemsUI.map(item => ({
          component_name: item.component_name,
          location: item.location,
          size_estimate: item.size_estimate,
          semantic_role: item.semantic_role,
          severity: item.severity,
          confidence: item.confidence,
          rationale: item.rationale,
          ...(item.occurrence_count && item.occurrence_count > 1 ? { occurrence_count: item.occurrence_count } : {}),
        })),
        diagnosis: summary,
        contextualHint: 'Increase small text to at least 14px for informational content; use 16px for primary dialog, alert, and tooltip text.',
        correctivePrompt: a2Rule?.correctivePrompt || '',
        confidence: Math.round(overallConfidence * 100) / 100,
      };
      
      console.log(`A2 aggregated: ${affectedItemsUI.length} items → 1 result (${violationCount} violations, ${warningCount} warnings)`);
    }
    
    // ========== A4 AGGREGATION LOGIC (Screenshot Analysis) ==========
    interface A4AffectedItemUI {
      component_name: string;
      location: string;
      size_estimate: string;
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }
    
    const a4DedupeMapUI = new Map<string, A4AffectedItemUI>();
    const detectedSizeRangesUI = new Set<string>();
    
    // Invalid identifiers for A4 component naming - filter out non-component strings
    const a4InvalidComponentNamesUI = new Set([
      'increase', 'ensure', 'add', 'use', 'apply', 'set', 'get', 'make', 'create',
      'element', 'elements', 'interactive', 'dimensions', 'target', 'targets',
      'minimum', 'size', 'sizes', 'width', 'height', 'padding', 'constraint',
      'button', 'buttons', 'icon', 'icons', 'control', 'controls',
      'component', 'components', 'item', 'items', 'unknown', 'default',
      'variants', 'variant', 'props', 'className', 'style', 'styles'
    ]);
    
    // Helper to validate component name (must be PascalCase, no spaces, no verbs/instructions)
    function isValidA4ComponentNameUI(name: string): boolean {
      if (!name || name.length < 3) return false;
      // Must start with uppercase (PascalCase)
      if (!/^[A-Z]/.test(name)) return false;
      // No spaces allowed
      if (/\s/.test(name)) return false;
      // No instructional/verb phrases
      if (/^(Increase|Ensure|Add|Use|Apply|Set|Get|Make|Create|Should|Must|Will|Can)/i.test(name)) return false;
      // Not in invalid set
      if (a4InvalidComponentNamesUI.has(name.toLowerCase())) return false;
      return true;
    }
    
    for (const v of a4Violations) {
      const evidence = (v.evidence || '');
      const evidenceLower = evidence.toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidenceLower + ' ' + diagnosis;
      
      // Extract component/element info from evidence - prioritize compound PascalCase names
      const compoundMatch = evidence.match(/\b([A-Z][a-zA-Z0-9]*(?:Previous|Next|Button|Icon|Close|Nav|Toggle|Trigger|Control|Action|Arrow|Pagination|Calendar|Carousel))\b/);
      const simpleMatch = evidence.match(/\b([A-Z][a-zA-Z0-9]{3,})\b/);
      const locationMatch = (evidence || v.contextualHint || '').match(/(?:in\s+(?:the\s+)?)?([a-zA-Z\s]+(?:dialog|modal|card|form|section|area|component|panel|header|footer|sidebar|carousel|navigation)?)/i);
      
      // Resolve component name with strict validation
      let componentName = '';
      
      // 1. Try compound component name first (e.g., CarouselPrevious, CalendarNavButton)
      if (compoundMatch?.[1] && isValidA4ComponentNameUI(compoundMatch[1])) {
        componentName = compoundMatch[1];
      }
      // 2. Try simple PascalCase component
      else if (simpleMatch?.[1] && isValidA4ComponentNameUI(simpleMatch[1])) {
        componentName = simpleMatch[1];
      }
      
      const location = locationMatch?.[1]?.trim() || v.contextualHint || 'UI area';
      
      // Estimate size from visual description - be more specific when possible
      let sizeEstimate = '<44px (visual estimate)';
      if (/very small|tiny|noticeably small|~24|~28/.test(combined)) { 
        sizeEstimate = '~24-28px (visual estimate)'; 
        detectedSizeRangesUI.add('~24-28px'); 
      } else if (/small|compact|~32|~36/.test(combined)) { 
        sizeEstimate = '~32-36px (visual estimate)'; 
        detectedSizeRangesUI.add('~32-36px'); 
      } else if (/~40|borderline/.test(combined)) {
        sizeEstimate = '~40px (visual estimate)';
        detectedSizeRangesUI.add('~40px');
      } else { 
        sizeEstimate = '<44px (visual estimate)'; 
        detectedSizeRangesUI.add('<44px'); 
      }
      
      // Calculate confidence (lower for screenshot analysis due to visual estimation)
      let confidence = v.confidence || 0.50;
      // Reduce confidence since visual inspection cannot measure exact dimensions
      confidence = Math.min(confidence, 0.65);
      
      const rationale = v.diagnosis || `Interactive element appears to be below the commonly recommended touch target size of 44×44 CSS px. Visual inspection cannot confirm actual dimensions.`;
      
      // Deduplication key - by component name or location (but filter out generic locations)
      const dedupeKey = componentName || (location !== 'UI area' ? location : 'unknown');
      
      if (a4DedupeMapUI.has(dedupeKey)) {
        const existing = a4DedupeMapUI.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
          existing.size_estimate = sizeEstimate;
        }
      } else {
        const item: A4AffectedItemUI = {
          component_name: componentName,
          location,
          size_estimate: sizeEstimate,
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
        };
        a4DedupeMapUI.set(dedupeKey, item);
      }
    }
    
    const a4AffectedItemsUI = Array.from(a4DedupeMapUI.values());
    
    // Create aggregated A4 result if there are any items
    let aggregatedA4UI: any = null;
    if (a4AffectedItemsUI.length > 0) {
      // Calculate overall confidence (max of all findings - deterministic)
      const overallConfidence = Math.max(...a4AffectedItemsUI.map(i => i.confidence));
      const confidenceReason = `Confidence is based on visual size assessment of interactive elements. Screenshot analysis cannot measure exact rendered dimensions, so findings are based on visual estimation.`;
      
      // Build unique component/location names list - filter out non-component strings
      const invalidIdentifiers = new Set([
        'variants', 'variant', 'props', 'className', 'classname', 'style', 'styles',
        'default', 'config', 'options', 'settings', 'utils', 'helpers', 'constants',
        'types', 'index', 'main', 'app', 'root', 'container', 'wrapper', 'layout',
        'component', 'components', 'element', 'elements', 'item', 'items', 'button',
        'unknown', 'undefined', 'null', 'true', 'false', 'ui area', 'area',
        // Instructional/guideline words that should never be component names
        'increase', 'ensure', 'add', 'use', 'apply', 'set', 'get', 'make', 'create',
        'interactive', 'dimensions', 'target', 'targets', 'minimum', 'size', 'sizes'
      ]);
      
      const uniqueNames = new Set<string>();
      for (const item of a4AffectedItemsUI) {
        // Prefer component_name (PascalCase), then location (if descriptive)
        const name = item.component_name || '';
        // Validate: must be PascalCase, no spaces
        if (name && name.length > 2 && 
            /^[A-Z][a-zA-Z0-9]+$/.test(name) && 
            !invalidIdentifiers.has(name.toLowerCase())) {
          uniqueNames.add(name);
        } else if (item.location && item.location !== 'UI area') {
          // Fall back to location, but only if descriptive and not generic
          const loc = item.location;
          if (loc.length > 3 && !invalidIdentifiers.has(loc.toLowerCase()) &&
              !/^(the\s+)?ui\s*(area|section|component)?$/i.test(loc)) {
            uniqueNames.add(loc);
          }
        }
      }
      
      // Build deduplicated list (max 4, with "and N more")
      const uniqueNamesArray = Array.from(uniqueNames);
      const displayLimit = 4;
      const displayedNames = uniqueNamesArray.slice(0, displayLimit);
      const moreCount = uniqueNamesArray.length - displayLimit;
      const moreText = moreCount > 0 ? ` and ${moreCount} more` : '';
      
      const areaCountText = uniqueNamesArray.length > 0 
        ? `${uniqueNamesArray.length} unique element(s): ${displayedNames.join(', ')}${moreText}`
        : `${a4AffectedItemsUI.length} element(s)`;
      
      
      const sizeRangesText = detectedSizeRangesUI.size > 0 
        ? `Estimated size ranges: ${Array.from(detectedSizeRangesUI).join(', ')}.`
        : '';
      
      const summary = `Interactive elements in ${areaCountText} appear to be below the commonly recommended touch target size of 44×44 CSS px. ${sizeRangesText} ` +
        `44×44 CSS px is commonly recommended in usability and accessibility guidelines (WCAG 2.1 Target Size is AAA, not AA). ` +
        `Visual inspection cannot confirm actual rendered dimensions; padding or layout constraints may increase the clickable area.`;
      
      const a4Rule = allRulesForViolations.find(r => r.id === 'A4');
      
      aggregatedA4UI = {
        ruleId: 'A4',
        ruleName: 'Small tap / click targets',
        category: 'accessibility',
        typeBadge: 'Potential Risk (Heuristic)',
        overall_confidence: Math.round(overallConfidence * 100) / 100,
        confidence_reason: confidenceReason,
        summary,
        detected_size_ranges: Array.from(detectedSizeRangesUI),
        affected_items: a4AffectedItemsUI.map(item => ({
          component_name: item.component_name,
          location: item.location,
          size_estimate: item.size_estimate,
          confidence: item.confidence,
          rationale: item.rationale,
          ...(item.occurrence_count && item.occurrence_count > 1 ? { occurrence_count: item.occurrence_count } : {}),
        })),
        diagnosis: summary,
        contextualHint: 'Explicitly enforce minimum dimensions (44×44 CSS px) for interactive elements using visible padding or size constraints.',
        correctivePrompt: a4Rule?.correctivePrompt || '',
        confidence: Math.round(overallConfidence * 100) / 100,
      };
      
      console.log(`A4 aggregated: ${a4Violations.length} findings → 1 result (${uniqueNamesArray.length} unique elements, sizes: ${Array.from(detectedSizeRangesUI).join(', ')})`);
    }
    
    // ========== A5 AGGREGATION LOGIC (Screenshot Analysis) ==========
    // Process and aggregate A5 violations into a single result object
    // Only report A5 when there is visual evidence of missing focus indicator
    interface A5AffectedItemUI {
      component_name: string;
      location: string;
      typeBadge: 'Confirmed' | 'Heuristic';
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }
    
    const a5DedupeMapUI = new Map<string, A5AffectedItemUI>();
    const a5ValidViolationsUI: any[] = [];
    
    // First pass: filter A5 violations to only include actual violations
    for (const v of a5Violations) {
      const evidence = (v.evidence || '');
      const evidenceLower = evidence.toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidenceLower + ' ' + diagnosis;
      
      // Check for indicators that this is a PASS (has visible focus)
      // Use positive checks for visible focus indicators
      const hasVisibleFocusRing = /has.*ring|visible ring|shows.*ring|focus ring|ring.*focus/i.test(combined);
      const hasVisibleFocusBorder = /has.*border|visible border|shows.*border|focus border|border.*focus/i.test(combined);
      const hasVisibleFocusIndicator = /has.*focus indicator|visible focus indicator|clear focus/i.test(combined);
      
      const hasVisibleReplacement = hasVisibleFocusRing || hasVisibleFocusBorder || hasVisibleFocusIndicator;
      
      // Check if explicitly marked as acceptable
      // IMPORTANT: Avoid matching negative phrases like "no visible", "lacks", etc.
      const mentionsAcceptable = /(?<!no\s)(?<!without\s)(?<!lacks?\s)(?<!missing\s)(?:acceptable|compliant|proper focus|adequate)/i.test(combined);
      const explicitlyPasses = /\bpass\b(?!word)/i.test(combined) && !/does not pass|doesn't pass|fail/i.test(combined);
      
      // If evidence shows visible focus or acceptable, this is a PASS - skip entirely
      if (hasVisibleReplacement) {
        console.log(`A5 PASS (has visible focus indicator): ${evidence}`);
        continue;
      }
      
      if (mentionsAcceptable || explicitlyPasses) {
        console.log(`A5 PASS (explicitly acceptable): ${evidence}`);
        continue;
      }
      
      // Check if screenshot cannot determine focus state
      const cannotDetermine = /cannot determine|unable to assess|not visible in screenshot|no focus state shown/.test(combined);
      if (cannotDetermine) {
        console.log(`A5 SKIP (cannot determine from screenshot): ${evidence}`);
        continue;
      }
      
      // Check for weak indicators (background-only focus)
      const hasBackgroundOnlyFocus = /only.*background|background.*change|background.*color|relies on.*background/.test(combined);
      
      // This is a valid violation - add it
      console.log(`A5 VIOLATION: ${evidence} [background-only: ${hasBackgroundOnlyFocus}]`);
      a5ValidViolationsUI.push({
        ...v,
        isHeuristicRisk: hasBackgroundOnlyFocus,
      });
    }
    
    // Second pass: aggregate valid A5 violations
    // Invalid identifiers for component naming - single words, utility tokens, non-UI terms
    const a5InvalidComponentNamesUI = new Set([
      'clear', 'close', 'open', 'toggle', 'show', 'hide', 'set', 'get', 'add', 'remove',
      'delete', 'edit', 'update', 'create', 'submit', 'cancel', 'save', 'reset',
      'next', 'previous', 'prev', 'back', 'forward', 'up', 'down', 'left', 'right',
      'true', 'false', 'yes', 'no', 'on', 'off', 'enabled', 'disabled',
      'button', 'link', 'input', 'icon', 'text', 'label', 'container', 'wrapper',
      'component', 'element', 'item', 'items', 'default', 'variants', 'variant'
    ]);
    
    for (const v of a5ValidViolationsUI) {
      const evidence = (v.evidence || '');
      const combined = (evidence + ' ' + (v.diagnosis || '')).toLowerCase();
      
      // Extract location description for screenshots (no file paths in screenshots)
      const locationMatch = (evidence || v.contextualHint || '').match(/(?:in\s+(?:the\s+)?)?([a-zA-Z\s]+(?:dialog|modal|card|form|section|area|component|panel|header|footer|sidebar)?)/i);
      
      // Extract PascalCase component names (prioritize compound names like CloseButton, NavToggle)
      const componentMatch = evidence.match(/\b([A-Z][a-zA-Z0-9]*(?:Button|Close|Toggle|Trigger|Nav|Icon|Control|Action|Link|Card|Dialog|Modal|Menu|Header|Footer|Sidebar|Panel|Form))\b/);
      const simpleComponentMatch = evidence.match(/(?:the\s+)?([A-Z][a-zA-Z0-9]{3,})/);
      
      // Resolve component name - prioritize compound PascalCase names
      let componentName = '';
      
      // 1. Try compound component name first (e.g., CloseButton, NavToggle)
      if (componentMatch?.[1] && componentMatch[1].length > 4) {
        componentName = componentMatch[1];
      }
      // 2. Try simple PascalCase component (but not single-word utility names)
      else if (simpleComponentMatch?.[1] && simpleComponentMatch[1].length > 3) {
        const candidate = simpleComponentMatch[1];
        if (!a5InvalidComponentNamesUI.has(candidate.toLowerCase())) {
          componentName = candidate;
        }
      }
      
      // Extract location from matched text
      const location = locationMatch?.[1]?.trim() || v.contextualHint || 'UI area';
      // Determine type badge
      const typeBadge: 'Confirmed' | 'Heuristic' = v.isHeuristicRisk ? 'Heuristic' : 'Confirmed';
      
      // Calculate confidence (lower for screenshot analysis)
      let confidence = v.confidence || 0.55;
      if (v.isHeuristicRisk) {
        confidence = Math.min(confidence, 0.45); // Lower confidence for heuristic
      }
      confidence = Math.min(confidence, 0.65); // Cap for screenshot analysis
      
      const rationale = v.isHeuristicRisk 
        ? 'Focus indication appears to rely only on background color change, which may be insufficient.'
        : 'Interactive element appears to lack a visible focus indicator for keyboard users.';
      
      // Deduplication key
      const dedupeKey = componentName || location || 'unknown';
      
      if (a5DedupeMapUI.has(dedupeKey)) {
        const existing = a5DedupeMapUI.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
        }
      } else {
        const item: A5AffectedItemUI = {
          component_name: componentName,
          location,
          typeBadge,
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
        };
        a5DedupeMapUI.set(dedupeKey, item);
      }
    }
    
    const a5AffectedItemsUI = Array.from(a5DedupeMapUI.values());
    
    // Create aggregated A5 result ONLY if there are actual violations
    let aggregatedA5UI: any = null;
    if (a5AffectedItemsUI.length > 0) {
      // Calculate overall confidence (max of all findings)
      const overallConfidence = Math.max(...a5AffectedItemsUI.map(i => i.confidence));
      
      const confirmedCount = a5AffectedItemsUI.filter(i => i.typeBadge === 'Confirmed').length;
      const heuristicCount = a5AffectedItemsUI.filter(i => i.typeBadge === 'Heuristic').length;
      
      const confidenceReason = `Confidence is based on visual assessment of focus indicators. Screenshot analysis cannot confirm actual focus behavior, so findings are based on visual observation.`;
      
      // Build unique component/location names list - filter out non-semantic identifiers
      const invalidIdentifiers = new Set([
        'variants', 'variant', 'props', 'className', 'classname', 'style', 'styles',
        'default', 'config', 'options', 'settings', 'utils', 'helpers', 'constants',
        'types', 'index', 'main', 'app', 'root', 'container', 'wrapper', 'layout',
        'component', 'components', 'element', 'elements', 'item', 'items', 'button',
        'unknown', 'undefined', 'null', 'true', 'false', 'ui area', 'area',
        // Single words that are not UI components
        'clear', 'close', 'open', 'toggle', 'show', 'hide', 'set', 'get', 'add', 'remove',
        'delete', 'edit', 'update', 'create', 'submit', 'cancel', 'save', 'reset',
        'next', 'previous', 'prev', 'back', 'forward', 'up', 'down', 'left', 'right'
      ]);
      
      const uniqueNames = new Set<string>();
      for (const item of a5AffectedItemsUI) {
        const name = item.component_name || item.location || '';
        if (name && name.length > 2 && !invalidIdentifiers.has(name.toLowerCase())) {
          if (!/^(the\s+)?ui\s*(area|section|component)?$/i.test(name)) {
            uniqueNames.add(name);
          }
        }
      }
      
      // Build deduplicated list (max 4, with "and N more")
      const uniqueNamesArray = Array.from(uniqueNames);
      const displayLimit = 4;
      const displayedNames = uniqueNamesArray.slice(0, displayLimit);
      const moreCount = uniqueNamesArray.length - displayLimit;
      const moreText = moreCount > 0 ? ` and ${moreCount} more` : '';
      
      const areaCountText = uniqueNamesArray.length > 0 
        ? `${uniqueNamesArray.length} unique element(s): ${displayedNames.join(', ')}${moreText}`
        : `${a5AffectedItemsUI.length} element(s)`;
      
      const typeBreakdown = [
        confirmedCount > 0 ? `${confirmedCount} appear to lack visible focus` : '',
        heuristicCount > 0 ? `${heuristicCount} may rely only on background color` : '',
      ].filter(Boolean).join(' and ');
      
      const summary = `Focus visibility issues detected in ${areaCountText}. ${typeBreakdown}. ` +
        `Interactive elements should have visible focus indicators for keyboard accessibility.`;
      
      const a5Rule = allRulesForViolations.find(r => r.id === 'A5');
      
      aggregatedA5UI = {
        ruleId: 'A5',
        ruleName: 'Poor focus visibility',
        category: 'accessibility',
        overall_confidence: Math.round(overallConfidence * 100) / 100,
        confidence_reason: confidenceReason,
        summary,
        affected_items: a5AffectedItemsUI.map(item => ({
          component_name: item.component_name,
          location: item.location,
          typeBadge: item.typeBadge,
          confidence: item.confidence,
          rationale: item.rationale,
          ...(item.occurrence_count && item.occurrence_count > 1 ? { occurrence_count: item.occurrence_count } : {}),
        })),
        diagnosis: summary,
        contextualHint: 'Interactive elements appear to lack visible focus indicators for keyboard users.',
        correctivePrompt: 'Add a visible focus indicator (focus ring, border change, shadow, or distinct background change) for interactive elements. Do not alter layout structure or component behavior beyond focus styling.',
        confidence: Math.round(overallConfidence * 100) / 100,
      };
      
      console.log(`A5 aggregated: ${a5Violations.length} findings → ${a5AffectedItemsUI.length} valid violations → 1 result (${confirmedCount} confirmed, ${heuristicCount} heuristic)`);
    } else {
      console.log(`A5: No valid violations found (${a5Violations.length} filtered out as PASS or NOT APPLICABLE)`);
    }
    
    // Combine all violations
    const enhancedViolations = [
      ...filteredOtherViolations,
      ...(aggregatedA1UI ? [aggregatedA1UI] : []),
      ...(aggregatedA2UI ? [aggregatedA2UI] : []),
      ...(aggregatedA4UI ? [aggregatedA4UI] : []),
      ...(aggregatedA5UI ? [aggregatedA5UI] : []),
    ];

    console.log(`Analysis complete: ${enhancedViolations.length} violations found`);

    return new Response(
      JSON.stringify({
        success: true,
        violations: enhancedViolations,
        passNotes: analysisResult.passNotes || {},
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Analysis error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Analysis failed",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});