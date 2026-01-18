import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { ZipReader, BlobReader, TextWriter } from "https://deno.land/x/zipjs@v2.7.32/index.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rule registry for code analysis
const rules = {
  accessibility: [
    { id: 'A1', name: 'Insufficient text contrast', diagnosis: 'Low contrast may reduce readability and fail WCAG AA compliance.', correctivePrompt: 'Use a high-contrast color palette compliant with WCAG AA (minimum 4.5:1 for normal text).' },
    { id: 'A2', name: 'Small informational text size', diagnosis: 'While WCAG does not specify a minimum font size, usability and accessibility guidelines commonly recommend using at least ~16px for important informational content to support readability, particularly for users with visual impairments.', correctivePrompt: 'Consider increasing informational text size to at least ~16px and adjusting line spacing for improved readability. This is a recommended best practice, not a WCAG requirement.' },
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

// File extensions to analyze
const ANALYZABLE_EXTENSIONS = [
  '.html', '.htm', '.jsx', '.tsx', '.js', '.ts',
  '.css', '.scss', '.sass', '.less',
  '.vue', '.svelte', '.astro'
];

// Tailwind color mappings to approximate hex values
const TAILWIND_COLORS: Record<string, string> = {
  // Grays
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb',
  'gray-300': '#d1d5db', 'gray-400': '#9ca3af', 'gray-500': '#6b7280',
  'gray-600': '#4b5563', 'gray-700': '#374151', 'gray-800': '#1f2937', 'gray-900': '#111827',
  // Slate
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0',
  'slate-300': '#cbd5e1', 'slate-400': '#94a3b8', 'slate-500': '#64748b',
  'slate-600': '#475569', 'slate-700': '#334155', 'slate-800': '#1e293b', 'slate-900': '#0f172a',
  // Zinc
  'zinc-50': '#fafafa', 'zinc-100': '#f4f4f5', 'zinc-200': '#e4e4e7',
  'zinc-300': '#d4d4d8', 'zinc-400': '#a1a1aa', 'zinc-500': '#71717a',
  'zinc-600': '#52525b', 'zinc-700': '#3f3f46', 'zinc-800': '#27272a', 'zinc-900': '#18181b',
  // White/Black
  'white': '#ffffff', 'black': '#000000',
};

// Parse hex color to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
}

// Calculate relative luminance for WCAG
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// Calculate contrast ratio between two colors
function getContrastRatio(hex1: string, hex2: string): number | null {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return null;
  
  const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
  
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  
  return (lighter + 0.05) / (darker + 0.05);
}

// Extract text color classes from code
function extractTextColors(code: string): Array<{ colorClass: string; context: string }> {
  const results: Array<{ colorClass: string; context: string }> = [];
  
  // Match Tailwind text color classes
  const textColorRegex = /text-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)-?(\d{2,3})?/g;
  
  let match;
  while ((match = textColorRegex.exec(code)) !== null) {
    const colorClass = match[0];
    const start = Math.max(0, match.index - 50);
    const end = Math.min(code.length, match.index + colorClass.length + 50);
    const context = code.slice(start, end).replace(/\n/g, ' ').trim();
    results.push({ colorClass, context });
  }
  
  return results;
}

// Analyze contrast issues in code - HEURISTIC ONLY (no computed DOM styles)
// Per requirements: Only mark as "confirmed" if using axe-core with element reference 
// OR actual computed DOM styles. Static Tailwind class mapping is NOT sufficient.
interface ContrastViolation {
  ruleId: string;
  ruleName: string;
  category: string;
  status: 'confirmed' | 'potential';
  contrastRatio?: number;
  thresholdUsed?: 4.5 | 3.0;
  foregroundHex?: string;
  backgroundHex?: string;
  elementDescription?: string;
  evidence: string;
  diagnosis: string;
  contextualHint: string;
  correctivePrompt: string;
  confidence: number;
}

