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
    { id: 'A2', name: 'Small body font size', diagnosis: 'Body-level text elements use font sizes below the recommended 16px minimum for primary readable content. WCAG 2.1 does not mandate a minimum font size; however, 16px is widely adopted as the baseline for body text readability.', correctivePrompt: 'Increase primary body text (paragraphs, descriptions, main content text, dialog/alert/form descriptions) to at least 16px (text-base / 1rem) across all screens and components where this body-text style is reused. Do not change badges, headings, subtitles, navigation text, metadata, timestamps, button labels, or intentional microcopy.' },
    { id: 'A3', name: 'Insufficient line spacing', diagnosis: 'Primary body text elements use line-height ratios below the recommended 1.3 minimum for readability. WCAG 1.4.12 (Text Spacing) recommends adequate line spacing to support users with cognitive or visual impairments.', correctivePrompt: 'Increase line-height of primary body text (paragraphs, descriptions, main content text) to at least 1.5 (leading-normal) across all screens and components. Do not change headings, badges, navigation text, metadata, timestamps, button labels, or intentional microcopy. Adjust paragraph spacing proportionally.' },
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

// File extensions to analyze
const ANALYZABLE_EXTENSIONS = [
  '.html', '.htm', '.jsx', '.tsx', '.js', '.ts',
  '.css', '.scss', '.sass', '.less',
  '.vue', '.svelte', '.astro'
];

// =====================
// Deterministic UI emphasis inference (static, regex-based)
// =====================
// NOTE: Used to enforce evidence extraction for U1 (competing primary actions)
// when shadcn-style components omit `variant` and rely on `defaultVariants`.

type Emphasis = 'high' | 'medium' | 'low' | 'unknown';

