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
    { id: 'A2', name: 'Small informational text size', diagnosis: 'WCAG 2.1 does not mandate a minimum font size; however, larger font sizes (approximately 14–16px) are widely adopted in usability and accessibility practice to support readability, particularly for users with low vision.', correctivePrompt: 'Increase text below 13px to at least 14px (text-sm) for informational or state-indicating content. Use 16px (text-base) for primary informational content in dialogs, alerts, tooltips, and chart labels. Retain very small text only for decorative or non-essential elements. Do not alter layout structure, spacing, or component hierarchy.' },
    { id: 'A3', name: 'Insufficient line spacing', diagnosis: 'Poor spacing may reduce readability, especially for users with cognitive or visual impairments.', correctivePrompt: 'Increase line height and paragraph spacing to improve text readability.' },
    { id: 'A4', name: 'Small tap / click targets', diagnosis: 'Interactive elements do not explicitly enforce minimum tap target size (44×44 CSS px), which is commonly recommended in usability and accessibility guidelines (WCAG 2.1 Target Size is AAA, not AA). Padding or box sizing at runtime may increase the clickable area, but static analysis cannot confirm rendered dimensions.', correctivePrompt: 'Explicitly enforce minimum interactive element dimensions (44×44 CSS px) using min-width and min-height constraints with adequate spacing. This ensures tap target compliance across devices regardless of content or padding variations.' },
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

### A2 (Small informational text size) — PRECISE DETECTION & CLASSIFICATION RULES:

**TEXT SIZE THRESHOLDS:**
1. **VIOLATION** (typeBadge: "VIOLATION"): Text size < 13px (text-xs, text-[0.75rem], font-size: 12px, or smaller)
   - Only when used for INFORMATIONAL or INSTRUCTIONAL content
   - Confidence: 65-75%
   
2. **WARNING** (typeBadge: "WARNING"): Text size 13-14px (text-[0.8rem], text-[0.85rem], borderline values)
   - Flag as readability concern, NOT a violation
   - Confidence: 50-60%
   
3. **CONTEXTUAL INFO ONLY** (DO NOT REPORT): text-sm (~14px, 0.875rem)
   - Include ONLY as contextual information in passNotes if relevant
   - Do NOT include in violations array
   
4. **NO ACTION** (DO NOT EVALUATE): text-base (16px) or larger
   - Skip entirely — no reporting needed

**SEMANTIC ROLE CLASSIFICATION:**
Classify components based on semantic role inferred from component name and file path:

**INFORMATIONAL COMPONENTS (Primary A2 targets):**
- DialogDescription, AlertDescription, FormDescription, CardDescription
- FormLabel, InputLabel, FieldLabel
- Caption, Subtitle, HelpText, HelperText, Hint
- MetaData, Timestamp, DateDisplay
- Paragraph, Description, Content blocks

**SECONDARY/DECORATIVE COMPONENTS (Lower confidence, only flag < 13px):**
- Badge, Tag, Chip, Status, StatusBadge
- Shortcut, KeyboardShortcut, Kbd
- IconLabel, IconText, IconButton content
- Tooltip content, Popover content
- Breadcrumb items

**EXCLUDED COMPONENTS (DO NOT EVALUATE):**
- Icon-only elements, action icons, dismiss buttons
- Single-character controls ("×", "X", "−", "+")
- Button labels (interactive, not informational)
- Navigation items (typically styled intentionally)
- Code/pre elements (monospace styling expected)

**CONFIDENCE SCORE CALCULATION:**
Base confidence on three factors:
1. **Semantic certainty** (±15%): 
   - High: Component name clearly indicates informational role → +10%
   - Medium: Ambiguous naming → +0%
   - Low: Component name suggests secondary role → -10%
   
2. **Threshold proximity** (±10%):
   - Far below 13px (10-11px) → +10% confidence
   - Borderline (13-14px) → -10% confidence
   
3. **Context ambiguity** (±10%):
   - Clear static text → +5%
   - Dynamic/conditional rendering → -5%
   - Unclear usage context → -10%