function analyzeContrastInCode(files: Map<string, string>): ContrastViolation[] {
  const violations: ContrastViolation[] = [];
  const reportedPatterns = new Set<string>();
  
  // Colors that typically have low contrast on light backgrounds
  const lowContrastOnLight = ['gray-300', 'gray-400', 'gray-500', 'slate-300', 'slate-400', 'slate-500', 'zinc-300', 'zinc-400', 'zinc-500'];
  
  for (const [filepath, content] of files) {
    const textColors = extractTextColors(content);
    
    for (const { colorClass, context } of textColors) {
      // Extract the color name
      const colorMatch = colorClass.match(/text-(\w+-?\d*)/);
      if (!colorMatch) continue;
      
      const colorName = colorMatch[1];
      const hexColor = TAILWIND_COLORS[colorName];
      
      // Determine if this is a potentially low-contrast color
      const isLowContrastPattern = lowContrastOnLight.some(c => colorName === c);
      
      if (!isLowContrastPattern) continue;
      
      // Create a unique key for this pattern to avoid duplicates
      const patternKey = `${colorName}`;
      if (reportedPatterns.has(patternKey)) continue;
      reportedPatterns.add(patternKey);
      
      // Try to infer element context from surrounding code
      const elementContext = inferElementContext(context);
      
      // Calculate estimated ratio for informational purposes only
      let estimatedRatio: number | undefined;
      if (hexColor) {
        const ratio = getContrastRatio(hexColor, '#ffffff');
        if (ratio !== null) {
          estimatedRatio = Math.round(ratio * 100) / 100;
        }
      }
      
      // ALWAYS report as "potential" since we cannot:
      // 1. Confirm the actual background color for this element
      // 2. Get computed styles from rendered DOM
      // 3. Run axe-core against the live application
      violations.push({
        ruleId: 'A1',
        ruleName: 'Insufficient text contrast',
        category: 'accessibility',
        status: 'potential', // NEVER 'confirmed' without computed DOM styles or axe-core
        evidence: `Text color class "${colorClass}" detected${hexColor ? ` (maps to ${hexColor})` : ''}. Background color cannot be confidently determined from static analysis.`,
        diagnosis: `Potential WCAG AA contrast risk: The text color class "${colorClass}" may have insufficient contrast depending on the actual rendered background color. Static code analysis cannot confirm the exact background color for this element, so this should be verified using browser developer tools or an accessibility audit tool like axe-core. Found in ${filepath}.`,
        contextualHint: elementContext 
          ? `Review contrast for ${elementContext} to ensure it meets WCAG AA standards.`
          : 'Review text contrast in this component to ensure it meets WCAG AA standards.',
        correctivePrompt: rules.accessibility[0].correctivePrompt,
        confidence: 0.6, // Lower confidence since we can't confirm
      });
    }
  }
  
  return violations;
}

// Try to infer what kind of UI element the text is in based on context
function inferElementContext(context: string): string | null {
  const lowerContext = context.toLowerCase();
  
  if (lowerContext.includes('button')) return 'button text';
  if (lowerContext.includes('label')) return 'form label';
  if (lowerContext.includes('error') || lowerContext.includes('alert')) return 'error or alert message';
  if (lowerContext.includes('success')) return 'success message';
  if (lowerContext.includes('warning')) return 'warning message';
  if (lowerContext.includes('badge')) return 'badge or tag';
  if (lowerContext.includes('nav')) return 'navigation item';
  if (lowerContext.includes('header')) return 'header text';
  if (lowerContext.includes('footer')) return 'footer text';
  if (lowerContext.includes('card')) return 'card content';
  if (lowerContext.includes('input') || lowerContext.includes('placeholder')) return 'input placeholder or helper text';
  if (lowerContext.includes('link') || lowerContext.includes('<a')) return 'link text';
  if (lowerContext.includes('caption') || lowerContext.includes('description')) return 'caption or description text';
  
  return null;
}

function isAnalyzableFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ANALYZABLE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function detectStack(files: Map<string, string>): string {
  const fileNames = Array.from(files.keys());
  
  if (fileNames.some(f => f.includes('next.config'))) return 'Next.js';
  if (fileNames.some(f => f.includes('vite.config'))) return 'Vite';
  if (fileNames.some(f => f.includes('angular.json'))) return 'Angular';
  if (fileNames.some(f => f.endsWith('.vue'))) return 'Vue';
  if (fileNames.some(f => f.endsWith('.svelte'))) return 'Svelte';
  if (fileNames.some(f => f.endsWith('.tsx') || f.endsWith('.jsx'))) return 'React';
  if (fileNames.some(f => f.endsWith('.html'))) return 'HTML';
  return 'Unknown';
}

