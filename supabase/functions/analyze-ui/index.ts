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
    { id: 'U1', name: 'Unclear primary action', diagnosis: 'Users may struggle to identify the main action.', correctivePrompt: 'Establish a clear visual hierarchy by emphasizing one primary action and de-emphasizing secondary actions.' },
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
### SPECIAL HANDLING FOR A1 (Text Contrast) — TIERED HEURISTIC ANALYSIS

Since this is screenshot-based analysis, exact contrast ratios CANNOT be computed. Report A1 as a heuristic risk with tiered severity based on visual observation.

**DETECTION RULES:**
- ONLY report if you observe visually apparent low-contrast text (light gray on white, faint text, etc.)
- Status is ALWAYS "potential" (never "confirmed" for screenshot analysis)
- Use cautious language: "may be insufficient", "potential risk", "appears to have low contrast"
- Do NOT provide numeric contrast ratios (cannot be measured from screenshots)

**RISK LEVEL TIERS (assign based on visual observation):**
1. **high**: Very faint/light text that is clearly difficult to read (e.g., very light gray on white)
   - Confidence: 0.65-0.75
2. **medium**: Noticeably light text that may have insufficient contrast
   - Confidence: 0.55-0.65
3. **low**: Borderline contrast that depends on font size/weight and exact background
   - Confidence: 0.40-0.50

**UNCERTAINTY FACTORS TO MENTION:**
- Background color may not be uniform or may differ in actual rendering
- Contrast sufficiency depends on font size/weight (large/bold text requires only 3:1)
- This is a heuristic finding with reduced confidence

**OUTPUT FORMAT FOR A1:**
\`\`\`json
{
  "ruleId": "A1",
  "ruleName": "Insufficient text contrast",
  "category": "accessibility",
  "status": "potential",
  "riskLevel": "high" or "medium" or "low",
  "evidence": "Light gray descriptive text appears against white background in card components",
  "diagnosis": "Text in [location] may have insufficient contrast. Static analysis cannot determine exact contrast ratio or background color.",
  "contextualHint": "Review text contrast in [location] for potential WCAG AA compliance issues.",
  "confidence": 0.65
}
\`\`\`

**DO NOT:**
- Tell users to verify with browser dev tools or axe-core
- Provide numeric contrast ratios
- Use "confirmed" status
- Claim compliance or non-compliance with certainty
` : ''}

Report violations ONLY if there is strong visual evidence.

