import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Complete rule registry for the 3-pass analysis
const rules = {
  accessibility: [
    { id: 'A1', name: 'Insufficient text contrast', diagnosis: 'Low contrast may reduce readability and fail WCAG AA compliance.', correctivePrompt: 'Use a high-contrast color palette compliant with WCAG AA (minimum 4.5:1 for normal text).' },
    { id: 'A2', name: 'Small body font size', diagnosis: 'Small text size can negatively affect readability and accessibility.', correctivePrompt: 'Increase body text size to a minimum of 16px and adjust line spacing for readability.' },
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
    const enhancedViolations = (analysisResult.violations || []).map((v: any) => {
      const allRules = [...rules.accessibility, ...rules.usability, ...rules.ethics];
      const rule = allRules.find(r => r.id === v.ruleId);
      
      // For A1 from screenshots, always set status to "potential"
      const isA1 = v.ruleId === 'A1';
      
      return {
        ...v,
        correctivePrompt: rule?.correctivePrompt || v.correctivePrompt || '',
        // Ensure A1 is always "potential" for screenshot analysis
        ...(isA1 ? { status: 'potential' } : {}),
      };
    });

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