function buildCodeAnalysisPrompt(selectedRules: string[]) {
  const selectedRulesSet = new Set(selectedRules);
  // Filter out A1 since we handle it separately with computed contrast
  const accessibilityRulesWithoutA1 = rules.accessibility.filter(r => r.id !== 'A1' && selectedRulesSet.has(r.id));
  
  return `You are an expert UI/UX code auditor performing a comprehensive 3-pass static analysis of source code. Analyze the provided code files following this structured methodology:

## PASS 1 — Accessibility (WCAG AA) - Static Code Analysis
NOTE: A1 (text contrast) is analyzed separately with computed ratios. Do NOT report A1 violations.

Examine the code for other accessibility issues:
- Font-size declarations (check for values below 16px or 1rem)
- Line-height and spacing values
- Focus styles (:focus, :focus-visible, outline declarations)
- ARIA attributes and semantic HTML usage
- Alt text for images

### A2 (Small informational text size) — STRICT CLASSIFICATION & WORDING RULES:

**CLASSIFICATION:**
- ALWAYS classify A2 as "⚠️ Heuristic Readability Risk" — NEVER "Confirmed"
- Use medium confidence level (55–65%), NOT high confidence
- WCAG does NOT define a minimum font-size requirement — explicitly state this

**EXCLUSION RULE — DO NOT EVALUATE THESE UNDER A2:**
1. Icon-only elements or control affordances (close buttons, dismiss icons, action icons)
2. Elements whose primary purpose is interaction (dismiss, close, confirm) rather than conveying readable information
3. Single-character controls (e.g., "×", "X", "−", "+")
4. Buttons whose label is not meant to be read as informational content
5. Elements with font size ≥16px or equivalent (text-base, text-lg, text-xl, 1rem or larger)

**FONT SIZE CONDITION:**
- Only trigger this rule when text size is approximately ≤14px (text-sm, 0.875rem, or smaller)
- Do NOT trigger if the text size is ≥16px or equivalent

**SEMANTIC FILTER — ONLY APPLY A2 TO:**
- Informational or descriptive text that users need to read or compare
- Labels, metadata, descriptions, captions, helper text
- NOT interactive controls, icons, or single-character elements

**WHAT TO REPORT:**
1. Report text elements using small font sizes (≈14px, text-sm, 0.875rem, or smaller)
2. Focus on informational/metadata text (labels, descriptors, captions, helper text)
3. Do NOT treat this as a strict WCAG violation

**REQUIRED WORDING:**
- Do NOT call this "Small body font size" unless the text is primary body content
- Prefer: "Small informational text size" or "Reduced readability due to small text"
- Frame as usability and accessibility best-practice concern, NOT standards violation
- Explicitly state: "WCAG does not specify a minimum font size"

**DO NOT:**
- Use "fails", "does not comply", "violates WCAG", or similar absolute language
- Imply the issue is objectively measurable or a standards violation
- Treat this as equivalent to contrast violations
- Reference aria-labels when evaluating visual text size (aria-labels affect screen readers, not visual readability)
- Generate an A2 finding for excluded elements — simply skip reporting

**OUTPUT TEMPLATE:**
"Several informational text elements in [file/component] use small font sizes (≈14px). While WCAG does not specify a minimum font size, usability and accessibility guidelines commonly recommend using at least ~16px for important informational content to support readability, particularly for users with visual impairments. This represents a heuristic readability risk identified through static code analysis."

### A4 (Small tap / click targets) — STRICT CLASSIFICATION & WORDING RULES:

**CLASSIFICATION:**
- ALWAYS classify A4 as "⚠️ Potential Risk (Heuristic)" — NEVER "Confirmed" unless rendered DOM dimensions are explicitly measured
- Static code analysis CANNOT confirm tap target violations

**WHAT TO REPORT:**
1. Only report interactive elements (buttons, links, clickable elements) that LACK explicit minimum size enforcement
2. DO NOT report elements that have explicit size constraints ≥44px:
   - min-h-[44px], min-h-11, min-h-12, or larger
   - min-w-[44px], min-w-11, min-w-12, or larger
   - Both h-11/w-11 or h-12/w-12 together, or larger fixed dimensions
   - size-11, size-12, or larger

**DO NOT:**
- Infer or assume final tap target size from padding, font size, or icon size
- Mention internal glyphs, spans, icons, or characters (e.g., "×", "X", icons)
- Describe user difficulty as a confirmed outcome
- Use language implying measurement or certainty

**REQUIRED WORDING:**
- Refer to elements as "button" or "interactive element" — not internal content
- Use neutral, academic phrasing: "does not explicitly enforce", "cannot be guaranteed", "potential risk"
- Include the file/component name where the issue occurs

**OUTPUT TEMPLATE:**
"The [button/interactive element] in [File.tsx] does not explicitly enforce a minimum tap target size of 44×44px (e.g., via min-width or min-height). Although padding may be applied, the element's dimensions are not explicitly constrained to guarantee compliance with recommended touch target guidelines."

5. **Report each non-compliant element SEPARATELY** — do not merge into one violation

### A5 (Poor focus visibility) — STRICT CLASSIFICATION & DETECTION RULES:

**FOCUSABILITY DETERMINATION — STRICT CRITERIA:**
An element is ONLY considered focusable if it matches ONE of these criteria:
1. Native focusable elements: \`<button>\`, \`<a href="...">\`, \`<input>\`, \`<select>\`, \`<textarea>\`
2. Explicit tabIndex: has \`tabIndex={0}\`, \`tabIndex="0"\`, \`tabindex="0"\`, or positive tabIndex
3. Interactive ARIA role WITH tabIndex: \`role="button"\`, \`role="link"\`, \`role="menuitem"\` with \`tabIndex >= 0\`
4. onClick handler WITH keyboard support: element has both \`onClick\` AND \`onKeyDown\`/\`onKeyPress\` handlers

**DO NOT CLASSIFY AS FOCUSABLE:**
- Plain \`<div>\`, \`<span>\`, \`<p>\` without tabIndex or keyboard handlers
- Elements with ONLY \`onClick\` (no keyboard handler) — this is a different a11y issue
- Elements with hover classes like \`hover:bg-*\` — hover does NOT imply focusable
- Speculative cases like "if used as clickable" — analyze the ACTUAL code

**CLASSIFICATION CATEGORIES:**

1. **NOT APPLICABLE — SKIP ENTIRELY:**
   - Element does NOT meet focusability criteria above
   - DO NOT REPORT — do not include in violations array

2. **PASS — SKIP ENTIRELY:**
   - Element IS focusable AND has visible replacement focus indicator
   - Valid replacements: \`focus:ring-*\`, \`focus-visible:ring-*\`, \`focus:border-*\`, \`focus-visible:border-*\`, \`focus-visible:outline-*\` (not none), \`focus:shadow-*\`, \`focus-visible:shadow-*\`, \`ring-offset-*\`
   - DO NOT REPORT — do not include in violations array
   - DO NOT include any text like "This is acceptable" or "This is a PASS case"

3. **HEURISTIC RISK — REPORT:**
   - Element IS focusable AND outline is removed AND focus indication relies ONLY on \`focus:bg-*\` or \`focus-visible:bg-*\`
   - Set \`typeBadge: "HEURISTIC"\`
   - Set confidence to 45-55%
   - Background color alone may not provide sufficient visibility

4. **CONFIRMED VIOLATION — REPORT:**
   - Element IS focusable AND outline is removed AND NO visible replacement exists
   - Set \`typeBadge: "CONFIRMED"\`
   - Set confidence to 60-70%

**FOCUS STYLE CHECK — PRIORITY ORDER:**
When \`focus:outline-none\` or \`outline-none\` is present, check for VISIBLE REPLACEMENTS:
1. Ring styles: \`focus:ring-*\`, \`focus-visible:ring-*\`, \`focus:ring-offset-*\` → PASS
2. Border styles: \`focus:border-*\`, \`focus-visible:border-*\` → PASS
3. Outline replacement: \`focus-visible:outline-*\` (not \`outline-none\`) → PASS
4. Shadow styles: \`focus:shadow-*\`, \`focus-visible:shadow-*\` → PASS
5. Background ONLY: \`focus:bg-*\`, \`focus-visible:bg-*\` with no other → HEURISTIC RISK
6. NONE of the above → CONFIRMED VIOLATION

**COMPLIANT EXAMPLES — MUST NOT APPEAR IN VIOLATIONS:**
- \`focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2\` → PASS (do not report)
- \`focus-visible:ring-2 focus-visible:ring-offset-2\` → PASS (do not report)
- \`focus:border-primary\` → PASS (do not report)
- Any element with valid ring/border/shadow focus style → PASS (do not report)

**OUTPUT FORMAT FOR A5 VIOLATIONS ONLY:**
\`\`\`json
{
  "ruleId": "A5",
  "ruleName": "Poor focus visibility",
  "category": "accessibility",
  "typeBadge": "CONFIRMED" or "HEURISTIC",
  "evidence": "focus:outline-none without replacement in Button.tsx",
  "diagnosis": "The submit button removes default focus outline without visible replacement.",
  "contextualHint": "Add focus ring or border style for keyboard accessibility.",
  "confidence": 0.65
}
\`\`\`

**OUTPUT CONSTRAINT — MANDATORY:**
- The "violations" array must contain ONLY categories 3 and 4 (HEURISTIC RISK and CONFIRMED)
- NEVER include PASS or NOT APPLICABLE cases in violations
- NEVER include text like "acceptable", "compliant", or "could be improved" for PASS cases
- Report ONLY actual accessibility risks

Accessibility rules to check:
${accessibilityRulesWithoutA1.map(r => `- ${r.id}: ${r.name}`).join('\n')}

## PASS 2 — Usability (HCI) - Code Pattern Analysis
Analyze code structure for usability patterns:
- Button hierarchy (primary vs secondary styling)
- Typography system consistency (font-family, font-size patterns)
- Color palette usage (count unique colors)
- Layout and grouping patterns (flex, grid usage)
- Error handling patterns (try/catch, error states, validation messages)
- Loading states and feedback components
- Navigation structure and routing patterns
- Confirmation dialogs for dangerous actions (delete, submit)

Usability rules to check:
${rules.usability.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name}`).join('\n')}