Accessibility rules to check:
${rules.accessibility.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name} — ${r.diagnosis}`).join('\n')}

## PASS 2 — Usability (HCI)
Independently reason about the UI based on HCI principles. Do NOT rely solely on code warnings.
Perform qualitative judgment based on UI intent and visual hierarchy.

### U1 (Unclear primary action) — STRICT EVIDENCE-BASED DETECTION RULES:

**CRITICAL — VISUAL EMPHASIS DETECTION:**
When analyzing button styling in screenshots, carefully distinguish between:
- **FILLED/PRIMARY button**: Solid background color (e.g., blue, dark, primary color filled)
- **OUTLINED button**: Border only, transparent/white background
- **GHOST button**: No border, transparent background, text only

**PREREQUISITE — MANDATORY EVIDENCE REQUIREMENTS:**
ONLY emit a U1 violation when ALL of the following conditions are met:
1. **Two or more actionable controls** are VISUALLY present in the same action area (e.g., dialog footer, button group, form actions, modal footer, card actions)
2. **The primary action is explicitly identifiable** via one of:
   - Semantic label (e.g., "Save", "Submit", "Confirm", "Create", "Send", "Delete", "Continue")
   - Visual prominence (solid/filled button appearance)
3. **BOTH buttons' visual styling MUST be observable and compared:**
   - **PASS (no violation)**: Primary button is visually FILLED/SOLID AND secondary is OUTLINED/GHOST
   - **VIOLATION**: BOTH buttons appear visually identical (both outlined, both ghost, or both filled)
   - **VIOLATION**: Secondary appears MORE prominent than primary

**NO SPECULATION RULE — ABSOLUTE:**
- If you cannot SEE both the primary and secondary actions in the screenshot, DO NOT emit U1
- If you cannot determine the styling difference from the visual, DO NOT emit U1
- If the primary button appears FILLED (solid background) and secondary appears OUTLINED → that is CORRECT hierarchy, NOT a violation
- DO NOT use conditional language ("if", "could", "might", "would", "may") to justify a violation
- DO NOT speculate about buttons that might exist outside the visible area

**PASS-SILENCE POLICY:**
- If the primary button is visually prominent (filled/solid) AND secondary is de-emphasized (outlined/ghost) → PASS (no output)
- If U1 cannot be confirmed with available visual evidence → produce NO OUTPUT for U1
- Silent PASS means: do not include U1 in violations array, no corrective prompt, no contextual hint

**WHAT TO REPORT (when evidence is complete):**
\`\`\`json
{
  "ruleId": "U1",
  "ruleName": "Unclear primary action",
  "category": "usability",
  "evidence": "Dialog footer shows two buttons: 'Cancel' and 'Submit'. BOTH appear as outlined buttons with transparent backgrounds and no visual distinction.",
  "primaryAction": "Submit button (appears outlined)",
  "secondaryAction": "Cancel button (appears outlined)",
  "stylingComparison": "Both buttons appear as outlined buttons with identical visual weight - neither has a filled/solid background.",
  "diagnosis": "The primary action (Submit) and secondary action (Cancel) have equal visual emphasis because BOTH appear as outlined buttons. Users may struggle to identify the main action.",
  "contextualHint": "Differentiate primary and secondary actions in dialog footer by making the primary action visually prominent with a solid/filled background.",
  "confidence": 0.75
}
\`\`\`

**DO NOT REPORT (PASS silently):**
- Single-button forms or dialogs (no competing actions visible)
- Areas where only one actionable button is visible
- Cases where primary button is clearly more prominent (solid/filled background) than secondary (outlined/ghost)
- Speculative scenarios based on assumptions about buttons outside the screenshot

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

    if (!content) {
      throw new Error("No content in AI response");
    }

    console.log("AI response received, parsing...");

    // Parse the JSON response from the AI
    let analysisResult;
    try {
      // Extract JSON from the response (it might be wrapped in markdown code blocks)
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonStr = jsonMatch[1] || content;
      analysisResult = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI analysis response");
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
    
    // ========== U1 EVIDENCE GATING ==========
    // Filter out speculative U1 violations that lack proper evidence
    const u1Violations: any[] = [];
    const nonU1OtherViolations: any[] = [];
    
    otherViolations.forEach((v: any) => {
      if (v.ruleId === 'U1') {
        u1Violations.push(v);
      } else {
        nonU1OtherViolations.push(v);
      }
    });
    
    // Validate U1 violations with strict evidence requirements
    const validatedU1Violations = u1Violations.filter((v: any) => {
      const evidence = (v.evidence || '').toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidence + ' ' + diagnosis;
      
      // FILTER: Speculative language indicates incomplete evidence
      const hasSpeculativeLanguage = /\bif\b.*\b(also|uses?|were?|is)\b|\bcould\b|\bmight\b|\bwould\b|\bmay\b(?!\s+struggle)|\bpossibly\b|\bpotentially\b|\bassuming\b|\bif the\b/.test(combined);
      if (hasSpeculativeLanguage) {
        console.log(`U1: Filtering out speculative violation: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // FILTER: Must mention at least two distinct actions/buttons
      const hasTwoActions = /\btwo\b|\bboth\b|\band\b.*\bbutton|\bcancel.*submit\b|\bsubmit.*cancel\b|\bprimary.*secondary\b|\bsecondary.*primary\b|\bconfirm.*cancel\b|\bcancel.*confirm\b/.test(combined);
      const mentionsMultipleButtons = (combined.match(/\bbutton/g) || []).length >= 2;
      if (!hasTwoActions && !mentionsMultipleButtons) {
        console.log(`U1: Filtering out - does not evidence two actions: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // FILTER: Must identify styling comparison or visual prominence information
      const hasStylingEvidence = /variant|outline|ghost|default|primary|solid|filled|identical|equal.*emphasis|similar.*appearance|same.*styl|no.*distinction|equal.*weight|visual.*weight/.test(combined);
      if (!hasStylingEvidence) {
        console.log(`U1: Filtering out - no styling comparison evidence: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // FILTER: Check for false positives where primary is actually visually emphasized correctly
      // If primary is described as "filled/solid/prominent" AND secondary is "outlined/ghost" → PASS (filter out)
      const primaryIsFilled = /(?:submit|primary|confirm|save|create|send|continue).*(?:filled|solid|prominent|dark|colored|bg-)/.test(combined) ||
                              /primary.*(?:filled|solid|prominent)/.test(combined);
      const secondaryIsOutlined = /(?:cancel|secondary|dismiss|close).*(?:outline|ghost|transparent|border)/.test(combined) ||
                                  /secondary.*(?:outline|ghost)/.test(combined);
      
      // If primary appears emphasized and secondary appears de-emphasized → correct hierarchy, not a violation
      if (primaryIsFilled && secondaryIsOutlined) {
        console.log(`U1: Filtering out - primary is visually filled/prominent, secondary is outlined/ghost (correct hierarchy): ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // FILTER: Must explicitly state BOTH buttons appear similar for "equal emphasis" claim
      const claimsEqualEmphasis = /equal.*emphasis|identical|same.*styl|both.*outline|both.*ghost|both.*filled|no.*distinction|equal.*weight/.test(combined);
      const explicitlyBothSimilar = /both.*(?:appear|look|are|use).*(?:outline|ghost|filled|identical|same)|neither.*(?:filled|prominent)|no.*visual.*distinction/.test(combined);
      
      // If claiming equal emphasis but not explicitly stating both appear similar → filter out
      if (claimsEqualEmphasis && !explicitlyBothSimilar) {
        console.log(`U1: Filtering out - claims equal emphasis without explicit comparison of both buttons' appearance: ${v.evidence?.substring(0, 100)}`);
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

    // ========== A1 AGGREGATION LOGIC (Screenshot Analysis) ==========
    interface A1AffectedItemUI {
      location: string;
      riskLevel: 'high' | 'medium' | 'low';
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }
    
    const a1DedupeMapUI = new Map<string, A1AffectedItemUI>();
    
    for (const v of a1Violations) {
      const evidence = (v.evidence || '').toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidence + ' ' + diagnosis;
      
      // Extract location from evidence
      const locationMatch = (v.evidence || v.contextualHint || '').match(/(?:in\s+(?:the\s+)?)?([a-zA-Z\s]+(?:dialog|modal|card|form|section|area|component|panel|header|footer|sidebar|button|navigation|content)?)/i);
      const location = locationMatch?.[1]?.trim() || v.contextualHint || 'UI area';
      
      // Determine risk level from evidence/diagnosis or explicit riskLevel field
      let riskLevel: 'high' | 'medium' | 'low' = v.riskLevel || 'medium';
      if (!v.riskLevel) {
        // Infer risk level from description
        if (/very light|very faint|barely visible|hard to read|clearly low|extremely light/.test(combined)) {
          riskLevel = 'high';
        } else if (/light gray|faint|low contrast|may have insufficient|potentially low/.test(combined)) {
          riskLevel = 'medium';
        } else if (/borderline|near threshold|subtle|slight/.test(combined)) {
          riskLevel = 'low';
        }
      }
      
      // Calculate confidence based on risk level
      let confidence = v.confidence || 0.55;
      if (riskLevel === 'high') {
        confidence = Math.min(Math.max(confidence, 0.65), 0.75);
      } else if (riskLevel === 'medium') {
        confidence = Math.min(Math.max(confidence, 0.50), 0.65);
      } else {
        confidence = Math.min(confidence, 0.50);
      }
      
      const rationale = v.diagnosis || `Text in ${location} may have insufficient contrast for WCAG AA compliance.`;
      
      // Deduplication key
      const dedupeKey = `${location}|${riskLevel}`;
      
      if (a1DedupeMapUI.has(dedupeKey)) {
        const existing = a1DedupeMapUI.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
        }
      } else {
        const item: A1AffectedItemUI = {
          location,
          riskLevel,
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
      // Count by risk level
      const highRiskCount = a1AffectedItemsUI.filter(i => i.riskLevel === 'high').length;
      const mediumRiskCount = a1AffectedItemsUI.filter(i => i.riskLevel === 'medium').length;
      const lowRiskCount = a1AffectedItemsUI.filter(i => i.riskLevel === 'low').length;
      
      // Determine overall risk level (highest tier present)
      let overallRiskLevel: 'high' | 'medium' | 'low' = 'low';
      if (highRiskCount > 0) overallRiskLevel = 'high';
      else if (mediumRiskCount > 0) overallRiskLevel = 'medium';
      
      // Calculate overall confidence (max of all findings)
      const overallConfidence = Math.max(...a1AffectedItemsUI.map(i => i.confidence));
      
      const confidenceReason = `Confidence is based on visual assessment of text contrast. ` +
        `Screenshot analysis cannot measure exact contrast ratios, and actual contrast depends on ` +
        `rendered background color and font size/weight. Findings are reported as heuristic risks with reduced confidence.`;
      
      // Build unique location names list
      const invalidLocations = new Set([
        'ui area', 'area', 'component', 'element', 'item', 'text', 'the', 'unknown'
      ]);
      
      const uniqueLocations = new Set<string>();
      for (const item of a1AffectedItemsUI) {
        const loc = item.location || '';
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
        ? `${uniqueLocationsArray.length} area(s): ${displayedLocations.join(', ')}${moreText}`
        : `${a1AffectedItemsUI.length} location(s)`;
      
      // Build risk breakdown text
      const riskBreakdown = [
        highRiskCount > 0 ? `${highRiskCount} high-risk` : '',
        mediumRiskCount > 0 ? `${mediumRiskCount} medium-risk` : '',
        lowRiskCount > 0 ? `${lowRiskCount} low-risk` : '',
      ].filter(Boolean).join(', ');
      
      const summary = `Potential WCAG AA contrast risk detected in ${areaCountText}. ` +
        `Risk breakdown: ${riskBreakdown}. ` +
        `Screenshot analysis cannot determine exact contrast ratios or background colors. ` +
        `Actual contrast may vary based on font size and weight (large/bold text requires only 3:1 ratio). ` +
        `This finding is reported as a heuristic risk with reduced confidence.`;
      
      // For screenshot analysis, we don't have specific Tailwind class names
      // Use consistent wording that matches code analysis (gray-300/400 as common problematic colors)
      const contextualHint = overallRiskLevel === 'high' || overallRiskLevel === 'medium'
        ? 'Light text colors (gray-300, gray-400 or similar) may be insufficient for informational text on light backgrounds.'
        : 'Text color is near-threshold; contrast may be insufficient depending on background and font characteristics.';
      
      const a1Rule = allRulesForViolations.find(r => r.id === 'A1');
      
      // Single deterministic corrective prompt - aligned with code analysis output
      const correctivePrompt = 'Replace low-contrast text colors (gray-300/400) with higher-contrast tokens (gray-600/700 or theme foreground) for informational text, while preserving design intent.';
      
      aggregatedA1UI = {
        ruleId: 'A1',
        ruleName: 'Insufficient text contrast',
        category: 'accessibility',
        status: 'potential', // Always potential for screenshot analysis
        overall_confidence: Math.round(overallConfidence * 100) / 100,
        confidence_reason: confidenceReason,
        summary,
        riskLevel: overallRiskLevel,
        affected_items: a1AffectedItemsUI.map(item => ({
          location: item.location,
          riskLevel: item.riskLevel,
          confidence: item.confidence,
          rationale: item.rationale,
          ...(item.occurrence_count && item.occurrence_count > 1 ? { occurrence_count: item.occurrence_count } : {}),
        })),
        diagnosis: summary,
        contextualHint,
        correctivePrompt,
        confidence: Math.round(overallConfidence * 100) / 100,
      };
      
      console.log(`A1 aggregated: ${a1Violations.length} findings → 1 result (${riskBreakdown})`);
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