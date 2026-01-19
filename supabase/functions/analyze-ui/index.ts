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
    { id: 'A4', name: 'Small tap / click targets', diagnosis: 'Interactive elements do not explicitly ensure minimum tap target size (44×44px), and rendered dimensions may vary across devices.', correctivePrompt: 'Explicitly enforce minimum interactive element dimensions (44×44px) with adequate spacing to ensure tap target compliance across devices.' },
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

**CLASSIFICATION:**
- ALWAYS classify A4 as "⚠️ Potential Risk (Heuristic)" — NEVER "Confirmed" unless rendered DOM dimensions are explicitly measured
- Visual inspection CANNOT confirm tap target violations without actual measurement

**WHAT TO REPORT:**
1. Only report interactive elements (buttons, links, clickable elements) that visually appear to lack adequate size
2. DO NOT report elements that appear to have sufficient size (buttons with visible padding, large touch areas)

**DO NOT:**
- Infer or assume final tap target size from padding, font size, or icon size
- Mention internal glyphs, spans, icons, or characters (e.g., "×", "X", icons)
- Describe user difficulty as a confirmed outcome
- Use language implying measurement or certainty

**REQUIRED WORDING:**
- Refer to elements as "button" or "interactive element" — not internal content
- Use neutral, academic phrasing: "does not explicitly enforce", "cannot be guaranteed", "potential risk"
- Include the component/location where the issue occurs

**OUTPUT TEMPLATE:**
"The [button/interactive element] in [component/location] does not explicitly enforce a minimum tap target size of 44×44px. Although padding may be applied, the element's dimensions are not explicitly constrained to guarantee compliance with recommended touch target guidelines."

**Report each potentially non-compliant element SEPARATELY** — do not group into one violation

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
### SPECIAL HANDLING FOR A1 (Text Contrast)
Since this is screenshot-based analysis, you CANNOT compute exact contrast ratios.
For A1 violations:
- ONLY report if you observe visually apparent low-contrast text (light gray on white, faint text, etc.)
- Set status to "potential" (NOT "confirmed")
- Use cautious language: "may have", "potential risk", "appears to be", "should be verified"
- Do NOT provide numeric contrast ratios
- Evidence should describe the visual observation (e.g., "Light gray text on white background in the header area")
` : ''}

Report violations ONLY if there is strong visual evidence.

Accessibility rules to check:
${rules.accessibility.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name} — ${r.diagnosis}`).join('\n')}

## PASS 2 — Usability (HCI)
Independently reason about the UI based on HCI principles. Do NOT rely solely on code warnings.
Perform qualitative judgment based on UI intent and visual hierarchy.

For EACH of the following rules, explicitly decide whether it is violated or not:
${rules.usability.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name} — ${r.diagnosis}`).join('\n')}

Consider:
- Visual hierarchy and primary action clarity
- Typography consistency
- Color palette coherence
- Element grouping and alignment
- Feedback mechanisms
- Navigation clarity
- Cross-screen consistency

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
    
    // Separate A2 violations for aggregation
    const a2Violations: any[] = [];
    const otherViolations: any[] = [];
    
    (analysisResult.violations || []).forEach((v: any) => {
      if (v.ruleId === 'A2') {
        a2Violations.push(v);
      } else {
        otherViolations.push(v);
      }
    });
    
    // Process non-A2 violations with existing filters
    const filteredOtherViolations = otherViolations
      .filter((v: any) => {
        // Filter out A5 violations that should be PASS (have valid focus replacement)
        if (v.ruleId === 'A5') {
          const evidence = (v.evidence || '').toLowerCase();
          const diagnosis = (v.diagnosis || '').toLowerCase();
          const combined = evidence + ' ' + diagnosis;
          
          // Check if this was incorrectly flagged as a violation despite having valid focus styles
          const mentionsAcceptable = /acceptable|compliant|pass|valid|proper focus|visible focus|clear focus/.test(combined);
          const mentionsRingOrBorder = /has.*ring|has.*border|visible ring|visible border|shows.*ring|shows.*border/.test(combined);
          
          // If evidence mentions acceptable implementation or visible focus styles, filter it out
          if (mentionsAcceptable || mentionsRingOrBorder) {
            console.log(`Filtering out A5 PASS case: ${v.evidence}`);
            return false;
          }
        }
        return true;
      })
      .map((v: any) => {
        const rule = allRulesForViolations.find(r => r.id === v.ruleId);
        
        // For A1 from screenshots, always set status to "potential"
        const isA1 = v.ruleId === 'A1';
        
        return {
          ...v,
          correctivePrompt: rule?.correctivePrompt || v.correctivePrompt || '',
          // Ensure A1 is always "potential" for screenshot analysis
          ...(isA1 ? { status: 'potential' } : {}),
        };
      });

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
    
    // Combine all violations
    const enhancedViolations = aggregatedA2UI 
      ? [...filteredOtherViolations, aggregatedA2UI]
      : filteredOtherViolations;

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