## PASS 3 — Ethical & Dark Pattern Detection
Look for potentially manipulative code patterns:
- Pricing or CTA button emphasis patterns
- Hidden or de-emphasized elements (opacity, small font, muted colors)
- Countdown timers or urgency-related code
- Pre-checked checkboxes for opt-ins
- Asymmetric button styling (confirm vs cancel)

Ethics rules to check:
${rules.ethics.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name}`).join('\n')}

## IMPORTANT CONSTRAINTS
- Analyze the actual code structure, not assumptions
- Report violations ONLY when there is evidence in the code
- Do NOT report A1 (contrast) violations - they are computed separately
- For each category, output triggered rules OR explicitly state "No violations detected"
- Include file paths and line references where possible

## OUTPUT FORMAT (JSON)
For EACH violation, you MUST provide:
1. **diagnosis**: Detailed, evidence-based explanation of WHY the rule is violated. You MAY reference file paths or code patterns in the diagnosis since this is code analysis.
2. **contextualHint**: A short (1 sentence) high-level hint summarizing WHERE the issue appears and WHAT kind of adjustment is needed. Keep it descriptive, not implementation-level.

IMPORTANT CONSTRAINTS:
- Do NOT include code snippets or exact CSS values in contextualHint
- Keep contextualHint tool-agnostic and reusable across Bolt, Replit, and Lovable

{
  "violations": [
    {
      "ruleId": "A2",
      "ruleName": "Small body font size",
      "category": "accessibility",
      "diagnosis": "In Button.tsx, font-size is set to 12px which is below the recommended 16px minimum.",
      "contextualHint": "Increase body text size to meet accessibility standards.",
      "confidence": 0.85
    }
  ],
  "passNotes": {
    "accessibility": "Summary of accessibility findings",
    "usability": "Summary of usability findings",
    "ethics": "Summary of ethics findings"
  },
  "stackDetected": "React/Vite"
}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { zipBase64, categories, selectedRules, toolUsed } = await req.json();

    if (!zipBase64) {
      return new Response(
        JSON.stringify({ success: false, error: "No ZIP file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Starting ZIP extraction and analysis...");

    // Decode and extract ZIP
    const zipData = decode(zipBase64);
    const arrayBuffer = new ArrayBuffer(zipData.length);
    const view = new Uint8Array(arrayBuffer);
    view.set(zipData);
    const blob = new Blob([arrayBuffer]);
    const zipReader = new ZipReader(new BlobReader(blob));
    const entries = await zipReader.getEntries();

    const files = new Map<string, string>();
    let totalSize = 0;
    const maxContentSize = 100000; // 100KB limit for AI context

    for (const entry of entries) {
      if (entry.directory || !isAnalyzableFile(entry.filename)) continue;
      
      try {
        const content = await entry.getData!(new TextWriter());
        if (content && totalSize + content.length < maxContentSize) {
          files.set(entry.filename, content);
          totalSize += content.length;
        }
      } catch (e) {
        console.warn(`Failed to read ${entry.filename}:`, e);
      }
    }

    await zipReader.close();

    if (files.size === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No analyzable files found in ZIP (HTML, CSS, JS, JSX, TSX, etc.)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Extracted ${files.size} files for analysis`);
    const stack = detectStack(files);
    console.log(`Detected stack: ${stack}`);

    // Compute A1 contrast violations directly
    const contrastViolations: ContrastViolation[] = [];
    if (selectedRules.includes('A1')) {
      const computed = analyzeContrastInCode(files);
      contrastViolations.push(...computed);
      console.log(`Computed ${contrastViolations.length} contrast violations`);
    }

    // Build code summary for AI
    const codeContent = Array.from(files.entries())
      .map(([path, content]) => `### File: ${path}\n\`\`\`\n${content.slice(0, 5000)}\n\`\`\``)
      .join('\n\n');

    // Build analysis prompt
    const systemPrompt = buildCodeAnalysisPrompt(selectedRules);

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Analyze the following source code files from a ${toolUsed} project (detected stack: ${stack}). 
        