interface CvaVariantConfig {
  defaultVariant?: string;
  variantClassMap: Record<string, string>;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

// Regex-based cva config extraction (no AST dependency)
function extractCvaVariantConfigRegex(source: string): CvaVariantConfig | null {
  try {
    // Find cva(...) call with variants config
    const cvaMatch = source.match(/(?:const\s+\w+\s*=\s*)?cva\s*\(\s*(?:"[^"]*"|'[^']*'|`[^`]*`)\s*,\s*\{/s);
    if (!cvaMatch) return null;

    // Extract the config object (simplified extraction)
    const startIdx = source.indexOf(cvaMatch[0]) + cvaMatch[0].length - 1;
    let depth = 1;
    let endIdx = startIdx + 1;
    while (depth > 0 && endIdx < source.length) {
      if (source[endIdx] === '{') depth++;
      else if (source[endIdx] === '}') depth--;
      endIdx++;
    }
    const configStr = source.slice(startIdx, endIdx);

    // Extract variants.variant object
    const variantClassMap: Record<string, string> = {};
    const variantsMatch = configStr.match(/variants\s*:\s*\{[\s\S]*?variant\s*:\s*\{([^}]+)\}/);
    if (variantsMatch) {
      const variantBlock = variantsMatch[1];
      // Match key: "value" or key: 'value' patterns
      const kvRegex = /(\w+)\s*:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g;
      let kvMatch;
      while ((kvMatch = kvRegex.exec(variantBlock)) !== null) {
        const key = kvMatch[1];
        const value = kvMatch[2] || kvMatch[3] || kvMatch[4] || '';
        variantClassMap[key] = value;
      }
    }

    // Extract defaultVariants.variant
    let defaultVariant: string | undefined;
    const defaultVariantsMatch = configStr.match(/defaultVariants\s*:\s*\{[^}]*variant\s*:\s*(?:"([^"]+)"|'([^']+)')/);
    if (defaultVariantsMatch) {
      defaultVariant = defaultVariantsMatch[1] || defaultVariantsMatch[2];
    }

    // Fallback: infer default if not explicit
    if (!defaultVariant) {
      if (variantClassMap['default']) defaultVariant = 'default';
      else {
        const keys = Object.keys(variantClassMap);
        if (keys.length > 0) defaultVariant = keys[0];
      }
    }

    if (Object.keys(variantClassMap).length === 0) return null;

    return { defaultVariant, variantClassMap };
  } catch {
    return null;
  }
}

function looksLikeFilledClass(className: string): boolean {
  const s = className.toLowerCase();
  if (/\bbg-(primary|destructive|blue|indigo|emerald|green|red|accent)(?:-|\b)/.test(s)) return true;
  if (/\bbg-background\b/.test(s)) return false;
  if (/\bbg-/.test(s) && !/\bbg-transparent\b/.test(s)) return true;
  return false;
}

function looksLikeOutlineOrGhostClass(className: string): boolean {
  const s = className.toLowerCase();
  return /\bborder\b/.test(s) || /\bbg-transparent\b/.test(s) || /\bunderline\b/.test(s);
}

function classifyButtonEmphasis(params: {
  resolvedVariant: string | null;
  variantConfig: CvaVariantConfig | null;
  instanceClassName: string;
}): { emphasis: Emphasis; styleKey: string | null } {
  const { resolvedVariant, variantConfig, instanceClassName } = params;

  if (!resolvedVariant || !variantConfig) {
    if (!instanceClassName) return { emphasis: 'unknown', styleKey: null };
    if (looksLikeFilledClass(instanceClassName) && !looksLikeOutlineOrGhostClass(instanceClassName)) return { emphasis: 'high', styleKey: 'filled' };
    if (looksLikeOutlineOrGhostClass(instanceClassName)) return { emphasis: 'low', styleKey: 'outline' };
    return { emphasis: 'unknown', styleKey: null };
  }

  const lowVariants = new Set(['outline', 'ghost', 'link']);
  const mediumVariants = new Set(['secondary']);
  const highVariants = new Set(['default', 'primary', 'destructive']);

  const variantClasses = variantConfig.variantClassMap[resolvedVariant] || '';
  const combined = `${variantClasses} ${instanceClassName}`.trim();

  if (lowVariants.has(resolvedVariant)) return { emphasis: 'low', styleKey: resolvedVariant };
  if (mediumVariants.has(resolvedVariant)) return { emphasis: 'medium', styleKey: resolvedVariant };
  if (highVariants.has(resolvedVariant)) return { emphasis: 'high', styleKey: resolvedVariant };

  if (looksLikeFilledClass(combined) && !looksLikeOutlineOrGhostClass(combined)) return { emphasis: 'high', styleKey: resolvedVariant };
  if (looksLikeOutlineOrGhostClass(combined)) return { emphasis: 'low', styleKey: resolvedVariant };
  return { emphasis: 'unknown', styleKey: null };
}

// Regex-based JSX Button usage extraction
interface ButtonUsage {
  label: string;
  variant: string | null;
  className: string;
  hasOnClick: boolean;
}

function extractButtonUsagesFromJsx(content: string, buttonLocalNames: Set<string>): ButtonUsage[] {
  const usages: ButtonUsage[] = [];
  const tagPattern = new RegExp(
    `<(${Array.from(buttonLocalNames).join('|')}|button)\\b([^>]*)(?:>([^<]*(?:<(?!\\/(${Array.from(buttonLocalNames).join('|')}|button))[^<]*)*)<\\/\\1>|\\/>)`,
    'gi'
  );

  let match;
  while ((match = tagPattern.exec(content)) !== null) {
    const attrs = match[2] || '';
    const children = match[3] || '';

    // Extract variant prop
    const variantMatch = attrs.match(/variant\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/);
    const variant = variantMatch ? (variantMatch[1] || variantMatch[2] || variantMatch[3]) : null;

    // Extract className prop
    const classMatch = attrs.match(/className\s*=\s*(?:"([^"]+)"|'([^']+)'|\{[`"']([^`"']+)[`"']\})/);
    const className = classMatch ? (classMatch[1] || classMatch[2] || classMatch[3] || '') : '';

    // Check for onClick
    const hasOnClick = /onClick\s*=/.test(attrs);

    // Extract label from children (simplified)
    let label = children.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!label) {
      // Try to get from aria-label or title
      const ariaMatch = attrs.match(/(?:aria-label|title)\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      label = ariaMatch ? (ariaMatch[1] || ariaMatch[2] || 'Button') : 'Button';
    }

    usages.push({ label, variant, className, hasOnClick });
  }

  return usages;
}

// Extract action groups (CardFooter, flex containers with buttons)
interface ActionGroup {
  containerType: string;
  buttons: ButtonUsage[];
  lineContext: string;
}

function extractActionGroups(content: string, buttonLocalNames: Set<string>): ActionGroup[] {
  const groups: ActionGroup[] = [];
  
  // Pattern for CardFooter or div/footer containers with flex
  const containerPatterns = [
    { regex: /<CardFooter\b([^>]*)>([\s\S]*?)<\/CardFooter>/gi, type: 'CardFooter' },
    { regex: /<(?:div|footer)\b([^>]*(?:flex|gap-|space-x-)[^>]*)>([\s\S]*?)<\/(?:div|footer)>/gi, type: 'FlexContainer' },
  ];

  for (const { regex, type } of containerPatterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const containerContent = match[2] || '';
      const buttons = extractButtonUsagesFromJsx(containerContent, buttonLocalNames);
      
      if (buttons.length >= 2) {
        groups.push({
          containerType: type,
          buttons,
          lineContext: match[0].slice(0, 200),
        });
      }
    }
  }

  return groups;
}

function detectU1CompetingPrimaryActions(allFiles: Map<string, string>): {
  violation: any | null;
} {
  // 1) Find Button implementation via common shadcn import paths
  const resolveKnownButtonImpl = (): { filePath: string; config: CvaVariantConfig } | null => {
    const candidates = [
      'src/components/ui/button.tsx',
      'src/components/ui/button.ts',
      'components/ui/button.tsx',
      'components/ui/button.ts',
    ];
    for (const p of candidates) {
      const content = allFiles.get(p);
      if (!content) continue;
      const cfg = extractCvaVariantConfigRegex(content);
      if (cfg) return { filePath: p, config: cfg };
    }
    return null;
  };

  const buttonImpl = resolveKnownButtonImpl();

  // If we cannot parse Button, we must not emit U1 (safe fallback).
  if (!buttonImpl) return { violation: null };

  const findings: Array<{
    filePath: string;
    componentName: string;
    groupType: string;
    labels: string[];
    resolvedVariant: string;
  }> = [];

  for (const [filePathRaw, content] of allFiles.entries()) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx)$/.test(filePath)) continue;
    // Skip the button implementation file itself
    if (filePath.includes('components/ui/button')) continue;

    // Find Button imports
    const buttonLocalNames = new Set<string>();
    const importRegex = /import\s*\{([^}]+)\}\s*from\s*["']([^"']*components\/ui\/button[^"']*)["']/g;
    let importMatch;
    while ((importMatch = importRegex.exec(content)) !== null) {
      const imports = importMatch[1];
      // Check for Button import
      if (/\bButton\b/.test(imports)) {
        // Handle aliasing: Button as Btn
        const aliasMatch = imports.match(/Button\s+as\s+(\w+)/);
        if (aliasMatch) {
          buttonLocalNames.add(aliasMatch[1]);
        } else {
          buttonLocalNames.add('Button');
        }
      }
    }

    // Also check for generic button elements
    buttonLocalNames.add('button');

    if (buttonLocalNames.size === 0) continue;

    // Best-effort component name extraction
    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx)$/i, '') || 'UnknownComponent';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    // Extract action groups
    const actionGroups = extractActionGroups(content, buttonLocalNames);

    for (const group of actionGroups) {
      const ctas: Array<{ label: string; emphasis: Emphasis; styleKey: string | null; resolvedVariant: string | null }> = [];

      for (const btn of group.buttons) {
        // Resolve variant: if not specified, use default from buttonImpl
        const resolvedVariant = btn.variant || buttonImpl.config.defaultVariant || 'default';
        
        const classified = classifyButtonEmphasis({
          resolvedVariant,
          variantConfig: buttonImpl.config,
          instanceClassName: btn.className,
        });

        ctas.push({
          label: btn.label,
          emphasis: classified.emphasis,
          styleKey: classified.styleKey,
          resolvedVariant,
        });
      }

      // Safe fallback: if any CTA emphasis is unknown, do NOT emit U1
      if (ctas.some((c) => c.emphasis === 'unknown' || !c.styleKey)) {
        continue;
      }

      const highs = ctas.filter((c) => c.emphasis === 'high');
      if (highs.length >= 2) {
        const highStyleKeys = new Set(highs.map((h) => h.styleKey));
        // Competing primaries only if high-emphasis CTAs share the same styleKey
        if (highStyleKeys.size === 1) {
          const labels = ctas.map((c) => c.label);
          const resolvedVariant = highs[0].resolvedVariant || buttonImpl.config.defaultVariant || 'default';
          findings.push({
            filePath,
            componentName,
            groupType: group.containerType,
            labels,
            resolvedVariant,
          });
        }
      }
    }
  }

  if (findings.length === 0) return { violation: null };

  // Aggregate into ONE U1 violation per run
  const first = findings[0];
  const labelList = first.labels.slice(0, 4).join(', ');
  const u1Rule = rules.usability.find((r) => r.id === 'U1');

  const evidence = `${first.filePath} / ${first.componentName}: ${first.groupType} action group contains ${first.labels.length} sibling CTAs (${labelList}). All shadcn <Button> instances omit variant and therefore resolve to variant="${first.resolvedVariant}" (filled/high emphasis), resulting in multiple equally emphasized primary actions.`;

  const diagnosis = `In ${first.filePath} (${first.componentName}), the card action group contains multiple sibling CTAs that all resolve to the same high-emphasis filled button styling (implicit default variant). With no single visually dominant primary action, the primary action is unclear.`;

  const contextualHint = `In ${first.filePath}, make exactly one action the filled/default button and demote the other actions to outline/ghost/link or an overflow menu.`;

  return {
    violation: {
      ruleId: 'U1',
      ruleName: u1Rule?.name || 'Unclear primary action',
      category: 'usability',
      evidence,
      diagnosis,
      contextualHint,
      correctivePrompt: u1Rule?.correctivePrompt || '',
      confidence: 0.78,
    },
  };
}

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
// ZIP INPUT = HEURISTIC: Cannot confirm contrast without runtime rendering
// Per authoritative A1 rule: ZIP analysis = ALWAYS "Heuristic Potential Risk"
interface ContrastViolation {
  ruleId: string;
  ruleName: string;
  category: string;
  status: 'confirmed' | 'potential';
  samplingMethod: 'pixel' | 'inferred';
  inputType: 'zip' | 'github' | 'screenshots';
  contrastRatio?: number;
  thresholdUsed?: 4.5 | 3.0;
  foregroundHex?: string;
  backgroundHex?: string;
  elementDescription?: string;
  elementIdentifier?: string;
  evidence: string;
  diagnosis: string;
  contextualHint: string;
  correctivePrompt: string;
  confidence: number;
  riskLevel?: 'high' | 'medium' | 'low';
  potentialRiskReason?: string;
  inputLimitation?: string;
  advisoryGuidance?: string;
  reasonCodes?: string[];
  backgroundStatus?: 'certain' | 'uncertain' | 'unmeasurable';
  blocksConvergence?: boolean;
  affectedComponents?: Array<{
    colorClass: string;
    hexColor?: string;
    filePath: string;
    componentName?: string;
    elementContext?: string;
    riskLevel: 'high' | 'medium' | 'low';
    occurrence_count: number;
  }>;
}

// A1 Color risk tiers for Tailwind gray scale classes
// Higher risk = lighter colors that are more likely to fail on light backgrounds
const A1_COLOR_RISK_TIERS: Record<string, { riskLevel: 'high' | 'medium' | 'low'; baseConfidence: number }> = {
  // High risk: very light grays - almost certainly fail on white/light backgrounds
  'gray-200': { riskLevel: 'high', baseConfidence: 0.70 },
  'gray-300': { riskLevel: 'high', baseConfidence: 0.70 },
  'slate-200': { riskLevel: 'high', baseConfidence: 0.70 },
  'slate-300': { riskLevel: 'high', baseConfidence: 0.70 },
  'zinc-200': { riskLevel: 'high', baseConfidence: 0.70 },
  'zinc-300': { riskLevel: 'high', baseConfidence: 0.70 },
  // Medium risk: mid-light grays - likely to fail on white, borderline on light grays
  'gray-400': { riskLevel: 'medium', baseConfidence: 0.60 },
  'slate-400': { riskLevel: 'medium', baseConfidence: 0.60 },
  'zinc-400': { riskLevel: 'medium', baseConfidence: 0.60 },
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
    componentName?: string;
    elementContext?: string;
    riskLevel: 'high' | 'medium' | 'low';
    confidence: number;
  }> = [];
  
  for (const [filepath, content] of files) {
    const textColors = extractTextColors(content);
    
    // Try to extract component name from file
    let componentName = filepath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];
    
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
        componentName: componentName || undefined,
        elementContext: elementContext || undefined,
        riskLevel: riskTier.riskLevel,
        confidence: riskTier.baseConfidence,
      });
    }
  }
  
  if (a1Findings.length === 0) {
    return [];
  }
  
  // ========== A1 ELEMENT-LEVEL REPORTING (NO AGGREGATION) ==========
  // Per authoritative A1 rule: NEVER aggregate A1 findings into a single message.
  // For ZIP input, ALL findings are Heuristic Potential Risk with STATIC_ANALYSIS reason code.
  
  // Deduplicate by color class + file (but still report per unique occurrence)
  const dedupeMap = new Map<string, {
    colorClass: string;
    colorName: string;
    hexColor?: string;
    filePath: string;
    componentName?: string;
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
  
  // Return PER-ELEMENT A1 findings (no aggregation)
  const perElementResults: ContrastViolation[] = [];
  
  for (const component of affectedComponents) {
    const fileName = component.filePath.split('/').pop() || component.filePath;
    const elementIdentifier = component.componentName 
      ? `${component.componentName} (${fileName})`
      : fileName;
    
    // Reason codes for ZIP input - ALWAYS include STATIC_ANALYSIS
    const reasonCodes = ['STATIC_ANALYSIS'];
    
    // Build per-element diagnosis
    const diagnosis = `Text color ${component.colorClass} (${component.hexColor || 'unknown hex'}) detected in ${elementIdentifier}. ` +
      `Background color cannot be determined from static code analysis; contrast ratio cannot be computed.`;
    
    // Actionable guidance
    const actionableGuidance = 'Verify contrast with browser DevTools after rendering. ' +
      `If ratio < 4.5:1 on your background, replace ${component.colorClass} with a higher-contrast token.`;
    
    perElementResults.push({
      ruleId: 'A1',
      ruleName: 'Insufficient text contrast',
      category: 'accessibility',
      status: 'potential', // ALWAYS potential for ZIP (per authoritative rule)
      samplingMethod: 'inferred',
      inputType: 'zip',
      // Element identification
      elementIdentifier,
      elementDescription: component.elementContext,
      evidence: `${component.colorClass} in ${component.filePath}`,
      diagnosis,
      contextualHint: `Light text color (${component.colorClass}) may be insufficient on light backgrounds.`,
      correctivePrompt: '', // No mandatory corrective prompt for heuristic findings
      confidence: Math.round(component.confidence * 0.9 * 100) / 100, // Reduce 10% for static analysis
      riskLevel: component.riskLevel,
      // Reason codes (MANDATORY for potential findings)
      reasonCodes,
      potentialRiskReason: 'Static code analysis cannot access rendered pixels; colors inferred from Tailwind classes.',
      // Background status
      backgroundStatus: 'unmeasurable',
      foregroundHex: component.hexColor,
      // Input limitation
      inputLimitation: 'Static code analysis cannot determine rendered background colors.',
      advisoryGuidance: actionableGuidance,
      // Per authoritative A1 rule: Heuristic findings NEVER block convergence
      blocksConvergence: false,
      // Legacy affected_items for backwards compatibility
      affectedComponents: [{
        colorClass: component.colorClass,
        hexColor: component.hexColor,
        filePath: component.filePath,
        componentName: component.componentName,
        elementContext: component.elementContext,
        riskLevel: component.riskLevel,
        occurrence_count: component.occurrence_count,
      }],
    });
  }
  
  console.log(`A1 per-element (ZIP): ${perElementResults.length} individual findings (all potential/heuristic)`);
  
  return perElementResults;
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

### A2 (Small body font size) — CLASSIFICATION RULES:

**SCOPE:** Body-level text elements: <p>, .description, .content, .article, main text areas,
dialog descriptions, alert bodies, form descriptions, card descriptions.

**DO NOT APPLY to:** Badges, metadata, timestamps, intentional microcopy, labels, tags,
chips, status indicators, keyboard shortcuts, breadcrumbs, navigation items, button labels.

**CLASSIFICATION (Confirmed vs Potential):**

1. **CONFIRMED VIOLATION** (status: "confirmed", blocksConvergence: true):
   - Font size < 16px is EXPLICITLY defined in pixels (e.g., font-size: 14px, font-size: 12px)
   - OR mapped Tailwind class equivalent to < 16px: text-xs (12px), text-sm (14px), text-[0.75rem], text-[0.875rem]
   - AND the computed size can be deterministically resolved from the source code
   - AND the semantic role is confidently classified as primary body text
   - Confidence: 70-85%

2. **HEURISTIC / POTENTIAL RISK** (status: "potential", blocksConvergence: false):
   - Font size is defined in relative units (rem, em, %) where final computed size cannot be guaranteed
   - OR the semantic role cannot confidently be classified as primary body text
   - OR the size mapping is ambiguous (e.g., custom CSS variables, dynamic values)
   - Confidence: 45-60%
   - Display with advisory label

**SEMANTIC ROLE CLASSIFICATION:**
**PRIMARY BODY TEXT (A2 targets — must use ≥16px):**
- DialogDescription, AlertDescription, FormDescription, CardDescription
- Paragraph text, article content, main content blocks
- Description text, help text, instructional text

**EXCLUDED (DO NOT EVALUATE for A2):**
- Badge, Tag, Chip, StatusBadge, StatusIndicator
- Metadata, Timestamp, DateDisplay, TimeAgo
- Shortcut, KeyboardShortcut, Kbd
- Navigation items, button labels, icon labels
- Tooltip content, popover content
- Breadcrumb items, code/pre elements
- Caption text under images/figures

**OUTPUT FORMAT FOR A2 FINDINGS:**
\`\`\`json
{
  "ruleId": "A2",
  "ruleName": "Small body font size",
  "category": "accessibility",
  "status": "confirmed" or "potential",
  "typeBadge": "VIOLATION" or "WARNING",
  "sizeCategory": "<16px",
  "evidence": "text-sm used in DialogDescription.tsx, CardDescription.tsx",
  "diagnosis": "Body text in [components] uses [size] which is below the recommended 16px minimum for primary readable content.",
  "contextualHint": "Increase body text to at least 16px (text-base) for primary content areas.",
  "confidence": 0.75,
  "semanticRole": "body-text"
}
\`\`\`

**STRICT RULES:**
- Only report text that serves as PRIMARY BODY TEXT (not badges, metadata, timestamps, microcopy)
- text-base (16px) or larger → DO NOT report
- text-sm (14px) for body text → CONFIRMED violation if deterministically resolved
- text-xs (12px) for body text → CONFIRMED violation if deterministically resolved
- Relative units (rem/em/%) without deterministic resolution → POTENTIAL
- Frame as best-practice concern, never WCAG violation

**DO NOT:**
- Flag badges, metadata, timestamps, or microcopy
- Flag text-base or larger
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

**CRITICAL — BUTTON VARIANT RESOLUTION (shadcn/Radix - MUST FOLLOW):**
When analyzing \`<Button>\` components, you MUST resolve the visual emphasis as follows:
1. **Look up the Button component definition** (usually in \`@/components/ui/button\` or \`button.tsx\`)
2. **Check the \`defaultVariants\` in the cva/variants definition** to determine what happens when variant is omitted
3. For shadcn Button, the default is almost always \`variant: "default"\` which maps to FILLED/PRIMARY styling

**VARIANT → EMPHASIS MAPPING (standard shadcn Button):**
- NO variant prop specified → uses \`variant="default"\` → HIGH EMPHASIS (filled, bg-primary)
- \`variant="default"\` = HIGH EMPHASIS (filled button with solid background)
- \`variant="primary"\` = HIGH EMPHASIS (filled button with primary color)
- \`variant="outline"\` = LOW EMPHASIS (border only, transparent background)
- \`variant="ghost"\` = LOW EMPHASIS (no border, transparent background)
- \`variant="secondary"\` = MEDIUM EMPHASIS (muted background)
- \`variant="link"\` = LOW EMPHASIS (text link style, underline on hover)

**CRITICAL: When a Button has NO variant prop, treat it as HIGH EMPHASIS (filled/default).**
Do NOT treat missing variant as "unknown emphasis" — it is HIGH emphasis by default.

---

**ACTION GROUP DETECTION (CRITICAL - expanded container patterns):**
Treat ANY of the following as an action group for U1 detection:
1. **DialogFooter / modal footer**: Dialog action areas
2. **CardFooter / CardActions**: Card action areas at bottom of cards
3. **Footer div with flex**: \`<div className="flex..."\` containing buttons
4. **Button rows**: Sibling \`<Button>\` elements within the same parent container
5. **Action bars / toolbars**: Elements with \`actions\`, \`toolbar\`, \`action-bar\` in className
6. **Form action sections**: Form footers or button groups at end of forms
7. **Any parent with flex + gap/space-x**: Parent element containing 2+ Button children

**CTA/BUTTON RECOGNITION (expanded - avoid missing wrapped components):**
Treat ALL of the following as CTAs for U1 analysis:
- \`<Button>\`, \`<button>\`, elements with \`role="button"\`
- Custom components: \`*Button\`, \`*Action\`, \`*CTA\`, \`*Apply\`, \`*Save\`, \`*Share\`, \`*Submit\`, \`*Publish\`
- Any element with \`onClick\` handler AND button-like classes (bg-*, rounded, px-*, py-*)

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

**CASE B — Multiple equally emphasized actions (competing primaries) [CRITICAL]**

**TRIGGER CONDITION:** Emit U1 when ALL are true within ONE detected action group:
1. Two or more CTAs (>=2 is sufficient) are present in the SAME action group/container
2. Two or more CTAs are HIGH emphasis (see emphasis detection below)
3. The HIGH emphasis CTAs share the SAME emphasis level (no single dominant CTA)

**HIGH-EMPHASIS DETECTION (variant resolution - CRITICAL):**
A button is HIGH emphasis if ANY of the following:
- Has NO \`variant\` prop specified (defaults to \`variant="default"\` = filled = HIGH)
- Uses \`variant="default"\` or \`variant="primary"\` (filled/solid background)
- Uses \`bg-primary\`, \`bg-blue-*\`, \`bg-indigo-*\`, or similar filled background classes
- Appears with solid color styling (not just border)

**LOW/MEDIUM-EMPHASIS DETECTION:**
A button is LOW/MEDIUM emphasis if ANY of the following:
- Uses \`variant="outline"\`, \`variant="ghost"\`, \`variant="link"\`, \`variant="secondary"\`
- Uses \`border-*\`, \`bg-transparent\`, text-only styling

**CRITICAL FOR CASE B:**
- Does NOT require a de-emphasized action to exist
- Detection is based on observable styles, NOT inferred intent from labels
- If multiple Buttons have NO variant prop, ALL default to high emphasis → TRIGGER
- Confidence: 70-80% when 2+ filled/primary actions are detected

**FALSE POSITIVE AVOIDANCE:**
- Do NOT trigger if exactly one CTA is high-emphasis and others are outline/ghost/link
- Do NOT trigger if only one action exists in the group
- Do NOT trigger if CTAs are in different containers/regions (e.g., one in header, one in footer)

**Example evidence for CASE B (use these patterns):**
"CardFooter contains 'Save' (no variant), 'Share' (no variant), and 'Apply' (no variant). All three default to filled styling with equal visual prominence - no clear primary action."
"ButtonGroup contains 'Apply' and 'Submit'. Both buttons have no variant prop (defaulting to filled) with identical visual prominence."
"Form footer contains 'Save Draft', 'Submit', 'Publish' buttons. All three use default variant (filled) with equal visual prominence."
"CardActions area shows Save, Share, Apply buttons. All appear as filled buttons with no clear visual hierarchy."

**Output wording for CASE B:**
- Describe as "multiple equally emphasized actions" or "no clear primary action among high-emphasis buttons"
- List affected components/files (e.g., ProposalCard.tsx / CardFooter, SettingsForm / actions)
- Do NOT mention secondary actions being weaker (since none are in Case B)

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
- DO NOT claim "equal emphasis" unless BOTH buttons' variants are explicitly the SAME value OR both have no variant (both default to filled)

---

**OUTPUT FORMAT (when evidence is complete):**
\`\`\`json
{
  "ruleId": "U1",
  "ruleName": "Unclear primary action",
  "category": "usability",
  "caseType": "A" | "B" | "C" | "D",
  "evidence": "[Specific observed evidence for the triggered case - mention container, buttons, variants]",
  "primaryAction": "[Button label and variant]",
  "secondaryAction": "[Button label and variant]" (if applicable),
  "stylingComparison": "[Explicit comparison of visual treatments]",
  "affectedContainer": "[CardFooter | DialogFooter | ButtonGroup | form actions | etc.]",
  "diagnosis": "Users may struggle to identify the main action because [evidence-based reason]. [Explain visual hierarchy failure].",
  "contextualHint": "In [component/file], make '[primary action label]' the filled/default button and demote '[other actions]' to outline/ghost variant.",
  "confidence": 0.65-0.80
}
\`\`\`

---

**PASS-SILENCE POLICY — ABSOLUTE:**
U1 must produce output ONLY when a violation is detected. All other cases must be SILENT.

**EXPLICIT PASS CASES (DO NOT OUTPUT ANYTHING):**
1. **Single action present**: Only one button/action exists in an action group → PASS (no output)
2. **Utility action alone**: A single utility action (Clear, Reset, Refresh, Filter, Cancel) without competing actions → PASS (no output)
3. **Clear hierarchy exists**: Primary action is variant="default"/filled AND secondary actions are outline/ghost → PASS (no output)
4. **One dominant action**: Multiple actions exist but exactly one uses variant="default"/filled → PASS (no output)
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

    // IMPORTANT: Keep AI context small, but keep a larger static-analysis map for import/style resolution.
    const files = new Map<string, string>(); // AI + existing heuristics (bounded)
    const allFiles = new Map<string, string>(); // deterministic static checks (larger)
    let totalSize = 0;
    let totalStaticSize = 0;
    const maxContentSize = 100000; // 100KB limit for AI context
    const maxStaticContentSize = 750000; // 750KB cap for deterministic analyzers (import graph, style lookup)

    for (const entry of entries) {
      if (entry.directory || !isAnalyzableFile(entry.filename)) continue;
      
      try {
        const content = await entry.getData!(new TextWriter());
        if (!content) continue;

        // Always try to retain a broader set for static analysis first
        if (totalStaticSize + content.length < maxStaticContentSize) {
          allFiles.set(normalizePath(entry.filename), content);
          totalStaticSize += content.length;
        }

        // Keep a smaller subset for AI context
        if (totalSize + content.length < maxContentSize) {
          files.set(entry.filename, content);
          totalSize += content.length;
        }
      } catch (e) {
        console.warn(`Failed to read ${entry.filename}:`, e);
      }
    }

    await zipReader.close();

    if (files.size === 0 && allFiles.size === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No analyzable files found in ZIP (HTML, CSS, JS, JSX, TSX, etc.)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Extracted ${files.size} files for AI context and ${allFiles.size} files for static analysis`);
    const stack = detectStack(files.size > 0 ? files : allFiles);
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

    // Check if response was truncated due to token limits
    if (finishReason === 'length') {
      console.warn("AI response was truncated due to token limits, attempting to salvage partial response");
    }

    // Parse AI response with improved error handling for truncated responses
    let analysisResult;
    try {
      // Try to extract JSON from markdown code block first
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      let jsonStr = jsonMatch ? jsonMatch[1] : content;
      
      // Clean up the JSON string
      jsonStr = jsonStr.trim();
      
      // If response appears truncated (ends mid-string or mid-object), try to repair
      if (!jsonStr.endsWith('}') && !jsonStr.endsWith(']')) {
        console.warn("JSON appears truncated, attempting repair...");
        
        // Count open brackets to determine what needs closing
        const openBraces = (jsonStr.match(/{/g) || []).length;
        const closeBraces = (jsonStr.match(/}/g) || []).length;
        const openBrackets = (jsonStr.match(/\[/g) || []).length;
        const closeBrackets = (jsonStr.match(/\]/g) || []).length;
        
        // Find last complete object in violations array
        const lastCompleteMatch = jsonStr.match(/([\s\S]*"contextualHint"\s*:\s*"[^"]*"[^}]*})/);
        if (lastCompleteMatch) {
          jsonStr = lastCompleteMatch[1];
          // Close any remaining open structures
          const remainingBraces = openBraces - (jsonStr.match(/}/g) || []).length;
          const remainingBrackets = openBrackets - (jsonStr.match(/\]/g) || []).length;
          
          // Close violations array if needed
          if (remainingBrackets > 0) {
            jsonStr += ']';
          }
          // Add empty passNotes and close root object
          if (!jsonStr.includes('"passNotes"')) {
            jsonStr += ', "passNotes": {}';
          }
          if (remainingBraces > 0) {
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
    
    // Separate A2, A3, A4, and A5 violations for aggregation (only from selected rules)
    const a2Violations: any[] = [];
    const a3Violations: any[] = [];
    const a4Violations: any[] = [];
    const a5Violations: any[] = [];
    const otherViolations: any[] = [];
    
    filteredBySelection.forEach((v: any) => {
      if (v.ruleId === 'A2') {
        a2Violations.push(v);
      } else if (v.ruleId === 'A3') {
        a3Violations.push(v);
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
      const statesCorrectHierarchy = /primary\s+(?:is|uses?|has)\s+(?:variant=['"]?default|filled|solid)|(?:submit|confirm|save).*(?:variant=['"]?default|filled).*(?:cancel|dismiss).*(?:variant=['"]?(?:outline|ghost)|outline|ghost)|clear\s+(?:visual\s+)?hierarchy|(?:filled|default)\s+primary.*(?:outlined?|ghost)\s+secondary/.test(combined);
      if (statesCorrectHierarchy && !/equal|competing|same|identical|no.*clear|multiple.*(?:default|filled)/.test(combined)) {
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
      
      // ========== CASE B: Multiple equally emphasized actions (competing primaries) ==========
      // Expanded to detect competing primaries in Card footers, action bars, button groups
      // Key patterns: "no variant" (defaults to filled), multiple action labels (save/share/apply), CardFooter context
      // CRITICAL: When buttons omit variant prop, they default to variant="default" which is FILLED/HIGH emphasis
      const isCaseB = caseType === 'B' || 
        /(?:two|2|multiple|both|all).*(?:filled|primary|default|high.*emphasis)/.test(combined) ||
        /competing.*(?:primary|action)/.test(combined) ||
        /all.*(?:filled|default|prominent)/.test(combined) ||
        /no.*(?:clear|single).*(?:primary|dominant|hierarchy)/.test(combined) ||
        /equally.*(?:emphasized|prominent)/.test(combined) ||
        /same.*(?:emphasis|prominence|styling|visual)/.test(combined) ||
        /multiple.*equally/.test(combined) ||
        /identical.*(?:styling|visual|weight|prominence)/.test(combined) ||
        // No variant = defaults to filled (high emphasis) - CRITICAL for shadcn Button detection
        /(?:no\s+variant|without\s+variant|omit\w*\s+variant|missing\s+variant)/.test(combined) ||
        /default(?:s|ing)?.*(?:to\s+)?(?:filled|variant\s*=\s*["']?default)/.test(combined) ||
        /variant\s+(?:is\s+)?(?:not\s+)?(?:specified|set|defined|explicit)/.test(combined) ||
        // Multiple buttons without explicit variant
        /buttons?\s+(?:have|has|with|without)\s+no\s+(?:explicit\s+)?variant/.test(combined) ||
        // All buttons default to high emphasis
        /all\s+(?:three|two|2|3|\d+)?\s*(?:buttons?|ctas?)\s+(?:default|use|have)/.test(combined) ||
        // Card/footer context with action labels
        /(?:card|footer|cardfooter|cardactions|action\s*(?:bar|area|group)).*(?:save|share|apply|submit|publish)/.test(combined) ||
        // Multiple action labels together (save/share/apply pattern)
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
        
        // Evidence for high emphasis: filled/default/primary styling OR no variant specified (defaults to high emphasis)
        // CRITICAL: "no variant" pattern means buttons default to filled = high emphasis
        // For shadcn Button: omitting variant prop = variant="default" = filled button (bg-primary)
        const hasMultipleHighEmphasis = 
          // Explicit multiple high-emphasis mentions
          /(?:both|two|2|all|multiple|three|3).*(?:filled|default|primary|solid|bg-primary|high.*emphasis)/.test(combined) ||
          // Multiple filled/default patterns
          /(?:filled|default|primary).*(?:and|,|\/)\s*(?:filled|default|primary)/.test(combined) ||
          // No clear/single primary
          /no.*(?:single|clear).*(?:dominant|primary|hierarchy)/.test(combined) ||
          // Equal emphasis
          /equally.*(?:emphasized|prominent|styled|weighted)/.test(combined) ||
          /same.*(?:emphasis|prominence|styling|visual|weight)/.test(combined) ||
          /multiple.*equally/.test(combined) ||
          // CRITICAL: No variant = all default to high emphasis (shadcn Button detection)
          /(?:no\s+variant|without\s+variant|omit\w*\s+variant|missing\s+variant)/.test(combined) ||
          /variant\s+(?:is\s+)?(?:not\s+)?(?:specified|set|defined|explicit)/.test(combined) ||
          /default(?:s|ing)?.*(?:to\s+)?(?:filled|high|variant\s*=)/.test(combined) ||
          // All buttons use default/filled styling
          /all\s+(?:three|two|2|3|\d+)?\s*(?:buttons?|ctas?|actions?)/.test(combined) ||
          /(?:buttons?|ctas?)\s+(?:all\s+)?(?:default|use\s+default|have\s+no)/.test(combined) ||
          // Identical styling
          /identical.*(?:styling|visual|weight|prominence)/.test(combined) ||
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
    
    // Process non-A2/A3/A4/A5/U1 violations
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
      
      // ============================================================
      // A2 STRICT SCOPE ENFORCEMENT: ONLY primary body text allowed
      // ============================================================
      // Exclude: badges, chips, pills, tags, status indicators
      const isBadgeChip = /\bbadge\b|\bchip\b|\bpill\b|\btag\b|\bstatus\s*(?:indicator|badge|chip|text)?\b|\bStatusBadge\b/i.test(combined);
      if (isBadgeChip) {
        console.log(`Filtering out A2 (badge/chip/tag — not body text): ${v.evidence}`);
        continue;
      }
      
      // Exclude: headings, titles, subtitles, headers
      const isHeadingTitle = /\bheading\b|\btitle\b|\bsubtitle\b|\bh[1-6]\b|\bsection\s*title\b|\bpage\s*title\b|\bheader\s*(?:text|subtitle|label)?\b/i.test(combined);
      // But allow if explicitly about description/body text inside a header component
      if (isHeadingTitle && !/description|body\s*text|paragraph|content\s*block|prose/i.test(combined)) {
        console.log(`Filtering out A2 (heading/title — not body text): ${v.evidence}`);
        continue;
      }
      
      // Exclude: navigation, menu items, breadcrumbs
      const isNavigation = /\bnavigation\b|\bnav[-\s]|\bmenu\s*item\b|\bbreadcrumb\b|\btab\s*label\b|\bsidebar\s*(?:link|item|nav)\b/i.test(combined);
      if (isNavigation) {
        console.log(`Filtering out A2 (navigation — not body text): ${v.evidence}`);
        continue;
      }
      
      // Exclude: buttons, CTAs, interactive elements
      const isButton = /\bbutton\b|\bbtn\b|\bcta\b|\baction\s*button\b|\binteractive\s*element\b|\blink\s*(?:text|label)?\b|\bicon[-\s]?button\b/i.test(combined);
      if (isButton && !/description|body\s*text|paragraph/i.test(combined)) {
        console.log(`Filtering out A2 (button/CTA — not body text): ${v.evidence}`);
        continue;
      }
      
      // Exclude: metadata, timestamps, dates, author names, tags
      const isMetadata = /\bmetadata\b|\btimestamp\b|\bdate\s*(?:display|text)?\b|\btime\s*ago\b|\bauthor\b|\binstructor\b|\bcreated\s*(?:at|on)\b|\bupdated\s*(?:at|on)\b/i.test(combined);
      if (isMetadata) {
        console.log(`Filtering out A2 (metadata/timestamp — not body text): ${v.evidence}`);
        continue;
      }
      
      // Exclude: captions, tooltips, keyboard shortcuts, code blocks
      const isMicrocopy = /\bcaption\b|\btooltip\b|\bkeyboard\s*shortcut\b|\bkbd\b|\bcode\s*block\b|\bmonospace\b|\bhelper\s*(?:text|microcopy)?\b|\bplaceholder\b/i.test(combined);
      // Allow "helper text" only if it's clearly a form description (body-level)
      if (isMicrocopy && !/FormDescription|form\s*description|AlertDescription|DialogDescription/i.test(combined)) {
        console.log(`Filtering out A2 (microcopy/caption — not body text): ${v.evidence}`);
        continue;
      }
      
      // Exclude: icon-only elements
      const isIconOnly = /\bicon\b/i.test(combined) && !/description|paragraph|body/i.test(combined);
      if (isIconOnly) {
        console.log(`Filtering out A2 (icon element — not body text): ${v.evidence}`);
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
      
      // ── A2 PRIMARY vs SECONDARY classification (deterministic ZIP) ──
      // Secondary UI text is ALWAYS suppressed — no A2 finding at all.
      const nameAndEvidence = (componentName + ' ' + combined).toLowerCase();
      
      // 1) Component name signals secondary
      if (/\b(badge|chip|tag|label|subtitle|meta|caption)\b/i.test(componentName)) {
        console.log(`Filtering out A2 (secondary component name "${componentName}"): ${filePath}`);
        continue;
      }
      // 2) Course codes (CS101, EE202, etc.)
      if (/[A-Z]{2,4}\d{2,4}/.test(v.evidence || '') || /course\s*code/i.test(nameAndEvidence)) {
        console.log(`Filtering out A2 (course code pattern): ${componentName || filePath}`);
        continue;
      }
      // 3) Credits / badge text ("3 credits", "4 credits")
      if (/\d+\s*credits?\b/i.test(nameAndEvidence) || /\bcredits?\s*(?:badge|pill|chip)?\b/i.test(nameAndEvidence)) {
        console.log(`Filtering out A2 (credits/badge text): ${componentName || filePath}`);
        continue;
      }
      // 4) Header subtitles, navigation labels, filter labels
      if (/\b(header\s*subtitle|nav(?:igation)?\s*label|filter\s*label|tab\s*label|breadcrumb)\b/i.test(nameAndEvidence)) {
        console.log(`Filtering out A2 (header subtitle / nav / filter label): ${componentName || filePath}`);
        continue;
      }
      // 5) Short labels (< 25 chars) that aren't paragraphs/descriptions
      const snippetText = (v.textSnippet || v.evidence || '').replace(/[^a-zA-Z0-9\s]/g, '').trim();
      if (snippetText.length > 0 && snippetText.length < 25 && !/paragraph|description|content|prose|body|article/i.test(nameAndEvidence)) {
        console.log(`Filtering out A2 (short label <25 chars, not primary): ${componentName || filePath} "${snippetText}"`);
        continue;
      }
      // 6) Final primary-content gate: must match primary readable content signals
      const isPrimary = /description|paragraph|prose|content|body|article|main|alert|dialog|form/i.test(nameAndEvidence)
        || (snippetText.length >= 60)
        || /\.\s+[A-Z]/.test(v.evidence || ''); // multi-sentence indicator
      if (!isPrimary) {
        console.log(`Filtering out A2 (not primary readable content): ${componentName || filePath}`);
        continue;
      }
      
      const semanticRole = 'informational';
      
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
      
      // Determine A2 status: Confirmed if deterministic pixel/Tailwind sizes, Potential otherwise
      const hasConfirmedItems = affectedItems.some(i => i.severity === 'violation');
      const a2Status = hasConfirmedItems ? 'confirmed' : 'potential';
      
      // Build a2Elements array for the aggregated card UI
      const a2Elements = affectedItems.map((item, idx) => {
        const computedSize = parseFloat((item.approx_px || '').replace(/[≈~px]/g, ''));
        const isDeterministic = a2Status === 'confirmed' && !isNaN(computedSize);
        return {
          elementLabel: item.component_name || `Body text element ${idx + 1}`,
          textSnippet: undefined,
          location: item.file_path || 'Unknown file',
          computedFontSize: isDeterministic ? computedSize : undefined,
          fontSizeSource: item.size_token ? `Tailwind/CSS: ${item.size_token}` : undefined,
          detectionMethod: isDeterministic ? 'deterministic' as const : 'heuristic' as const,
          thresholdPx: 16,
          explanation: item.rationale,
          confidence: item.confidence,
          correctivePrompt: isDeterministic
            ? `body text '${(item.component_name || 'Body text element').substring(0, 60)}' (${item.file_path || 'Source file'})\n\nIssue reason: Computed font-size ${item.approx_px} is below the recommended readability baseline of 16px.\n\nRecommended fix: Increase the font size of all primary body text elements in this group (currently ${item.approx_px}${item.size_token ? ` / ${item.size_token}` : ''}) to at least 16px (text-base). Ensure this update is applied consistently across all screens and components where this text style is reused. Adjust line-height to approximately 1.4–1.6 to preserve readability.`
            : undefined,
          deduplicationKey: `${item.file_path}|${item.component_name}|${item.size_token}`,
        };
      });

      aggregatedA2 = {
        ruleId: 'A2',
        ruleName: 'Small body font size',
        category: 'accessibility',
        status: a2Status,
        blocksConvergence: a2Status === 'confirmed',
        inputType: 'zip',
        isA2Aggregated: true,
        a2Elements,
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
        diagnosis: a2Status === 'confirmed'
          ? `${a2Elements.length} body text element${a2Elements.length !== 1 ? 's' : ''} with confirmed insufficient font size detected.`
          : `${a2Elements.length} text element${a2Elements.length !== 1 ? 's' : ''} with potential font size issues detected. These require manual verification due to measurement uncertainty.`,
        contextualHint: 'Increase body text to at least 16px (text-base) for primary content areas.',
        correctivePrompt: a2Rule?.correctivePrompt || '',
        confidence: Math.round(overallConfidence * 100) / 100,
        ...(a2Status === 'potential' ? {
          advisoryGuidance: 'Static visual estimation cannot determine exact computed font sizes. For deterministic measurement, upload the rendered source code (ZIP file) or provide a GitHub repository.',
        } : {}),
      };
      
      console.log(`A2 aggregated: ${affectedItems.length} items → 1 result (${violationCount} violations, ${warningCount} warnings)`);
    }
    
    // ========== A3 AGGREGATION LOGIC (ZIP — Deterministic) ==========
    // Tailwind leading-* mappings to line-height ratios
    const TAILWIND_LEADING: Record<string, number> = {
      'leading-none': 1.0, 'leading-tight': 1.25, 'leading-snug': 1.375,
      'leading-normal': 1.5, 'leading-relaxed': 1.625, 'leading-loose': 2.0,
      'leading-3': 0.75, 'leading-4': 1.0, 'leading-5': 1.25, 'leading-6': 1.5,
      'leading-7': 1.75, 'leading-8': 2.0, 'leading-9': 2.25, 'leading-10': 2.5,
    };
    
    interface A3AffectedItem {
      component_name: string;
      file_path: string;
      line_height_token: string;
      line_height_ratio: number;
      font_size_px?: number;
      semantic_role: string;
      severity: 'violation' | 'warning';
      confidence: number;
      rationale: string;
      occurrence_count?: number;
    }
    
    const a3DedupeMap = new Map<string, A3AffectedItem>();
    
    for (const v of a3Violations) {
      const evidence = (v.evidence || '').toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidence + ' ' + diagnosis;
      
      // ============================================================
      // A3 STRICT SCOPE ENFORCEMENT: ONLY primary body text allowed
      // Same filters as A2
      // ============================================================
      const isBadgeChip = /\bbadge\b|\bchip\b|\bpill\b|\btag\b|\bstatus\s*(?:indicator|badge|chip|text)?\b/i.test(combined);
      if (isBadgeChip) { console.log(`Filtering out A3 (badge/chip): ${v.evidence}`); continue; }
      
      const isHeadingTitle = /\bheading\b|\btitle\b|\bsubtitle\b|\bh[1-6]\b|\bsection\s*title\b|\bpage\s*title\b|\bheader\s*(?:text|subtitle|label)?\b/i.test(combined);
      if (isHeadingTitle && !/description|body\s*text|paragraph|content\s*block|prose/i.test(combined)) {
        console.log(`Filtering out A3 (heading/title): ${v.evidence}`); continue;
      }
      
      const isNavigation = /\bnavigation\b|\bnav[-\s]|\bmenu\s*item\b|\bbreadcrumb\b|\btab\s*label\b/i.test(combined);
      if (isNavigation) { console.log(`Filtering out A3 (navigation): ${v.evidence}`); continue; }
      
      const isButton = /\bbutton\b|\bbtn\b|\bcta\b|\baction\s*button\b|\bicon[-\s]?button\b/i.test(combined);
      if (isButton && !/description|body\s*text|paragraph/i.test(combined)) {
        console.log(`Filtering out A3 (button): ${v.evidence}`); continue;
      }
      
      const isMetadata = /\bmetadata\b|\btimestamp\b|\bdate\s*(?:display|text)?\b|\bauthor\b|\binstructor\b/i.test(combined);
      if (isMetadata) { console.log(`Filtering out A3 (metadata): ${v.evidence}`); continue; }
      
      const isMicrocopy = /\bcaption\b|\btooltip\b|\bkeyboard\s*shortcut\b|\bkbd\b|\bcode\s*block\b|\bmonospace\b|\bplaceholder\b/i.test(combined);
      if (isMicrocopy && !/FormDescription|form\s*description|AlertDescription|DialogDescription/i.test(combined)) {
        console.log(`Filtering out A3 (microcopy): ${v.evidence}`); continue;
      }
      
      // Extract line-height info
      const leadingMatch = combined.match(/leading-(none|tight|snug|normal|relaxed|loose|\d+)/);
      const lineHeightCssMatch = combined.match(/line-height:\s*([\d.]+)/);
      const ratioMatch = combined.match(/(?:ratio|line[- ]height)[:\s]*([\d.]+)/);
      
      let lineHeightRatio: number | undefined;
      let lineHeightToken = '';
      
      if (leadingMatch) {
        const key = `leading-${leadingMatch[1]}`;
        lineHeightRatio = TAILWIND_LEADING[key];
        lineHeightToken = key;
      } else if (lineHeightCssMatch) {
        lineHeightRatio = parseFloat(lineHeightCssMatch[1]);
        lineHeightToken = `line-height: ${lineHeightCssMatch[1]}`;
      } else if (ratioMatch) {
        lineHeightRatio = parseFloat(ratioMatch[1]);
        lineHeightToken = `ratio ${ratioMatch[1]}`;
      }
      
      if (!lineHeightRatio || isNaN(lineHeightRatio)) {
        // Try to infer from diagnosis mentioning specific values
        const anyNumberMatch = combined.match(/(\d+\.?\d*)\s*(?:line[- ]?height|leading|ratio)/);
        if (anyNumberMatch) {
          lineHeightRatio = parseFloat(anyNumberMatch[1]);
          lineHeightToken = `inferred: ${anyNumberMatch[1]}`;
        } else {
          // Cannot determine line-height, skip
          console.log(`Filtering out A3 (no line-height data): ${v.evidence}`);
          continue;
        }
      }
      
      // Classification based on ratio
      // < 1.3 → confirmed violation, 1.3-1.45 → potential warning, >= 1.45 → pass
      if (lineHeightRatio >= 1.45) {
        console.log(`Filtering out A3 (ratio ${lineHeightRatio} >= 1.45, pass): ${v.evidence}`);
        continue;
      }
      
      const severity: 'violation' | 'warning' = lineHeightRatio < 1.3 ? 'violation' : 'warning';
      
      // Extract component info
      const componentMatch = (v.evidence || '').match(/([A-Z][a-zA-Z0-9]*(?:Description|Content|Text|Label)?)/);
      const fileMatch = (v.evidence || v.contextualHint || '').match(/([a-zA-Z0-9_-]+\.(?:tsx|jsx|ts|js))/i);
      const componentName = componentMatch?.[1] || fileMatch?.[1]?.replace(/\.\w+$/, '') || '';
      const filePath = fileMatch?.[1] || v.contextualHint || 'Unknown file';
      
      // Extract font-size if mentioned
      const fontSizeMatch = combined.match(/(?:font[- ]?size|text-)\s*:?\s*(\d+)px/);
      const fontSizePx = fontSizeMatch ? parseInt(fontSizeMatch[1]) : undefined;
      
      let confidence = v.confidence || 0.85;
      if (severity === 'violation') confidence = Math.min(confidence + 0.05, 0.95);
      
      const rationale = v.diagnosis || `Computed line-height ratio ${lineHeightRatio.toFixed(2)} is below the recommended readability baseline of ${severity === 'violation' ? '1.3' : '1.45'}.`;
      
      const dedupeKey = `${filePath}|${componentName}|${lineHeightToken}`;
      
      if (a3DedupeMap.has(dedupeKey)) {
        const existing = a3DedupeMap.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        if (confidence > existing.confidence) existing.confidence = confidence;
      } else {
        a3DedupeMap.set(dedupeKey, {
          component_name: componentName,
          file_path: filePath,
          line_height_token: lineHeightToken,
          line_height_ratio: lineHeightRatio,
          font_size_px: fontSizePx,
          semantic_role: 'informational',
          severity,
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
        });
      }
    }
    
    const a3AffectedItems = Array.from(a3DedupeMap.values());
    
    let aggregatedA3: any = null;
    if (a3AffectedItems.length > 0) {
      const hasConfirmedItems = a3AffectedItems.some(i => i.severity === 'violation');
      const a3Status = hasConfirmedItems ? 'confirmed' : 'potential';
      
      const overallConfidence = Math.max(...a3AffectedItems.map(i => i.confidence));
      
      const a3Rule = allRules.find(r => r.id === 'A3');
      
      const a3Elements = a3AffectedItems.map((item, idx) => {
        const isDeterministic = a3Status === 'confirmed' && item.severity === 'violation';
        return {
          elementLabel: item.component_name || `Body text element ${idx + 1}`,
          textSnippet: undefined,
          location: item.file_path || 'Unknown file',
          computedLineHeight: isDeterministic ? item.line_height_ratio : undefined,
          estimatedLineHeight: !isDeterministic ? item.line_height_ratio : undefined,
          computedFontSize: item.font_size_px,
          lineHeightSource: item.line_height_token ? `Tailwind/CSS: ${item.line_height_token}` : undefined,
          detectionMethod: isDeterministic ? 'deterministic' as const : 'heuristic' as const,
          thresholdRatio: 1.3,
          explanation: item.rationale,
          confidence: item.confidence,
          correctivePrompt: isDeterministic
            ? `body text '${(item.component_name || 'Body text element').substring(0, 60)}' (${item.file_path || 'Source file'})\n\nIssue reason: Computed line-height ratio ${item.line_height_ratio.toFixed(2)} is below the recommended readability baseline of 1.3.\n\nRecommended fix: Increase the line-height of all primary body text elements in this group (currently ${item.line_height_token || item.line_height_ratio}) to at least 1.5 (leading-normal). Ensure this update is applied consistently across all screens and components where this text style is reused.`
            : undefined,
          deduplicationKey: `${item.file_path}|${item.component_name}|${item.line_height_token}`,
        };
      });
      
      aggregatedA3 = {
        ruleId: 'A3',
        ruleName: 'Insufficient line spacing',
        category: 'accessibility',
        status: a3Status,
        blocksConvergence: a3Status === 'confirmed',
        inputType: 'zip',
        isA3Aggregated: true,
        a3Elements,
        diagnosis: a3Status === 'confirmed'
          ? `${a3Elements.length} body text element${a3Elements.length !== 1 ? 's' : ''} with confirmed insufficient line spacing detected.`
          : `${a3Elements.length} text element${a3Elements.length !== 1 ? 's' : ''} with potential line spacing issues detected. These require manual verification.`,
        contextualHint: 'Increase line-height to at least 1.5 (leading-normal) for primary body text.',
        correctivePrompt: a3Rule?.correctivePrompt || '',
        confidence: Math.round(overallConfidence * 100) / 100,
        ...(a3Status === 'potential' ? {
          advisoryGuidance: 'Static analysis cannot fully resolve CSS cascade for line-height. For deterministic measurement, verify with browser DevTools after rendering.',
        } : {}),
      };
      
      console.log(`A3 aggregated: ${a3AffectedItems.length} items → 1 result (${a3Status})`);
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
    let aiViolations = [
      ...filteredOtherViolations,
      ...(aggregatedA2 ? [aggregatedA2] : []),
      ...(aggregatedA3 ? [aggregatedA3] : []),
      ...(aggregatedA4 ? [aggregatedA4] : []),
      ...(aggregatedA5 ? [aggregatedA5] : []),
    ];

    // ========== Deterministic U1 (competing primary actions) ==========
    // Enforce import-resolution + default-variant inference for shadcn Button.
    // Safe fallback: if Button implementation cannot be found/parsed, do not emit U1.
    if (selectedRulesSet.has('U1')) {
      const deterministic = detectU1CompetingPrimaryActions(allFiles);
      if (deterministic.violation) {
        // Ensure exactly one aggregated U1 per run
        aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'U1');
        aiViolations.push(deterministic.violation);
        console.log(`Deterministic U1 added: ${deterministic.violation.evidence?.substring(0, 140)}`);
      }
    }

    // ========== A1 AGGREGATION LOGIC (v22) ==========
    // Aggregate per-element A1 findings into at most 2 cards:
    // - One for Confirmed (Blocking) findings - N/A for ZIP, all are potential
    // - One for Potential (Non-blocking) findings
    // Each card contains element sub-items with full details.
    // Deduplication by (filePath + colorClass)
    
    const confirmedA1Elements = contrastViolations.filter((v: any) => v.status === 'confirmed');
    const potentialA1Elements = contrastViolations.filter((v: any) => v.status === 'potential');
    
    // Helper to build A1ElementSubItem from raw violation
    const buildA1SubItem = (v: any): any => {
      const dedupeKey = `${v.evidence || ''}-${v.foregroundHex || ''}`.toLowerCase().replace(/\s+/g, '');
      
      return {
        elementLabel: v.elementDescription || v.elementIdentifier || 'Text element',
        textSnippet: undefined,
        location: v.evidence || v.elementIdentifier || 'Unknown location',
        foregroundHex: v.foregroundHex,
        foregroundConfidence: v.confidence,
        backgroundStatus: v.backgroundStatus || 'unmeasurable',
        backgroundHex: v.backgroundHex,
        backgroundCandidates: undefined,
        contrastRatio: v.contrastRatio,
        contrastRange: undefined,
        contrastNotMeasurable: v.backgroundStatus === 'unmeasurable',
        thresholdUsed: v.thresholdUsed || 4.5,
        explanation: v.diagnosis,
        reasonCodes: v.reasonCodes || ['STATIC_ANALYSIS'],
        nearThreshold: false,
        deduplicationKey: dedupeKey,
      };
    };
    
    // Deduplicate elements by key
    const deduplicateElements = (elements: any[]): any[] => {
      const seen = new Map<string, any>();
      for (const el of elements) {
        const key = el.deduplicationKey;
        if (seen.has(key)) {
          const existing = seen.get(key);
          if (el.reasonCodes) {
            existing.reasonCodes = [...new Set([...(existing.reasonCodes || []), ...el.reasonCodes])];
          }
        } else {
          seen.set(key, el);
        }
      }
      return Array.from(seen.values());
    };
    
    const aggregatedA1Violations: any[] = [];
    
    // For ZIP: All findings are potential (no confirmed)
    if (potentialA1Elements.length > 0) {
      const elements = deduplicateElements(potentialA1Elements.map(buildA1SubItem));
      const avgConfidence = potentialA1Elements.reduce((sum: number, v: any) => sum + (v.confidence || 0.55), 0) / potentialA1Elements.length;
      
      // Collect all unique reason codes across elements
      const allReasonCodes = new Set<string>(['STATIC_ANALYSIS']);
      for (const el of elements) {
        if (el.reasonCodes) {
          for (const code of el.reasonCodes) {
            allReasonCodes.add(code);
          }
        }
      }
      
      aggregatedA1Violations.push({
        ruleId: 'A1',
        ruleName: 'Insufficient text contrast',
        category: 'accessibility',
        status: 'potential',
        isA1Aggregated: true,
        a1Elements: elements,
        diagnosis: `${elements.length} text element${elements.length !== 1 ? 's' : ''} with potential contrast issues detected via static code analysis. Background colors cannot be determined without runtime rendering.`,
        correctivePrompt: 'Verify text contrast meets WCAG AA requirements (4.5:1 for normal text, 3:1 for large text) using browser DevTools after rendering.',
        contextualHint: 'Verify contrast with browser DevTools or accessibility testing tools after rendering.',
        confidence: Math.round(avgConfidence * 100) / 100,
        reasonCodes: Array.from(allReasonCodes),
        potentialRiskReason: Array.from(allReasonCodes).join(', '),
        advisoryGuidance: 'Upload screenshots of the rendered UI for higher-confidence verification.',
        blocksConvergence: false,
        inputType: 'zip',
        samplingMethod: 'inferred',
      });
      
      console.log(`A1 aggregated (ZIP): ${potentialA1Elements.length} potential elements → 1 Potential card (${elements.length} unique)`);
    }
    
    // Merge aggregated A1 with AI violations (no raw contrast violations)
    const allViolations = [...aggregatedA1Violations, ...aiViolations];

    console.log(`Code analysis complete: ${allViolations.length} violations found`);

    return new Response(
      JSON.stringify({
        success: true,
        violations: allViolations,
        passNotes: analysisResult.passNotes || {},
        filesAnalyzed: files.size > 0 ? files.size : allFiles.size,
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