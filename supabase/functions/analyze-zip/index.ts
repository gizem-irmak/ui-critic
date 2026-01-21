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
  // A1-specific tiered fields
  riskLevel?: 'high' | 'medium' | 'low';
  affectedComponents?: Array<{
    colorClass: string;
    hexColor?: string;
    filePath: string;
    elementContext?: string;
    riskLevel: 'high' | 'medium' | 'low';
    occurrence_count: number;
  }>;
}

// A1 Color risk tiers for Tailwind gray scale classes
// Higher risk = lighter colors that are more likely to fail on light backgrounds
const A1_COLOR_RISK_TIERS: Record<string, { riskLevel: 'high' | 'medium' | 'low'; baseConfidence: number }> = {
  // High risk: very light grays - almost certainly fail on white/light backgrounds
  'gray-200': { riskLevel: 'high', baseConfidence: 0.75 },
  'gray-300': { riskLevel: 'high', baseConfidence: 0.75 },
  'slate-200': { riskLevel: 'high', baseConfidence: 0.75 },
  'slate-300': { riskLevel: 'high', baseConfidence: 0.75 },
  'zinc-200': { riskLevel: 'high', baseConfidence: 0.75 },
  'zinc-300': { riskLevel: 'high', baseConfidence: 0.75 },
  // Medium risk: mid-light grays - likely to fail on white, borderline on light grays
  'gray-400': { riskLevel: 'medium', baseConfidence: 0.65 },
  'slate-400': { riskLevel: 'medium', baseConfidence: 0.65 },
  'zinc-400': { riskLevel: 'medium', baseConfidence: 0.65 },
  // Low risk: darker grays - may fail depending on background and font size
  'gray-500': { riskLevel: 'low', baseConfidence: 0.45 },
  'slate-500': { riskLevel: 'low', baseConfidence: 0.45 },
  'zinc-500': { riskLevel: 'low', baseConfidence: 0.45 },
};