Perform the complete 3-pass analysis (Accessibility, Usability, Ethics) based on the code patterns and return findings in the specified JSON format.

${codeContent}`,
      },
    ];

    // Call AI for analysis
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        temperature: 0.3,
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

    // Parse AI response
    let analysisResult;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonStr = jsonMatch[1] || content;
      analysisResult = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI analysis response");
    }

    // Enhance violations with corrective prompts and filter out invalid A5 reports
    const allRules = [...rules.accessibility, ...rules.usability, ...rules.ethics];
    const aiViolations = (analysisResult.violations || [])
      .filter((v: any) => {
        // Filter out A5 violations that should be PASS (have valid focus replacement)
        if (v.ruleId === 'A5') {
          const evidence = (v.evidence || '').toLowerCase();
          const diagnosis = (v.diagnosis || '').toLowerCase();
          const combined = evidence + ' ' + diagnosis;
          
          // Check if this was incorrectly flagged as a violation despite having valid focus styles
          const hasValidReplacement = /focus:ring-|focus-visible:ring-|focus:border-|focus-visible:border-|focus:shadow-|focus-visible:shadow-|ring-offset-/.test(combined);
          const mentionsAcceptable = /acceptable|compliant|pass|valid replacement|proper focus/.test(combined);
          
          // If evidence mentions valid replacement patterns or acceptable, filter it out
          if (hasValidReplacement || mentionsAcceptable) {
            console.log(`Filtering out A5 PASS case: ${v.evidence}`);
            return false;
          }
        }
        return true;
      })
      .map((v: any) => {
        const rule = allRules.find(r => r.id === v.ruleId);
        return {
          ...v,
          correctivePrompt: rule?.correctivePrompt || v.correctivePrompt || '',
        };
      });

    // Merge contrast violations with AI violations
    const allViolations = [...contrastViolations, ...aiViolations];

    console.log(`Code analysis complete: ${allViolations.length} violations found (${contrastViolations.length} contrast + ${aiViolations.length} AI-detected)`);

    return new Response(
      JSON.stringify({
        success: true,
        violations: allViolations,
        passNotes: analysisResult.passNotes || {},
        filesAnalyzed: files.size,
        stackDetected: stack,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("ZIP analysis error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "ZIP analysis failed",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});