**OUTPUT FORMAT FOR A2 FINDINGS:**
\`\`\`json
{
  "ruleId": "A2",
  "ruleName": "Small informational text size",
  "category": "accessibility",
  "typeBadge": "VIOLATION" or "WARNING",
  "sizeCategory": "<13px" or "13-14px",
  "evidence": "text-xs used in DialogDescription.tsx, FormLabel.tsx",
  "diagnosis": "Informational text in [components] uses [size]. WCAG 2.1 does not mandate a minimum font size; however, larger font sizes (approximately 14–16px) are widely adopted in usability and accessibility practice to support readability, particularly for users with low vision.",
  "contextualHint": "Increase small text to at least 14px for informational content; use 16px for primary dialog, alert, and tooltip text.",
  "confidence": 0.70,
  "semanticRole": "informational" or "secondary"
}
\`\`\`

**STRICT RULES:**
- text-sm (14px, 0.875rem) → DO NOT include in violations array
- Only flag text-xs or smaller for secondary components
- ALWAYS include typeBadge and sizeCategory in output
- Frame as best-practice concern, never WCAG violation
- Group similar findings by size category

**DO NOT:**
- Flag text-sm as a violation (it's acceptable)
- Use "fails", "violates WCAG", or compliance language
- Evaluate aria-labels (screen reader only)
- Flag interactive elements (buttons, links)
- Speculate about runtime rendering

### A4 (Small tap / click targets) — STRICT CLASSIFICATION & WORDING RULES:

**STATIC ANALYSIS LIMITATION:**
Static code analysis cannot measure rendered DOM dimensions. Padding, box-sizing, flex/grid layout, and parent constraints at runtime may increase the clickable area beyond what size tokens indicate. Compliance CANNOT be confirmed from static analysis alone.

**GUIDELINE FRAMING:**
- 44×44 CSS px is commonly recommended in usability and accessibility guidelines
- WCAG 2.1 Target Size (Level AAA) suggests 44×44px, but this is NOT an AA requirement
- Do NOT state that WCAG mandates 44×44 at AA level
- Frame as: "commonly recommended touch target size" or "usability guideline"

**CLASSIFICATION:**
- ALWAYS classify A4 as "⚠️ Potential Risk (Heuristic)" — NEVER "Confirmed"
- Static code analysis CANNOT confirm tap target violations

**CONFIDENCE REASONING:**
Confidence is based on:
1. **Presence of size tokens** (±15%): Elements with h-8, h-9, w-8, w-9, size-8, size-9 tokens → lower confidence they meet 44px
2. **Lack of explicit min-width/min-height enforcement** (±10%): No min-h-11, min-w-11, min-h-[44px], min-w-[44px] → higher risk
3. **Static analysis limitation** (-15%): Always reduce confidence since runtime layout cannot be evaluated

**SIZE TOKEN TO APPROXIMATE PX MAPPING:**
- h-8/w-8/size-8 → ~32px (may be below 44px)
- h-9/w-9/size-9 → ~36px (may be below 44px)
- h-10/w-10/size-10 → ~40px (may be below 44px)
- h-11/w-11/size-11 → ~44px (meets guideline)
- h-12/w-12/size-12 → ~48px (exceeds guideline)

**WHAT TO REPORT:**
1. Only report interactive elements (buttons, links, clickable elements) that LACK explicit minimum size enforcement
2. List detected size classes and their approximate px values
3. DO NOT report elements that have explicit size constraints ≥44px

**DO NOT:**
- Infer or assume final tap target size from padding, font size, or icon size
- Mention internal glyphs, spans, icons, or characters (e.g., "×", "X", icons)
- Describe user difficulty as a confirmed outcome
- Use language implying measurement or certainty
- Use "non-compliant" or "fails" — prefer "may be below recommended touch target size"

**REQUIRED WORDING:**
- Refer to elements as "button" or "interactive element" — not internal content
- Use neutral, academic phrasing: "does not explicitly enforce", "cannot be guaranteed", "may be below"
- Include the file/component name where the issue occurs

**OUTPUT TEMPLATE:**
"The [button/interactive element] in [File.tsx] does not explicitly enforce a minimum tap target size of 44×44 CSS px. Detected size class(es): [h-9, w-9] (~36px). Although padding or layout constraints at runtime may increase the clickable area, the element's dimensions are not explicitly constrained to guarantee compliance with commonly recommended touch target guidelines (WCAG 2.1 Target Size is AAA, not AA)."

**Report each potentially undersized element SEPARATELY** — do not merge into one violation

### A5 (Poor focus visibility) — STRICT CLASSIFICATION & DETECTION RULES:

**ABSOLUTE RULE:**
If an element does NOT remove the default browser focus outline, it MUST NOT be reported under A5.
Lack of a custom focus-visible style alone is NOT an accessibility issue — browser defaults are acceptable.

**PREREQUISITE — OUTLINE REMOVAL CHECK:**
ONLY evaluate an element for A5 if it explicitly removes the default focus outline:
- \`outline-none\`, \`focus:outline-none\`, or \`focus-visible:outline-none\` is present in the class list
If the element does NOT remove the outline → SKIP (do not report)

**FOCUSABILITY DETERMINATION — STRICT CRITERIA:**
An element is ONLY considered focusable if it matches ONE of these criteria:
1. Native focusable elements: \`<button>\`, \`<a href="...">\`, \`<input>\`, \`<select>\`, \`<textarea>\`
2. Explicit tabIndex: has \`tabIndex={0}\`, \`tabIndex="0"\`, \`tabindex="0"\`, or positive tabIndex
3. Interactive ARIA role WITH tabIndex: \`role="button"\`, \`role="link"\`, \`role="menuitem"\` with \`tabIndex >= 0\`
4. onClick handler WITH keyboard support: element has both \`onClick\` AND \`onKeyDown\`/\`onKeyPress\` handlers

**DO NOT CLASSIFY AS FOCUSABLE:**
- Plain \`<div>\`, \`<span>\`, \`<p>\` without tabIndex or keyboard handlers
- Elements with ONLY \`onClick\` (no keyboard handler) — this is a different a11y issue
- Speculative cases like "if used as clickable" — analyze the ACTUAL code

**IGNORE COMPLETELY:**
- All hover styles (\`hover:bg-*\`, \`hover:text-*\`, etc.) — hover is NOT focus
- Hover feedback must NEVER be used as evidence for or against focus visibility

**CLASSIFICATION CATEGORIES:**

1. **NOT APPLICABLE — SKIP ENTIRELY:**
   - Element does NOT remove the default outline (no \`outline-none\`, \`focus:outline-none\`, \`focus-visible:outline-none\`)
   - OR element does NOT meet focusability criteria above
   - DO NOT REPORT — do not include in violations array

2. **PASS — SKIP ENTIRELY:**
   - Element IS focusable AND removes outline BUT has visible replacement focus indicator
   - Valid replacements: \`focus:ring-*\`, \`focus-visible:ring-*\`, \`focus:border-*\`, \`focus-visible:border-*\`, \`focus-visible:outline-*\` (not none), \`focus:shadow-*\`, \`focus-visible:shadow-*\`, \`ring-offset-*\`
   - DO NOT REPORT — do not include in violations array

3. **HEURISTIC RISK — REPORT:**
   - Element IS focusable AND outline is removed AND focus indication relies ONLY on \`focus:bg-*\` or \`focus-visible:bg-*\` or \`focus:text-*\`
   - Set \`typeBadge: "HEURISTIC"\`
   - Set confidence to 45-55%
   - Evidence: list the exact focus:bg-* or focus:text-* classes found
   - Rationale: "Focus indication relies only on background/text color change, which may be insufficient for users with low vision."

4. **CONFIRMED VIOLATION — REPORT:**
   - Element IS focusable AND outline is removed AND NO visible replacement exists (no ring, border, shadow, bg, text change)
   - Set \`typeBadge: "CONFIRMED"\`
   - Set confidence to 60-70%
   - Evidence: list the outline-removal class and note absence of replacement

**FOCUS STYLE CHECK — PRIORITY ORDER:**
When \`focus:outline-none\` or \`outline-none\` is present, check for VISIBLE REPLACEMENTS:
1. Ring styles: \`focus:ring-*\`, \`focus-visible:ring-*\`, \`focus:ring-offset-*\` → PASS
2. Border styles: \`focus:border-*\`, \`focus-visible:border-*\` → PASS
3. Outline replacement: \`focus-visible:outline-*\` (not \`outline-none\`) → PASS
4. Shadow styles: \`focus:shadow-*\`, \`focus-visible:shadow-*\` → PASS
5. Background/text ONLY: \`focus:bg-*\`, \`focus-visible:bg-*\`, \`focus:text-*\` with no other → HEURISTIC RISK
6. NONE of the above → CONFIRMED VIOLATION

**GROUPING RULE:**
Group identical background-only focus patterns into a SINGLE A5 finding with multiple occurrences listed.
Example: If 5 buttons all use \`focus:bg-primary\` without ring/border, report ONE violation listing all 5 locations.

**OUTPUT FORMAT FOR A5 VIOLATIONS ONLY:**
\`\`\`json
{
  "ruleId": "A5",
  "ruleName": "Poor focus visibility",
  "category": "accessibility",
  "typeBadge": "CONFIRMED" or "HEURISTIC",
  "evidence": "focus:outline-none with only focus:bg-accent in Button.tsx, Card.tsx, Link.tsx",
  "diagnosis": "Multiple components rely only on background color change for focus indication.",
  "contextualHint": "Add visible focus ring or border for keyboard accessibility.",
  "confidence": 0.50,
  "occurrences": ["Button.tsx", "Card.tsx", "Link.tsx"]
}
\`\`\`

**OUTPUT CONSTRAINT — MANDATORY:**
- The "violations" array must contain ONLY categories 3 and 4 (HEURISTIC RISK and CONFIRMED)
- NEVER include PASS or NOT APPLICABLE cases in violations
- NEVER speculate about "might be subtle" or "could be overridden" — analyze actual code only
- Report ONLY actual accessibility risks with code evidence

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

    // Enhance violations with corrective prompts and filter out invalid reports
    const allRules = [...rules.accessibility, ...rules.usability, ...rules.ethics];
    
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
        // Filter out A5 violations that should be PASS or NOT APPLICABLE
        if (v.ruleId === 'A5') {
          const evidence = (v.evidence || '').toLowerCase();
          const diagnosis = (v.diagnosis || '').toLowerCase();
          const combined = evidence + ' ' + diagnosis;
          
          // ABSOLUTE RULE: If no outline removal is mentioned, skip
          const mentionsOutlineRemoval = /outline-none|focus:outline-none|focus-visible:outline-none/.test(combined);
          if (!mentionsOutlineRemoval) {
            console.log(`Filtering out A5 (no outline removal): ${v.evidence}`);
            return false;
          }
          
          // Check if this was incorrectly flagged despite having valid focus replacement
          const hasValidReplacement = /focus:ring-|focus-visible:ring-|focus:border-|focus-visible:border-|focus:shadow-|focus-visible:shadow-|ring-offset-|focus-visible:outline-(?!none)/.test(combined);
          const mentionsAcceptable = /acceptable|compliant|pass\b|valid replacement|proper focus|browser default/.test(combined);
          
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

    // ========== A2 AGGREGATION LOGIC ==========
    // Process and aggregate A2 violations into a single result object
    interface A2AffectedItem {
      component_name: string;
      file_path: string;
      size_token: string;
      approx_px: string;
      semantic_role: string;
      severity: 'violation' | 'warning';
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }
    
    const processedA2Items: A2AffectedItem[] = [];
    const dedupeMap = new Map<string, A2AffectedItem>();
    
    for (const v of a2Violations) {
      const evidence = (v.evidence || '').toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidence + ' ' + diagnosis;
      
      // FILTER: text-sm (14px, 0.875rem) should NOT be reported as violation
      const mentionsTextSm = /\btext-sm\b|0\.875rem|14px|≈14px|~14px|approximately 14/.test(combined);
      const mentionsSmaller = /text-xs|0\.75rem|12px|11px|10px|<13px|smaller than 13/.test(combined);
      
      // If only text-sm is mentioned without smaller sizes, filter out
      if (mentionsTextSm && !mentionsSmaller) {
        console.log(`Filtering out A2 (text-sm is acceptable): ${v.evidence}`);
        continue;
      }
      
      // Filter out excluded elements (buttons, icons, navigation, etc.)
      const isExcludedElement = /\bbutton\b|icon|navigation|nav-|menu item|\bbtn\b|interactive element|action button/.test(combined);
      if (isExcludedElement && !/description|label|helper|caption|metadata/.test(combined)) {
        console.log(`Filtering out A2 (excluded element type): ${v.evidence}`);
        continue;
      }
      
      // Extract component info from evidence/diagnosis
      // Priority: 1) Named component in PascalCase, 2) File name, 3) Fallback to file path only
      const componentMatch = (v.evidence || '').match(/(?:in\s+)?([A-Z][a-zA-Z0-9]*(?:Component|Description|Label|Text|Badge|Caption|Shortcut|Tooltip|Content|Container|Wrapper|Item|Card|Dialog|Alert|Form|Chart|Table|Cell|Row|Header|Footer|Nav|Menu|Sidebar|Panel)?)/);
      const fileMatch = (v.evidence || v.contextualHint || '').match(/([a-zA-Z0-9_-]+\.(?:tsx|jsx|ts|js|vue|svelte))/i);
      const sizeMatch = combined.match(/text-xs|text-\[[\d.]+(?:rem|px)\]|font-size:\s*[\d.]+(?:px|rem)/i);
      
      // Resolve component name - avoid placeholders like "text, text"
      let componentName = '';
      if (componentMatch?.[1] && componentMatch[1].length > 2 && !/^text$/i.test(componentMatch[1])) {
        componentName = componentMatch[1];
      } else if (fileMatch?.[1]) {
        // Use file name as fallback (without extension)
        componentName = fileMatch[1].replace(/\.(tsx|jsx|ts|js|vue|svelte)$/i, '');
      } else if (v.componentName && !/^text$/i.test(v.componentName)) {
        componentName = v.componentName;
      }
      // Final fallback: leave empty (will use file_path only)
      
      const filePath = fileMatch?.[1] || v.filePath || v.contextualHint || '';
      const sizeToken = sizeMatch?.[0] || (mentionsSmaller ? 'text-xs' : 'text-sm');
      
      // Determine approximate px value
      let approxPx = '<13px';
      if (/text-xs|0\.75rem|12px/.test(combined)) approxPx = '≈12px';
      else if (/11px/.test(combined)) approxPx = '≈11px';
      else if (/10px/.test(combined)) approxPx = '≈10px';
      else if (/13px|13-14/.test(combined)) approxPx = '≈13px';
      else if (/0\.8rem|0\.85rem/.test(combined)) approxPx = '≈13-14px';
      
      // Determine semantic role
      const semanticRole = /description|label|helper|caption|metadata|alert|dialog|form/i.test(componentName + combined)
        ? 'informational' 
        : 'secondary';
      
      // Determine severity
      const severity: 'violation' | 'warning' = mentionsSmaller ? 'violation' : 'warning';
      
      // Calculate confidence
      let confidence = v.confidence || 0.65;
      // Adjust based on semantic role
      if (semanticRole === 'informational') confidence = Math.min(confidence + 0.1, 0.85);
      // Adjust based on threshold proximity
      if (mentionsSmaller) confidence = Math.min(confidence + 0.05, 0.85);
      else confidence = Math.max(confidence - 0.1, 0.4);
      
      const rationale = v.diagnosis || `Small text size (${approxPx}) used for ${semanticRole} content.`;
      
      // Deduplication key
      const dedupeKey = `${filePath}|${componentName}|${sizeToken}`;
      
      if (dedupeMap.has(dedupeKey)) {
        const existing = dedupeMap.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        // Keep the higher confidence
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
        }
      } else {
        const item: A2AffectedItem = {
          component_name: componentName,
          file_path: filePath,
          size_token: sizeToken,
          approx_px: approxPx,
          semantic_role: semanticRole,
          severity,
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
        };
        dedupeMap.set(dedupeKey, item);
      }
    }
    
    const affectedItems = Array.from(dedupeMap.values());
    
    // Create aggregated A2 result if there are any items
    let aggregatedA2: any = null;
    if (affectedItems.length > 0) {
      // Calculate overall confidence
      const highImpactItems = affectedItems.filter(i => i.semantic_role === 'informational');
      let overallConfidence: number;
      let confidenceReason: string;
      
      if (highImpactItems.length > 0) {
        overallConfidence = Math.max(...highImpactItems.map(i => i.confidence));
        confidenceReason = `Based on maximum confidence (${overallConfidence.toFixed(2)}) from ${highImpactItems.length} informational component(s).`;
      } else {
        // Use median of all items
        const sortedConfidences = affectedItems.map(i => i.confidence).sort((a, b) => a - b);
        const midIdx = Math.floor(sortedConfidences.length / 2);
        overallConfidence = sortedConfidences.length % 2 === 0
          ? (sortedConfidences[midIdx - 1] + sortedConfidences[midIdx]) / 2
          : sortedConfidences[midIdx];
        confidenceReason = `Based on median confidence (${overallConfidence.toFixed(2)}) across ${affectedItems.length} secondary component(s).`;
      }
      
      // Count violations vs warnings
      const violationCount = affectedItems.filter(i => i.severity === 'violation').length;
      const warningCount = affectedItems.filter(i => i.severity === 'warning').length;
      
      // Build summary with DEDUPLICATED and FILTERED component names
      // 1. Extract unique component names, filtering out invalid identifiers
      const invalidIdentifiers = new Set([
        'variants', 'variant', 'props', 'className', 'classname', 'style', 'styles',
        'default', 'config', 'options', 'settings', 'utils', 'helpers', 'constants',
        'types', 'index', 'main', 'app', 'root', 'container', 'wrapper', 'layout',
        'component', 'components', 'element', 'elements', 'item', 'items', 'text',
        'unknown', 'undefined', 'null', 'true', 'false', 'function', 'object', 'array'
      ]);
      
      const uniqueComponentNames = new Set<string>();
      for (const item of affectedItems) {
        const name = item.component_name || '';
        // Filter out invalid identifiers (case-insensitive check)
        if (name && name.length > 2 && !invalidIdentifiers.has(name.toLowerCase())) {
          // Also filter out names that look like utility tokens or non-UI identifiers
          if (!/^(use|get|set|is|has|can|should|will|on|handle)[A-Z]/.test(name)) {
            uniqueComponentNames.add(name);
          }
        }
      }
      
      // Fall back to file paths if no valid component names
      if (uniqueComponentNames.size === 0) {
        for (const item of affectedItems) {
          const filePath = item.file_path || '';
          if (filePath) {
            // Extract meaningful name from file path
            const fileName = filePath.replace(/.*[\/\\]/, '').replace(/\.(tsx|jsx|ts|js|vue|svelte)$/i, '');
            if (fileName && fileName.length > 2 && !invalidIdentifiers.has(fileName.toLowerCase())) {
              uniqueComponentNames.add(fileName);
            }
          }
        }
      }
      
      // 2. Build deduplicated component list (max 4, with "and N more")
      const uniqueNamesArray = Array.from(uniqueComponentNames);
      const displayLimit = 4;
      const displayedNames = uniqueNamesArray.slice(0, displayLimit);
      const moreCount = uniqueNamesArray.length - displayLimit;
      const moreText = moreCount > 0 ? ` and ${moreCount} more` : '';
      
      // 3. Build summary with "X unique component(s)" wording
      const componentList = displayedNames.join(', ');
      const componentCountText = uniqueNamesArray.length > 0 
        ? `${uniqueNamesArray.length} unique component(s): ${componentList}${moreText}`
        : `${affectedItems.length} location(s)`;
      
      const summary = `Small text size detected in ${componentCountText}. ` +
        `${violationCount > 0 ? `${violationCount} violation(s) (<13px)` : ''}` +
        `${violationCount > 0 && warningCount > 0 ? ' and ' : ''}` +
        `${warningCount > 0 ? `${warningCount} warning(s) (13-14px)` : ''}. ` +
        `WCAG 2.1 does not mandate a minimum font size; however, larger font sizes (approximately 14–16px) are widely adopted in usability and accessibility practice to support readability, particularly for users with low vision.`;
      
      const a2Rule = allRules.find(r => r.id === 'A2');
      
      aggregatedA2 = {
        ruleId: 'A2',
        ruleName: 'Small informational text size',
        category: 'accessibility',
        overall_confidence: Math.round(overallConfidence * 100) / 100,
        confidence_reason: confidenceReason,
        summary,
        affected_items: affectedItems.map(item => ({
          component_name: item.component_name,
          file_path: item.file_path,
          size_token: item.size_token,
          approx_px: item.approx_px,
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
      
      console.log(`A2 aggregated: ${affectedItems.length} items → 1 result (${violationCount} violations, ${warningCount} warnings)`);
    }
    
    // Combine all violations
    const aiViolations = aggregatedA2 
      ? [...filteredOtherViolations, aggregatedA2]
      : filteredOtherViolations;

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