function analyzeContrastInCode(files: Map<string, string>): ContrastViolation[] {
  // Collect all potential A1 findings first for aggregation
  const a1Findings: Array<{
    colorClass: string;
    colorName: string;
    hexColor?: string;
    filePath: string;
    elementContext?: string;
    riskLevel: 'high' | 'medium' | 'low';
    confidence: number;
  }> = [];
  
  for (const [filepath, content] of files) {
    const textColors = extractTextColors(content);
    
    for (const { colorClass, context } of textColors) {
      const colorMatch = colorClass.match(/text-(\w+-?\d*)/);
      if (!colorMatch) continue;
      
      const colorName = colorMatch[1];
      const riskTier = A1_COLOR_RISK_TIERS[colorName];
      
      if (!riskTier) continue; // Not a tracked low-contrast color
      
      const hexColor = TAILWIND_COLORS[colorName];
      const elementContext = inferElementContext(context);
      
      a1Findings.push({
        colorClass,
        colorName,
        hexColor,
        filePath: filepath,
        elementContext: elementContext || undefined,
        riskLevel: riskTier.riskLevel,
        confidence: riskTier.baseConfidence,
      });
    }
  }
  
  if (a1Findings.length === 0) {
    return [];
  }
  
  // Aggregate and deduplicate by color class + file
  const dedupeMap = new Map<string, {
    colorClass: string;
    colorName: string;
    hexColor?: string;
    filePath: string;
    elementContext?: string;
    riskLevel: 'high' | 'medium' | 'low';
    confidence: number;
    occurrence_count: number;
  }>();
  
  for (const finding of a1Findings) {
    const key = `${finding.colorName}:${finding.filePath}`;
    if (dedupeMap.has(key)) {
      const existing = dedupeMap.get(key)!;
      existing.occurrence_count += 1;
    } else {
      dedupeMap.set(key, { ...finding, occurrence_count: 1 });
    }
  }
  
  const affectedComponents = Array.from(dedupeMap.values());
  
  // Count by risk level
  const highRiskCount = affectedComponents.filter(c => c.riskLevel === 'high').length;
  const mediumRiskCount = affectedComponents.filter(c => c.riskLevel === 'medium').length;
  const lowRiskCount = affectedComponents.filter(c => c.riskLevel === 'low').length;
  
  // Determine overall risk level (highest tier present)
  let overallRiskLevel: 'high' | 'medium' | 'low' = 'low';
  if (highRiskCount > 0) overallRiskLevel = 'high';
  else if (mediumRiskCount > 0) overallRiskLevel = 'medium';
  
  // Calculate overall confidence based on highest-risk findings
  const maxConfidence = Math.max(...affectedComponents.map(c => c.confidence));
  const overallConfidence = Math.round(maxConfidence * 100) / 100;
  
  // Build unique color classes list
  const uniqueColorClasses = [...new Set(affectedComponents.map(c => c.colorClass))];
  const displayLimit = 4;
  const displayedColors = uniqueColorClasses.slice(0, displayLimit);
  const moreCount = uniqueColorClasses.length - displayLimit;
  const moreText = moreCount > 0 ? ` and ${moreCount} more` : '';
  
  // Build file list
  const uniqueFiles = [...new Set(affectedComponents.map(c => c.filePath.split('/').pop() || c.filePath))];
  const fileDisplayLimit = 3;
  const displayedFiles = uniqueFiles.slice(0, fileDisplayLimit);
  const fileMoreCount = uniqueFiles.length - fileDisplayLimit;
  const fileMoreText = fileMoreCount > 0 ? ` and ${fileMoreCount} more` : '';
  
  // Build risk breakdown text
  const riskBreakdown = [
    highRiskCount > 0 ? `${highRiskCount} high-risk` : '',
    mediumRiskCount > 0 ? `${mediumRiskCount} medium-risk` : '',
    lowRiskCount > 0 ? `${lowRiskCount} low-risk` : '',
  ].filter(Boolean).join(', ');
  
  // Build diagnosis with uncertainty factors explained
  const diagnosis = `Potential WCAG AA contrast risk: ${affectedComponents.length} text color occurrence(s) detected ` +
    `using ${displayedColors.join(', ')}${moreText} in ${displayedFiles.join(', ')}${fileMoreText}. ` +
    `Risk breakdown: ${riskBreakdown}. ` +
    `Static analysis cannot determine the actual rendered background color, so contrast sufficiency cannot be confirmed. ` +
    `Additionally, actual contrast may vary based on font size and weight (large/bold text requires only 3:1 ratio). ` +
    `This finding is reported as a heuristic risk with reduced confidence.`;
  
  // Build contextual hint based on DETECTED colors, not generic tiers
  const detectedColorNames = [...new Set(affectedComponents.map(c => c.colorName))];
  const hasGray200 = detectedColorNames.some(c => c.includes('200'));
  const hasGray300 = detectedColorNames.some(c => c.includes('300'));
  const hasGray400 = detectedColorNames.some(c => c.includes('400'));
  const hasGray500 = detectedColorNames.some(c => c.includes('500'));
  
  // Build hint based on what was actually detected
  const detectedLightGrays: string[] = [];
  if (hasGray300) detectedLightGrays.push('gray-300');
  if (hasGray400) detectedLightGrays.push('gray-400');
  if (hasGray200) detectedLightGrays.push('gray-200'); // Only include if actually detected
  
  const contextualHint = overallRiskLevel === 'high' || overallRiskLevel === 'medium'
    ? `Light text colors (${detectedLightGrays.length > 0 ? detectedLightGrays.join(', ') : 'gray-300, gray-400'}) may be insufficient for informational text on light backgrounds.`
    : hasGray500
    ? 'Text color (gray-500) is near-threshold; contrast may be insufficient depending on background and font characteristics.'
    : 'Detected text colors may be insufficient depending on background and font characteristics.';
  
  // Single deterministic corrective prompt - targets commonly problematic colors
  // Only mention colors that are commonly problematic (gray-300/400), not gray-200 unless detected
  const correctivePromptColors = hasGray200 ? 'gray-200/300/400' : 'gray-300/400';
  const correctivePrompt = `Replace low-contrast text colors (${correctivePromptColors}) with higher-contrast tokens (gray-600/700 or theme foreground) for informational text, while preserving design intent.`;
  
  console.log(`Computed ${affectedComponents.length} contrast findings → 1 aggregated A1 result (${riskBreakdown})`);
  
  // Return ONE aggregated A1 result
  return [{
    ruleId: 'A1',
    ruleName: 'Insufficient text contrast',
    category: 'accessibility',
    status: 'potential', // Always potential for static analysis
    evidence: `Text color classes detected: ${displayedColors.join(', ')}${moreText}. Background color cannot be determined from static analysis.`,
    diagnosis,
    contextualHint,
    correctivePrompt,
    confidence: overallConfidence,
    riskLevel: overallRiskLevel,
    affectedComponents: affectedComponents.map(c => ({
      colorClass: c.colorClass,
      hexColor: c.hexColor,
      filePath: c.filePath,
      elementContext: c.elementContext,
      riskLevel: c.riskLevel,
      occurrence_count: c.occurrence_count,
    })),
  }];
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

### U1 (Unclear primary action) — COMPREHENSIVE EVIDENCE-BASED DETECTION RULES:

**GOAL:** Detect unclear primary action issues whenever visual hierarchy fails, based only on observable evidence. Do not speculate. Do not infer intent.

**CRITICAL — BUTTON VARIANT RESOLUTION (shadcn/Radix):**
- NO variant prop specified → uses \`variant="default"\` → FILLED/PRIMARY button (bg-primary)
- \`variant="default"\` = FILLED button (visually prominent, solid background)
- \`variant="outline"\` = OUTLINED button (border only, transparent background)
- \`variant="ghost"\` = GHOST button (no border, transparent background)
- \`variant="secondary"\` = SECONDARY button (muted background)
- \`variant="link"\` = TEXT LINK style (underline on hover, no background)

---

**U1 MUST TRIGGER if ANY of the following evidence-based cases are met:**

---

**CASE A — Equal emphasis between primary and secondary actions**

Trigger U1 when ALL are true:
- Two or more actions are present in the same action area (e.g., DialogFooter, ButtonGroup, form actions)
- A primary action is identifiable (e.g., submit, apply, confirm, save, create, send)
- The primary action has equal or lower visual emphasis than at least one secondary action
  (e.g., BOTH are outline/ghost/text, or secondary appears stronger)

**Example evidence for CASE A:**
"DialogFooter contains Submit (variant='outline') and Cancel (variant='outline'). Both use identical outline styling."

---

**CASE B — Multiple competing primary actions**

Trigger U1 when ALL are true:
- Three or more actions are present in the same visual group or container
- Two or more actions use high-emphasis styling (variant="default"/primary/filled, solid background)
- No single action is visually distinguished as dominant

**Example evidence for CASE B:**
"Card footer contains three buttons: 'Save Draft', 'Submit', 'Publish'. All three use variant='default' (filled) with equal visual prominence."

---

**CASE C — Hidden affordance in default state**

Trigger U1 when ALL are true:
- An important action lacks clear button affordance in the DEFAULT (non-hover) state
- Button-like styling (background, border, padding, shadow) appears ONLY on hover/focus
- Users must interact to discover clickability

**Example evidence for CASE C:**
"Primary action button uses variant='ghost' or has no visible border/background until hover state is triggered."

---

**CASE D — Primary action visually de-emphasized**

Trigger U1 when ALL are true:
- A primary action exists (submit, confirm, save, etc.)
- It is styled as low emphasis (variant='link', variant='ghost', variant='outline')
- Secondary or less important actions are styled with higher emphasis (variant='default' or solid background)

**Example evidence for CASE D:**
"Submit button uses variant='outline' while Cancel button uses variant='default' (filled). Primary action is less prominent than secondary."

---

**STRICT FALSE-POSITIVE PREVENTION — DO NOT TRIGGER U1 if ANY are true:**
- Only ONE action is present (no competing actions)
- The primary action is clearly MORE visually prominent than others (primary=filled, secondary=outline/ghost)
- Action hierarchy cannot be evaluated due to missing evidence
- The issue relies on speculation ("if", "could", "might", "would")
- Cannot extract variant/styling information for BOTH actions

---

**NO SPECULATION RULE — ABSOLUTE:**
- If the primary action button is NOT present in the analyzed code → DO NOT emit U1
- If the primary action's variant/classes cannot be extracted → DO NOT emit U1
- If a button has NO variant prop → assume variant="default" (FILLED) — NOT outline
- DO NOT use conditional language ("if", "could", "might", "would", "may") to justify a violation
- DO NOT claim "equal emphasis" unless BOTH buttons' variants are explicitly the SAME value

---

**OUTPUT FORMAT (when evidence is complete):**
\`\`\`json
{
  "ruleId": "U1",
  "ruleName": "Unclear primary action",
  "category": "usability",
  "caseType": "A" | "B" | "C" | "D",
  "evidence": "[Specific observed evidence for the triggered case]",
  "primaryAction": "[Button label and variant]",
  "secondaryAction": "[Button label and variant]" (if applicable),
  "stylingComparison": "[Explicit comparison of visual treatments]",
  "diagnosis": "Users may struggle to identify the main action because [evidence-based reason]. [Explain visual hierarchy failure].",
  "contextualHint": "[Location]-specific guidance on how to establish visual hierarchy.",
  "confidence": 0.65-0.80
}
\`\`\`

---

**PASS-SILENCE POLICY:**
- If none of Cases A, B, C, D apply → produce NO OUTPUT for U1 (silent PASS)
- If primary is variant="default"/filled AND secondary is outline/ghost → PASS (correct hierarchy)
- Silent PASS means: do not include U1 in violations array, no corrective prompt

---

**AGGREGATION:**
- Emit ONE aggregated U1 entry per run (do not duplicate across files)
- Reference detected components or file paths
- Use heuristic language ("may reduce clarity", "may increase cognitive load")
- Confidence: 65–80% depending on clarity of evidence

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

    // Compute A1 contrast violations directly - ONLY if A1 is selected
    const contrastViolations: ContrastViolation[] = [];
    if (selectedRulesSet.has('A1')) {
      const computed = analyzeContrastInCode(files);
      contrastViolations.push(...computed);
      console.log(`Computed ${contrastViolations.length} contrast violations`);
    } else {
      console.log('A1 not selected, skipping contrast analysis');
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
    
    // Separate A2, A4, and A5 violations for aggregation (only from selected rules)
    const a2Violations: any[] = [];
    const a4Violations: any[] = [];
    const a5Violations: any[] = [];
    const otherViolations: any[] = [];
    
    filteredBySelection.forEach((v: any) => {
      if (v.ruleId === 'A2') {
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
    const validatedU1Violations = u1Violations.filter((v: any) => {
      const evidence = (v.evidence || '').toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const caseType = (v.caseType || '').toUpperCase();
      const combined = evidence + ' ' + diagnosis;
      
      // FILTER: Speculative language indicates incomplete evidence (applies to ALL cases)
      const hasSpeculativeLanguage = /\bif\b.*\b(also|uses?|were?|is)\b|\bcould\b|\bmight\b|\bwould\b|\bmay\b(?!\s+struggle)|\bpossibly\b|\bpotentially\b|\bassuming\b|\bif the\b/.test(combined);
      if (hasSpeculativeLanguage) {
        console.log(`U1: Filtering out speculative violation: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // ========== CASE A: Equal emphasis between primary and secondary ==========
      const isCaseA = caseType === 'A' || /equal.*emphasis|identical.*styl|same.*variant|both.*outline|both.*ghost/.test(combined);
      
      if (isCaseA) {
        // Must mention at least two distinct actions/buttons
        const hasTwoActions = /\btwo\b|\bboth\b|\band\b.*\bbutton|\bcancel.*submit\b|\bsubmit.*cancel\b|\bprimary.*secondary\b|\bsecondary.*primary\b|\bconfirm.*cancel\b|\bcancel.*confirm\b/.test(combined);
        const mentionsMultipleButtons = (combined.match(/\bbutton/g) || []).length >= 2;
        if (!hasTwoActions && !mentionsMultipleButtons) {
          console.log(`U1 Case A: Filtering out - does not evidence two actions: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Must identify styling comparison
        const hasStylingEvidence = /variant|outline|ghost|default|primary|solid|text-|bg-|border-|same styl|identical|equal.*emphasis|similar.*appearance/.test(combined);
        if (!hasStylingEvidence) {
          console.log(`U1 Case A: Filtering out - no styling comparison evidence: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Check for false positives: primary is filled AND secondary is outline/ghost → PASS
        const primaryVariant = (v.primaryVariant || '').toLowerCase();
        const secondaryVariant = (v.secondaryVariant || '').toLowerCase();
        
        const primaryIsDefault = /primary.*(?:variant=['"]?default|no variant|default variant|filled|solid|bg-primary)/.test(combined) ||
                                 /submit.*(?:no variant|default|filled|solid)/.test(combined) ||
                                 (primaryVariant === 'default' || primaryVariant === '' || primaryVariant === 'primary');
        const secondaryIsOutlineOrGhost = /(?:cancel|secondary).*(?:variant=['"]?outline|variant=['"]?ghost|outline|ghost)/.test(combined) ||
                                          (secondaryVariant === 'outline' || secondaryVariant === 'ghost');
        
        if (primaryIsDefault && secondaryIsOutlineOrGhost) {
          console.log(`U1 Case A: Filtering out - correct hierarchy (primary=filled, secondary=outline/ghost): ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Must explicitly state BOTH buttons use the SAME variant
        const claimsEqualEmphasis = /equal.*emphasis|identical.*styl|same.*variant|both.*outline|both.*ghost|both.*default/.test(combined);
        const explicitlyMatchingVariants = /both.*(?:use|have|are).*(?:outline|ghost|default)|(?:cancel|secondary).*(?:outline|ghost).*(?:submit|primary|confirm).*(?:outline|ghost)|variant=['"]?outline['"]?.*variant=['"]?outline/.test(combined);
        
        if (claimsEqualEmphasis && !explicitlyMatchingVariants) {
          const submitClaimedOutline = /submit.*(?:variant=['"]?outline|outline.*button)/.test(combined);
          const submitHasNoVariantMentioned = !/submit.*variant=/.test(combined);
          
          if (submitHasNoVariantMentioned && !submitClaimedOutline) {
            console.log(`U1 Case A: Filtering out - submit button variant not explicitly specified (defaults to filled): ${v.evidence?.substring(0, 100)}`);
            return false;
          }
        }
        
        console.log(`U1 Case A: Valid violation with evidence: ${v.evidence?.substring(0, 100)}`);
        return true;
      }
      
      // ========== CASE B: Multiple competing primary actions ==========
      const isCaseB = caseType === 'B' || /three.*(?:button|action)|multiple.*(?:primary|filled)|competing.*primary|all.*(?:filled|default|prominent)/.test(combined);
      
      if (isCaseB) {
        // Must mention 3+ actions or buttons
        const hasThreeOrMore = /three|3|multiple|all.*button|several/.test(combined);
        const buttonCount = (combined.match(/\bbutton/g) || []).length;
        if (!hasThreeOrMore && buttonCount < 3) {
          console.log(`U1 Case B: Filtering out - does not evidence 3+ actions: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Must evidence that 2+ actions have high emphasis
        const hasCompetingEmphasis = /all.*(?:filled|default|prominent)|(?:two|2|multiple).*(?:filled|primary|high.*emphasis)|no.*(?:single|clear).*dominant/.test(combined);
        if (!hasCompetingEmphasis) {
          console.log(`U1 Case B: Filtering out - no evidence of competing high-emphasis actions: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        console.log(`U1 Case B: Valid violation with evidence: ${v.evidence?.substring(0, 100)}`);
        return true;
      }
      
      // ========== CASE C: Hidden affordance in default state ==========
      const isCaseC = caseType === 'C' || /hidden.*affordance|no.*visible.*(?:background|border|styling)|hover.*only|discover.*click/.test(combined);
      
      if (isCaseC) {
        // Must evidence lack of button affordance
        const hasHiddenAffordanceEvidence = /ghost|no.*(?:background|border|padding)|text.*only|link.*style|hover.*(?:only|reveal)|discover.*click|lacks.*affordance/.test(combined);
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
      const isCaseD = caseType === 'D' || /primary.*(?:outline|ghost|link|text)|secondary.*(?:more|higher).*(?:prominent|emphasis)|inverted.*hierarchy/.test(combined);
      
      if (isCaseD) {
        // Must evidence primary has low emphasis
        const primaryLowEmphasis = /(?:submit|confirm|save|primary).*(?:outline|ghost|link|text|de-emphasis|less.*prominent)/.test(combined);
        if (!primaryLowEmphasis) {
          console.log(`U1 Case D: Filtering out - no evidence of primary de-emphasis: ${v.evidence?.substring(0, 100)}`);
          return false;
        }
        
        // Must evidence secondary has higher emphasis
        const secondaryHighEmphasis = /(?:cancel|secondary|dismiss).*(?:filled|default|solid|more.*prominent|higher.*emphasis)/.test(combined);
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
      const hasStylingEvidence = /variant|outline|ghost|default|primary|solid|text-|bg-|border-|same styl|identical|equal.*emphasis|similar.*appearance/.test(combined);
      if (!hasStylingEvidence) {
        console.log(`U1: Filtering out - no styling comparison evidence: ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      // Check for false positives
      const primaryVariant = (v.primaryVariant || '').toLowerCase();
      const secondaryVariant = (v.secondaryVariant || '').toLowerCase();
      
      const primaryIsDefault = /primary.*(?:variant=['"]?default|no variant|default variant|filled|solid|bg-primary)/.test(combined) ||
                               /submit.*(?:no variant|default|filled|solid)/.test(combined) ||
                               (primaryVariant === 'default' || primaryVariant === '' || primaryVariant === 'primary');
      const secondaryIsOutlineOrGhost = /(?:cancel|secondary).*(?:variant=['"]?outline|variant=['"]?ghost|outline|ghost)/.test(combined) ||
                                        (secondaryVariant === 'outline' || secondaryVariant === 'ghost');
      
      if (primaryIsDefault && secondaryIsOutlineOrGhost) {
        console.log(`U1: Filtering out - correct hierarchy (primary=filled, secondary=outline/ghost): ${v.evidence?.substring(0, 100)}`);
        return false;
      }
      
      console.log(`U1: Valid violation with evidence: ${v.evidence?.substring(0, 100)}`);
      return true;
    });
    
    if (u1Violations.length > 0 && validatedU1Violations.length === 0) {
      console.log(`U1: No valid violations found (${u1Violations.length} filtered out as speculative or lacking evidence)`);
    }
    
    // Process non-A2/A4/A5/U1 violations
    const filteredOtherViolations = [...nonU1OtherViolations, ...validatedU1Violations]
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
    
    // ========== A4 AGGREGATION LOGIC ==========
    // Process and aggregate A4 violations into a single result object
    interface A4AffectedItem {
      component_name: string;
      file_path: string;
      size_token: string;
      approx_px: string;
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }
    
    const a4DedupeMap = new Map<string, A4AffectedItem>();
    const detectedSizeRanges = new Set<string>();
    
    // Invalid identifiers for A4 component naming - filter out non-component strings
    const a4InvalidComponentNames = new Set([
      'increase', 'ensure', 'add', 'use', 'apply', 'set', 'get', 'make', 'create',
      'element', 'elements', 'interactive', 'dimensions', 'target', 'targets',
      'minimum', 'size', 'sizes', 'width', 'height', 'padding', 'constraint',
      'button', 'buttons', 'icon', 'icons', 'control', 'controls',
      'component', 'components', 'item', 'items', 'unknown', 'default',
      'variants', 'variant', 'props', 'className', 'style', 'styles'
    ]);
    
    // Helper to validate component name (must be PascalCase, no spaces, no verbs/instructions)
    function isValidA4ComponentName(name: string): boolean {
      if (!name || name.length < 3) return false;
      // Must start with uppercase (PascalCase)
      if (!/^[A-Z]/.test(name)) return false;
      // No spaces allowed
      if (/\s/.test(name)) return false;
      // No instructional/verb phrases
      if (/^(Increase|Ensure|Add|Use|Apply|Set|Get|Make|Create|Should|Must|Will|Can)/i.test(name)) return false;
      // Not in invalid set
      if (a4InvalidComponentNames.has(name.toLowerCase())) return false;
      return true;
    }
    
    for (const v of a4Violations) {
      const evidence = (v.evidence || '');
      const evidenceLower = evidence.toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidenceLower + ' ' + diagnosis;
      
      // Extract component info from evidence - prioritize compound PascalCase names
      const compoundMatch = evidence.match(/\b([A-Z][a-zA-Z0-9]*(?:Previous|Next|Button|Icon|Close|Nav|Toggle|Trigger|Control|Action|Arrow|Pagination|Calendar|Carousel))\b/);
      const simpleMatch = evidence.match(/\b([A-Z][a-zA-Z0-9]{3,})\b/);
      const fileMatch = (evidence || v.contextualHint || '').match(/([a-zA-Z0-9_-]+\.(?:tsx|jsx|ts|js|vue|svelte))/i);
      
      // Resolve component name with strict validation
      let componentName = '';
      
      // 1. Try compound component name first (e.g., CarouselPrevious, CalendarNavButton)
      if (compoundMatch?.[1] && isValidA4ComponentName(compoundMatch[1])) {
        componentName = compoundMatch[1];
      }
      // 2. Try simple PascalCase component
      else if (simpleMatch?.[1] && isValidA4ComponentName(simpleMatch[1])) {
        componentName = simpleMatch[1];
      }
      // 3. Fallback to file name
      else if (fileMatch?.[1]) {
        const fileName = fileMatch[1].replace(/\.(tsx|jsx|ts|js|vue|svelte)$/i, '');
        // Convert file name to PascalCase if needed (e.g., carousel -> Carousel)
        if (fileName && fileName.length > 2) {
          componentName = fileName.charAt(0).toUpperCase() + fileName.slice(1);
        }
      }
      
      const filePath = fileMatch?.[1] || v.filePath || '';
      
      // Extract size token and approximate px - be more specific when possible
      let sizeToken = '';
      let approxPx = '';
      
      // Common Tailwind size patterns - check most specific first
      if (/h-6\b|w-6\b|size-6\b/.test(combined)) { sizeToken = 'h-6/w-6'; approxPx = '~24px'; detectedSizeRanges.add('~24px'); }
      else if (/h-7\b|w-7\b|size-7\b/.test(combined)) { sizeToken = 'h-7/w-7'; approxPx = '~28px'; detectedSizeRanges.add('~28px'); }
      else if (/h-8\b|w-8\b|size-8\b/.test(combined)) { sizeToken = 'h-8/w-8'; approxPx = '~32px'; detectedSizeRanges.add('~32px'); }
      else if (/h-9\b|w-9\b|size-9\b/.test(combined)) { sizeToken = 'h-9/w-9'; approxPx = '~36px'; detectedSizeRanges.add('~36px'); }
      else if (/h-10\b|w-10\b|size-10\b/.test(combined)) { sizeToken = 'h-10/w-10'; approxPx = '~40px'; detectedSizeRanges.add('~40px'); }
      else if (/24px|1\.5rem/.test(combined)) { sizeToken = '24px'; approxPx = '~24px'; detectedSizeRanges.add('~24px'); }
      else if (/28px|1\.75rem/.test(combined)) { sizeToken = '28px'; approxPx = '~28px'; detectedSizeRanges.add('~28px'); }
      else if (/32px|2rem/.test(combined)) { sizeToken = '32px'; approxPx = '~32px'; detectedSizeRanges.add('~32px'); }
      else if (/36px|2\.25rem/.test(combined)) { sizeToken = '36px'; approxPx = '~36px'; detectedSizeRanges.add('~36px'); }
      else if (/40px|2\.5rem/.test(combined)) { sizeToken = '40px'; approxPx = '~40px'; detectedSizeRanges.add('~40px'); }
      else if (/min-h-|min-w-/.test(combined)) { sizeToken = 'min-h/w constraint'; approxPx = 'variable'; }
      else if (/small|compact|undersized/.test(combined)) { sizeToken = 'implicit sizing'; approxPx = '<44px'; detectedSizeRanges.add('<44px'); }
      else { sizeToken = 'implicit sizing'; approxPx = '<44px'; detectedSizeRanges.add('<44px'); }
      
      // Calculate confidence
      let confidence = v.confidence || 0.60;
      // Adjust based on size proximity to 44px
      if (approxPx.includes('40')) confidence = Math.max(confidence - 0.1, 0.45);
      else if (approxPx.includes('36')) confidence = Math.min(confidence + 0.05, 0.75);
      else if (approxPx.includes('32') || approxPx.includes('28') || approxPx.includes('24')) confidence = Math.min(confidence + 0.1, 0.80);
      
      const rationale = v.diagnosis || `Element may be below the commonly recommended touch target size of 44×44 CSS px.`;
      
      // Deduplication key - by component name only (to aggregate all instances)
      const dedupeKey = componentName || filePath || 'unknown';
      
      if (a4DedupeMap.has(dedupeKey)) {
        const existing = a4DedupeMap.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        // Keep the higher confidence
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
          existing.size_token = sizeToken;
          existing.approx_px = approxPx;
        }
      } else {
        const item: A4AffectedItem = {
          component_name: componentName,
          file_path: filePath,
          size_token: sizeToken,
          approx_px: approxPx,
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
        };
        a4DedupeMap.set(dedupeKey, item);
      }
    }
    
    const a4AffectedItems = Array.from(a4DedupeMap.values());
    
    // Create aggregated A4 result if there are any items
    let aggregatedA4: any = null;
    if (a4AffectedItems.length > 0) {
      // Calculate overall confidence (max of all findings - deterministic)
      const overallConfidence = Math.max(...a4AffectedItems.map(i => i.confidence));
      const confidenceReason = `Confidence is based on code-level size tokens (${Array.from(detectedSizeRanges).join(', ')}) and the absence of runtime layout evaluation. Static analysis cannot confirm actual rendered dimensions.`;
      
      // Build unique component names list (filter invalid identifiers and non-component strings)
      const invalidIdentifiers = new Set([
        'variants', 'variant', 'props', 'className', 'classname', 'style', 'styles',
        'default', 'config', 'options', 'settings', 'utils', 'helpers', 'constants',
        'types', 'index', 'main', 'app', 'root', 'container', 'wrapper', 'layout',
        'component', 'components', 'element', 'elements', 'item', 'items', 'button',
        'unknown', 'undefined', 'null', 'true', 'false', 'function', 'object', 'array',
        // Instructional/guideline words that should never be component names
        'increase', 'ensure', 'add', 'use', 'apply', 'set', 'get', 'make', 'create',
        'interactive', 'dimensions', 'target', 'targets', 'minimum', 'size', 'sizes'
      ]);
      
      const uniqueComponentNames = new Set<string>();
      for (const item of a4AffectedItems) {
        const name = item.component_name || '';
        // Validate: must be PascalCase, no spaces, not in invalid set
        if (name && name.length > 2 && 
            /^[A-Z][a-zA-Z0-9]+$/.test(name) && // PascalCase, no spaces
            !invalidIdentifiers.has(name.toLowerCase()) &&
            !/^(Use|Get|Set|Is|Has|Can|Should|Will|On|Handle)[A-Z]/.test(name)) {
          uniqueComponentNames.add(name);
        }
      }
      
      // Fall back to file paths if no valid component names
      if (uniqueComponentNames.size === 0) {
        for (const item of a4AffectedItems) {
          const filePath = item.file_path || '';
          if (filePath) {
            const fileName = filePath.replace(/.*[\/\\]/, '').replace(/\.(tsx|jsx|ts|js|vue|svelte)$/i, '');
            if (fileName && fileName.length > 2 && !invalidIdentifiers.has(fileName.toLowerCase())) {
              // Convert to PascalCase for display
              const displayName = fileName.charAt(0).toUpperCase() + fileName.slice(1);
              uniqueComponentNames.add(displayName);
            }
          }
        }
      }
      
      // Build deduplicated component list (max 4, with "and N more")
      const uniqueNamesArray = Array.from(uniqueComponentNames);
      const displayLimit = 4;
      const displayedNames = uniqueNamesArray.slice(0, displayLimit);
      const moreCount = uniqueNamesArray.length - displayLimit;
      const moreText = moreCount > 0 ? ` and ${moreCount} more` : '';
      
      const componentCountText = uniqueNamesArray.length > 0 
        ? `${uniqueNamesArray.length} unique component(s): ${displayedNames.join(', ')}${moreText}`
        : `${a4AffectedItems.length} element(s)`;
      
      const sizeRangesText = detectedSizeRanges.size > 0 
        ? `Detected size ranges: ${Array.from(detectedSizeRanges).join(', ')}.`
        : '';
      
      const summary = `Interactive elements in ${componentCountText} may be below the commonly recommended touch target size of 44×44 CSS px. ${sizeRangesText} ` +
        `44×44 CSS px is commonly recommended in usability and accessibility guidelines (WCAG 2.1 Target Size is AAA, not AA). ` +
        `Padding or box sizing at runtime may increase the clickable area, but static analysis cannot confirm rendered dimensions.`;
      
      const a4Rule = allRules.find(r => r.id === 'A4');
      
      aggregatedA4 = {
        ruleId: 'A4',
        ruleName: 'Small tap / click targets',
        category: 'accessibility',
        typeBadge: 'Potential Risk (Heuristic)',
        overall_confidence: Math.round(overallConfidence * 100) / 100,
        confidence_reason: confidenceReason,
        summary,
        detected_size_ranges: Array.from(detectedSizeRanges),
        affected_items: a4AffectedItems.map(item => ({
          component_name: item.component_name,
          file_path: item.file_path,
          size_token: item.size_token,
          approx_px: item.approx_px,
          confidence: item.confidence,
          rationale: item.rationale,
          ...(item.occurrence_count && item.occurrence_count > 1 ? { occurrence_count: item.occurrence_count } : {}),
        })),
        diagnosis: summary,
        contextualHint: 'Explicitly enforce minimum dimensions (44×44 CSS px) using min-width and min-height constraints for interactive elements.',
        correctivePrompt: a4Rule?.correctivePrompt || '',
        confidence: Math.round(overallConfidence * 100) / 100,
      };
      
      console.log(`A4 aggregated: ${a4Violations.length} findings → 1 result (${uniqueNamesArray.length} unique components, sizes: ${Array.from(detectedSizeRanges).join(', ')})`);
    }
    
    // ========== A5 AGGREGATION LOGIC ==========
    // Process and aggregate A5 violations into a single result object
    // Only report A5 when: outline is removed AND no visible focus replacement exists
    interface A5AffectedItem {
      component_name: string;
      file_path: string;
      typeBadge: 'Confirmed Violation' | 'Heuristic Risk';
      focus_classes: string[];
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }
    
    const a5DedupeMap = new Map<string, A5AffectedItem>();
    const a5ValidViolations: any[] = [];
    
    // First pass: filter A5 violations to only include actual violations
    for (const v of a5Violations) {
      const evidence = (v.evidence || '');
      const evidenceLower = evidence.toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidenceLower + ' ' + diagnosis;
      
      // ABSOLUTE RULE: Only evaluate elements that explicitly remove the browser outline
      const mentionsOutlineRemoval = /outline-none|focus:outline-none|focus-visible:outline-none/.test(combined);
      if (!mentionsOutlineRemoval) {
        console.log(`A5 SKIP (no outline removal): ${evidence}`);
        continue;
      }
      
      // Extract actual focus-related class tokens from the evidence
      // These are the actual Tailwind classes found in code, not just text descriptions
      const focusClassTokens: string[] = evidence.match(/focus(?:-visible)?:(?:ring(?:-\w+)?|border(?:-\w+)?|shadow(?:-\w+)?|outline(?:-\w+)?|bg-\w+)/gi) || [];
      
      // Check for visible focus replacement indicators (actual class tokens)
      const hasRingToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:ring/i.test(t));
      const hasBorderToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:border/i.test(t));
      const hasShadowToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:shadow/i.test(t));
      const hasOutlineToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:outline-(?!none)/i.test(t));
      
      // Also check in diagnosis for class mentions
      const hasRingInDiagnosis = /focus:ring-|focus-visible:ring-|ring-offset-\d/.test(combined);
      const hasBorderInDiagnosis = /focus:border-|focus-visible:border-/.test(combined);
      const hasShadowInDiagnosis = /focus:shadow-|focus-visible:shadow-/.test(combined);
      
      const hasVisibleReplacement = hasRingToken || hasBorderToken || hasShadowToken || hasOutlineToken ||
                                     hasRingInDiagnosis || hasBorderInDiagnosis || hasShadowInDiagnosis;
      
      // Check if explicitly marked as pass/acceptable
      // IMPORTANT: Avoid matching negative phrases like "no visible replacement"
      const mentionsAcceptable = /(?<!no\s)(?<!without\s)(?<!lacks?\s)(?<!missing\s)(?:acceptable|compliant|has visible|proper focus|adequate focus|valid focus)/i.test(combined);
      const explicitlyPasses = /\bpass\b(?!word)/i.test(combined) && !/does not pass|doesn't pass|fail/i.test(combined);
      
      // If evidence shows valid replacement or acceptable, this is a PASS - skip entirely
      if (hasVisibleReplacement) {
        console.log(`A5 PASS (has focus replacement tokens): ${evidence} [tokens: ${focusClassTokens.join(', ')}]`);
        continue;
      }
      
      if (mentionsAcceptable || explicitlyPasses) {
        console.log(`A5 PASS (explicitly acceptable): ${evidence}`);
        continue;
      }
      
      // Check for weak indicators (background-only focus)
      const hasBgToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:bg-/i.test(t));
      const hasBackgroundOnlyFocus = (hasBgToken || /focus:bg-|focus-visible:bg-/.test(combined)) && 
                                      !hasRingToken && !hasBorderToken && !hasShadowToken && !hasOutlineToken;
      
      // This is a valid violation - add it
      console.log(`A5 VIOLATION: ${evidence} [background-only: ${hasBackgroundOnlyFocus}]`);
      a5ValidViolations.push({
        ...v,
        isHeuristicRisk: hasBackgroundOnlyFocus,
        detectedFocusClasses: focusClassTokens,
      });
    }
    
    // Second pass: aggregate valid A5 violations
    // Invalid identifiers for component naming - single words, utility tokens, non-UI terms
    const a5InvalidComponentNames = new Set([
      'clear', 'close', 'open', 'toggle', 'show', 'hide', 'set', 'get', 'add', 'remove',
      'delete', 'edit', 'update', 'create', 'submit', 'cancel', 'save', 'reset',
      'next', 'previous', 'prev', 'back', 'forward', 'up', 'down', 'left', 'right',
      'true', 'false', 'yes', 'no', 'on', 'off', 'enabled', 'disabled',
      'button', 'link', 'input', 'icon', 'text', 'label', 'container', 'wrapper',
      'component', 'element', 'item', 'items', 'default', 'variants', 'variant'
    ]);
    
    for (const v of a5ValidViolations) {
      const evidence = (v.evidence || '');
      const combined = (evidence + ' ' + (v.diagnosis || '')).toLowerCase();
      
      // Extract file path first (most reliable for component identification)
      const fileMatch = (evidence || v.contextualHint || '').match(/([a-zA-Z0-9_-]+\.(?:tsx|jsx|ts|js|vue|svelte))/i);
      
      // Extract PascalCase component names (prioritize compound names like CloseButton, NavToggle)
      const componentMatch = evidence.match(/\b([A-Z][a-zA-Z0-9]*(?:Button|Close|Toggle|Trigger|Nav|Icon|Control|Action|Link|Card|Dialog|Modal|Menu|Header|Footer|Sidebar|Panel|Form))\b/);
      const simpleComponentMatch = evidence.match(/(?:in\s+)?([A-Z][a-zA-Z0-9]{3,})/);
      
      // Resolve component name - prioritize compound PascalCase names
      let componentName = '';
      let filePath = fileMatch?.[1] || v.filePath || '';
      
      // 1. Try compound component name first (e.g., CloseButton, NavToggle)
      if (componentMatch?.[1] && componentMatch[1].length > 4) {
        componentName = componentMatch[1];
      }
      // 2. Try simple PascalCase component (but not single-word utility names)
      else if (simpleComponentMatch?.[1] && simpleComponentMatch[1].length > 3) {
        const candidate = simpleComponentMatch[1];
        if (!a5InvalidComponentNames.has(candidate.toLowerCase())) {
          componentName = candidate;
        }
      }
      // 3. Fallback to file name with "Unnamed component" prefix if no valid component name
      if (!componentName && filePath) {
        const fileName = filePath.replace(/\.(tsx|jsx|ts|js|vue|svelte)$/i, '');
        if (fileName && fileName.length > 2 && !a5InvalidComponentNames.has(fileName.toLowerCase())) {
          componentName = `Unnamed component (${filePath})`;
        }
      }
      // 4. Final fallback if still no name
      if (!componentName && v.componentName && !a5InvalidComponentNames.has(v.componentName.toLowerCase())) {
        componentName = v.componentName;
      }
      
      // filePath already extracted above
      
      // Extract focus-related classes mentioned
      const focusClasses: string[] = [];
      const classMatches = combined.match(/(?:focus:|focus-visible:)?(?:outline-none|bg-\w+|ring-\w+|border-\w+)/g);
      if (classMatches) {
        focusClasses.push(...new Set(classMatches));
      }
      
      // Determine type badge
      const typeBadge: 'Confirmed Violation' | 'Heuristic Risk' = v.isHeuristicRisk ? 'Heuristic Risk' : 'Confirmed Violation';
      
      // Calculate confidence
      let confidence = v.confidence || 0.65;
      if (v.isHeuristicRisk) {
        confidence = Math.min(confidence, 0.55); // Lower confidence for heuristic
      }
      
      const rationale = v.isHeuristicRisk 
        ? 'Focus indication relies only on background color change, which may be insufficient for users with color vision deficiencies.'
        : 'Element removes the default browser outline without providing a visible focus replacement.';
      
      // Deduplication key
      const dedupeKey = componentName || filePath || 'unknown';
      
      if (a5DedupeMap.has(dedupeKey)) {
        const existing = a5DedupeMap.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
        }
        // Merge focus classes
        focusClasses.forEach(c => {
          if (!existing.focus_classes.includes(c)) {
            existing.focus_classes.push(c);
          }
        });
      } else {
        const item: A5AffectedItem = {
          component_name: componentName,
          file_path: filePath,
          typeBadge,
          focus_classes: focusClasses,
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
        };
        a5DedupeMap.set(dedupeKey, item);
      }
    }
    
    const a5AffectedItems = Array.from(a5DedupeMap.values());
    
    // Create aggregated A5 result ONLY if there are actual violations
    let aggregatedA5: any = null;
    if (a5AffectedItems.length > 0) {
      // Calculate overall confidence (max of all findings)
      const overallConfidence = Math.max(...a5AffectedItems.map(i => i.confidence));
      
      const confirmedCount = a5AffectedItems.filter(i => i.typeBadge === 'Confirmed Violation').length;
      const heuristicCount = a5AffectedItems.filter(i => i.typeBadge === 'Heuristic Risk').length;
      
      const confidenceReason = `Confidence is based on static analysis of focus-related CSS classes. Elements that remove outline-none without visible ring/border/shadow replacements are flagged. Confidence may be lower for background-only focus patterns.`;
      
      // Build unique component names list - filter out non-semantic/utility identifiers
      const invalidIdentifiers = new Set([
        'variants', 'variant', 'props', 'className', 'classname', 'style', 'styles',
        'default', 'config', 'options', 'settings', 'utils', 'helpers', 'constants',
        'types', 'index', 'main', 'app', 'root', 'container', 'wrapper', 'layout',
        'component', 'components', 'element', 'elements', 'item', 'items', 'button',
        'unknown', 'undefined', 'null', 'true', 'false', 'function', 'object', 'array',
        // Single words that are not UI components
        'clear', 'close', 'open', 'toggle', 'show', 'hide', 'set', 'get', 'add', 'remove',
        'delete', 'edit', 'update', 'create', 'submit', 'cancel', 'save', 'reset',
        'next', 'previous', 'prev', 'back', 'forward', 'up', 'down', 'left', 'right',
        'true', 'false', 'yes', 'no', 'on', 'off', 'enabled', 'disabled'
      ]);
      
      const uniqueComponentNames = new Set<string>();
      for (const item of a5AffectedItems) {
        const name = item.component_name || '';
        if (name && name.length > 2 && !invalidIdentifiers.has(name.toLowerCase())) {
          if (!/^(use|get|set|is|has|can|should|will|on|handle)[A-Z]/.test(name)) {
            uniqueComponentNames.add(name);
          }
        }
      }
      
      // Fall back to file paths if no valid component names
      if (uniqueComponentNames.size === 0) {
        for (const item of a5AffectedItems) {
          const filePath = item.file_path || '';
          if (filePath) {
            const fileName = filePath.replace(/.*[\/\\]/, '').replace(/\.(tsx|jsx|ts|js|vue|svelte)$/i, '');
            if (fileName && fileName.length > 2 && !invalidIdentifiers.has(fileName.toLowerCase())) {
              uniqueComponentNames.add(fileName);
            }
          }
        }
      }
      
      // Build deduplicated component list (max 4, with "and N more")
      const uniqueNamesArray = Array.from(uniqueComponentNames);
      const displayLimit = 4;
      const displayedNames = uniqueNamesArray.slice(0, displayLimit);
      const moreCount = uniqueNamesArray.length - displayLimit;
      const moreText = moreCount > 0 ? ` and ${moreCount} more` : '';
      
      const componentCountText = uniqueNamesArray.length > 0 
        ? `${uniqueNamesArray.length} unique component(s): ${displayedNames.join(', ')}${moreText}`
        : `${a5AffectedItems.length} element(s)`;
      
      const typeBreakdown = [
        confirmedCount > 0 ? `${confirmedCount} confirmed violation(s)` : '',
        heuristicCount > 0 ? `${heuristicCount} heuristic risk(s)` : '',
      ].filter(Boolean).join(' and ');
      
      const summary = `Focus visibility issues detected in ${componentCountText}. ${typeBreakdown}. ` +
        `Elements that remove the default browser outline (outline-none) without providing a visible focus replacement ` +
        `(ring, border, or shadow) may reduce keyboard accessibility.`;
      
      const a5Rule = allRules.find(r => r.id === 'A5');
      
      aggregatedA5 = {
        ruleId: 'A5',
        ruleName: 'Poor focus visibility',
        category: 'accessibility',
        overall_confidence: Math.round(overallConfidence * 100) / 100,
        confidence_reason: confidenceReason,
        summary,
        affected_items: a5AffectedItems.map(item => ({
          component_name: item.component_name,
          file_path: item.file_path,
          typeBadge: item.typeBadge,
          focus_classes: item.focus_classes,
          confidence: item.confidence,
          rationale: item.rationale,
          ...(item.occurrence_count && item.occurrence_count > 1 ? { occurrence_count: item.occurrence_count } : {}),
        })),
        diagnosis: summary,
        contextualHint: 'Interactive elements remove the default focus outline (outline-none) without a visible replacement indicator.',
        correctivePrompt: 'Add a visible focus indicator (focus ring, border change, shadow, or distinct background change) for interactive elements that remove the default outline. Do not alter layout structure or component behavior beyond focus styling.',
        confidence: Math.round(overallConfidence * 100) / 100,
      };
      
      console.log(`A5 aggregated: ${a5Violations.length} findings → ${a5AffectedItems.length} valid violations → 1 result (${confirmedCount} confirmed, ${heuristicCount} heuristic)`);
    } else {
      console.log(`A5: No valid violations found (${a5Violations.length} filtered out as PASS or NOT APPLICABLE)`);
    }
    
    // Combine all violations
    const aiViolations = [
      ...filteredOtherViolations,
      ...(aggregatedA2 ? [aggregatedA2] : []),
      ...(aggregatedA4 ? [aggregatedA4] : []),
      ...(aggregatedA5 ? [aggregatedA5] : []),
    ];

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