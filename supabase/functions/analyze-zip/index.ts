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
    { id: 'A2', name: 'Poor focus visibility', diagnosis: 'Lack of visible focus reduces keyboard accessibility.', correctivePrompt: 'Ensure all interactive elements have clearly visible focus states.' },
    { id: 'A3', name: 'Incomplete keyboard operability', diagnosis: 'Interactive elements not fully operable via keyboard.', correctivePrompt: 'Ensure all interactive elements are keyboard accessible using native elements or ARIA + key handlers.' },
    { id: 'A4', name: 'Missing semantic structure', diagnosis: 'Page lacks proper semantic HTML structure (headings, landmarks, lists, interactive roles).', correctivePrompt: 'Use semantic HTML elements to represent page hierarchy and structure.' },
    { id: 'A5', name: 'Missing form labels (Input clarity)', diagnosis: 'Form controls lack programmatic labels, reducing accessibility.', correctivePrompt: 'Add visible <label> elements associated with form controls, or provide accessible names via aria-label/aria-labelledby.' },
    { id: 'A6', name: 'Missing accessible names (Name, Role, Value)', diagnosis: 'Interactive elements lack programmatic accessible names (WCAG 4.1.2).', correctivePrompt: 'Add visible text content, aria-label, or aria-labelledby to interactive elements.' },
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

// =====================
// U1 Primary Action Detection (sub-checks U1.1, U1.2, U1.3)
// =====================

interface U1Finding {
  subCheck: 'U1.1' | 'U1.2' | 'U1.3';
  subCheckLabel: string;
  classification: 'confirmed' | 'potential';
  elementLabel: string;
  elementType: string;
  filePath: string;
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  advisoryGuidance?: string;
  deduplicationKey: string;
}

function detectU1PrimaryAction(allFiles: Map<string, string>): U1Finding[] {
  const findings: U1Finding[] = [];
  const formFilesWithU1_1 = new Set<string>();

  // === U1.1: Form without submit mechanism ===
  for (const [filePathRaw, content] of allFiles.entries()) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|html|htm)$/i.test(filePath)) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    const formRegex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
    let formMatch;
    while ((formMatch = formRegex.exec(content)) !== null) {
      const formAttrs = formMatch[1] || '';
      const formContent = formMatch[2] || '';

      const hasOnSubmit = /onSubmit\s*=/i.test(formAttrs);
      const hasSubmitButton = /<(?:button|Button)\b(?![^>]*type\s*=\s*["'](?:button|reset)["'])[^>]*>/i.test(formContent);
      const hasSubmitInput = /<input\b[^>]*type\s*=\s*["']submit["'][^>]*>/i.test(formContent);

      if (!hasSubmitButton && !hasSubmitInput && !hasOnSubmit) {
        findings.push({
          subCheck: 'U1.1',
          subCheckLabel: 'No submit primary action',
          classification: 'confirmed',
          elementLabel: 'Form element',
          elementType: 'form',
          filePath,
          detection: 'Form without submit control',
          evidence: `<form> in ${filePath} — no submit button, input[type="submit"], or onSubmit handler`,
          explanation: 'A <form> exists but has no submit mechanism. Users cannot complete the form action.',
          confidence: 0.95,
          advisoryGuidance: 'Add a clear submit action (e.g., "Save", "Submit") tied to the form.',
          deduplicationKey: `U1.1|${filePath}`,
        });
        formFilesWithU1_1.add(filePath);
      }
    }
  }

  // === U1.2 & U1.3: Competing CTAs and generic labels ===
  const resolveKnownButtonImpl = (): { filePath: string; config: CvaVariantConfig } | null => {
    const candidates = [
      'src/components/ui/button.tsx', 'src/components/ui/button.ts',
      'components/ui/button.tsx', 'components/ui/button.ts',
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
  const seenU12Groups = new Set<string>();
  const GENERIC_LABELS = new Set(['continue', 'next', 'submit', 'save', 'confirm', 'ok']);

  for (const [filePathRaw, content] of allFiles.entries()) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx)$/.test(filePath)) continue;
    if (filePath.includes('components/ui/button')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;
    if (formFilesWithU1_1.has(filePath)) continue;

    const buttonLocalNames = new Set<string>();
    const importRegex = /import\s*\{([^}]+)\}\s*from\s*["']([^"']*components\/ui\/button[^"']*)["']/g;
    let importMatch;
    while ((importMatch = importRegex.exec(content)) !== null) {
      if (/\bButton\b/.test(importMatch[1])) {
        const aliasMatch = importMatch[1].match(/Button\s+as\s+(\w+)/);
        buttonLocalNames.add(aliasMatch ? aliasMatch[1] : 'Button');
      }
    }
    buttonLocalNames.add('button');

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx)$/i, '') || 'Component';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    // U1.2: Check action groups for competing primaries
    if (buttonImpl) {
      const actionGroups = extractActionGroups(content, buttonLocalNames);
      for (const group of actionGroups) {
        const ctas: Array<{ label: string; emphasis: Emphasis; styleKey: string | null }> = [];
        for (const btn of group.buttons) {
          const resolvedVariant = btn.variant || buttonImpl.config.defaultVariant || 'default';
          const classified = classifyButtonEmphasis({
            resolvedVariant,
            variantConfig: buttonImpl.config,
            instanceClassName: btn.className,
          });
          ctas.push({ label: btn.label, emphasis: classified.emphasis, styleKey: classified.styleKey });
        }
        if (ctas.some(c => c.emphasis === 'unknown' || !c.styleKey)) continue;

        const highs = ctas.filter(c => c.emphasis === 'high');
        if (highs.length >= 2) {
          const highStyleKeys = new Set(highs.map(h => h.styleKey));
          if (highStyleKeys.size === 1) {
            const groupKey = `${filePath}|${group.containerType}`;
            if (seenU12Groups.has(groupKey)) continue;
            seenU12Groups.add(groupKey);

            const labels = ctas.map(c => c.label);
            const sharedToken = highs[0].styleKey || 'default';
            findings.push({
              subCheck: 'U1.2',
              subCheckLabel: 'Multiple equivalent CTAs',
              classification: 'potential',
              elementLabel: `${componentName} — ${group.containerType}`,
              elementType: 'button group',
              filePath,
              detection: `${highs.length} CTAs share variant="${sharedToken}"`,
              evidence: `${labels.join(', ')} — all use same high-emphasis styling (${sharedToken})`,
              explanation: `${highs.length} sibling CTA buttons share identical high-emphasis styling (variant="${sharedToken}"), making the primary action unclear.`,
              confidence: 0.78,
              advisoryGuidance: 'Visually distinguish the primary action and demote secondary actions to outline/ghost/link variants.',
              deduplicationKey: `U1.2|${filePath}|${group.containerType}`,
            });
          }
        }
      }
    }

    // U1.3: Generic CTA labels
    const allButtons = extractButtonUsagesFromJsx(content, buttonLocalNames);
    for (const btn of allButtons) {
      const labelLower = btn.label.trim().toLowerCase();
      if (GENERIC_LABELS.has(labelLower)) {
        const dedupeKey = `U1.3|${filePath}|${labelLower}`;
        if (findings.some(f => f.deduplicationKey === dedupeKey)) continue;
        findings.push({
          subCheck: 'U1.3',
          subCheckLabel: 'Ambiguous CTA label',
          classification: 'potential',
          elementLabel: `"${btn.label}" button`,
          elementType: 'button',
          filePath,
          detection: `Generic label: "${btn.label}"`,
          evidence: `CTA labeled "${btn.label}" in ${componentName} — generic label without context`,
          explanation: `The CTA label "${btn.label}" is generic and does not communicate the specific action.`,
          confidence: 0.65,
          advisoryGuidance: 'Use specific, action-oriented labels (e.g., "Save changes" instead of "Save", "Create account" instead of "Submit").',
          deduplicationKey: dedupeKey,
        });
      }
    }
  }

  return findings;
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

// ========== A3 DETERMINISTIC DETECTION (Keyboard Operability) ==========
// Scans source code for interactive elements that are not keyboard accessible.

interface A3Finding {
  elementLabel: string;
  elementType: string;
  role?: string;
  sourceLabel: string;
  filePath: string;
  componentName?: string;
  classificationCode: string; // A3-C1, A3-C2, A3-C3, A3-P1, A3-P2
  classification: 'confirmed' | 'potential';
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  correctivePrompt?: string;
  deduplicationKey: string;
}

function detectA3KeyboardOperability(allFiles: Map<string, string>): A3Finding[] {
  const findings: A3Finding[] = [];
  const seenKeys = new Set<string>();

  const NON_INTERACTIVE_TAGS = 'div|span|p|li|section|article|header|footer|main|aside|nav|figure|figcaption|dd|dt|dl';
  const INTERACTIVE_ROLES = /\brole\s*=\s*["'](button|link|menuitem|tab|option|checkbox|radio|switch|combobox|listbox|slider|treeitem|gridcell)["']/i;
  const CLICK_HANDLER_RE = /\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/;

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js)$/.test(filePath)) continue;
    if (!filePath.startsWith('src/') && !filePath.startsWith('components/') && !filePath.startsWith('app/') && !filePath.startsWith('pages/')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    // A3-C1: Non-focusable custom interactive
    const tagRegex = new RegExp(`<(${NON_INTERACTIVE_TAGS})\\b([^>]*)>`, 'gi');
    let match;
    while ((match = tagRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (!CLICK_HANDLER_RE.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      if (INTERACTIVE_ROLES.test(attrs)) continue;
      if (/tabIndex\s*=\s*\{?\s*(\d+)\s*\}?/i.test(attrs) || /tabindex\s*=\s*["'](\d+)["']/i.test(attrs)) continue;
      if (/\b(onKeyDown|onKeyUp|onKeyPress)\s*=/.test(attrs)) continue;
      if (/tabIndex\s*=\s*\{?\s*-1\s*\}?/i.test(attrs) || /tabindex\s*=\s*["']-1["']/i.test(attrs)) continue;

      const testIdMatch = attrs.match(/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/);
      const ariaLabelMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const titleMatch = attrs.match(/title\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const afterTag = content.slice(match.index + match[0].length, Math.min(content.length, match.index + match[0].length + 300));
      const childTextMatch = afterTag.match(/^([^<]{1,80})/);
      const innerText = childTextMatch?.[1]?.trim();

      const ariaLabelValue = ariaLabelMatch?.[1] || ariaLabelMatch?.[2];
      const titleValue = titleMatch?.[1] || titleMatch?.[2];
      const testIdValue = testIdMatch?.[1] || testIdMatch?.[2] || testIdMatch?.[3];
      const visibleText = (innerText && innerText.length > 0 && innerText.length <= 60 ? innerText : null);
      const handlerNameMatch = attrs.match(/\b(?:onClick|onMouseDown|onPointerDown|onTouchStart)\s*=\s*\{?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\}?/);
      const handlerName = handlerNameMatch?.[1] || '';
      // Priority: aria-label → visible text → title → data-testid → fallback
      const label = ariaLabelValue
        || visibleText
        || titleValue
        || testIdValue
        || `Clickable ${tag} (${triggerHandler}${handlerName ? ' ' + handlerName : ''})`;
      const fileName = filePath.split('/').pop() || filePath;

      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const handlerMatch = attrs.match(/\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/);
      const triggerHandler = handlerMatch?.[1] || 'onClick';

      const dedupeKey = `${filePath}|${tag}|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        elementLabel: label, elementType: tag, sourceLabel: label, filePath, componentName,
        classificationCode: 'A3-C1', classification: 'confirmed',
        detection: `${triggerHandler} on non-semantic <${tag}> element`,
        evidence: `<${tag} ${triggerHandler}=...> at ${filePath}:${lineNumber} — missing role, tabIndex, keyboard handlers`,
        explanation: `This <${tag}> has ${triggerHandler} but lacks role, tabIndex, and keyboard event handlers. Keyboard users cannot reach or activate it.`,
        confidence: 0.92,
        correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nThis ${tag} uses ${triggerHandler} but is not keyboard operable because it lacks tabIndex${!/\brole\s*=/.test(attrs) ? ', role' : ''} and does not handle Enter/Space via onKeyDown.\n\nRecommended fix:\nReplace it with a <button type="button"> (or <a href> if navigation). If you must keep a ${tag}, add role="button", tabIndex={0}, and an onKeyDown handler for Enter/Space, and ensure :focus-visible styling.`,
        deduplicationKey: dedupeKey,
      });
    }

    // A3-C2: tabindex="-1" on primary interactive
    const negTabIndexRegex = /<(button|a|input|select|textarea)\b([^>]*tabIndex\s*=\s*\{?\s*-1[^>]*)>/gi;
    while ((match = negTabIndexRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (/aria-hidden\s*=\s*["']?true/i.test(attrs) || /hidden\b/.test(attrs) || /sr-only|visually-hidden|clip-path/i.test(attrs)) continue;

      const ariaLabel = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = ariaLabel?.[1] || ariaLabel?.[2] || `<${tag}> element`;
      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const dedupeKey = `${filePath}|tabindex-neg|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        elementLabel: label, elementType: tag, sourceLabel: label, filePath, componentName,
        classificationCode: 'A3-C2', classification: 'confirmed',
        detection: `tabIndex={-1} on <${tag}>`,
        evidence: `<${tag} tabIndex={-1}> at ${filePath}:${lineNumber} — removed from tab order`,
        explanation: `Primary interactive <${tag}> has tabIndex={-1}, removing it from keyboard tab order.`,
        confidence: 0.90,
        correctivePrompt: (() => { const fn = filePath.split('/').pop() || filePath; return `[${label} (${tag})] — ${fn}\n\nIssue reason:\nThis ${tag} has tabIndex={-1}, removing it from keyboard tab order. Keyboard users cannot reach it via Tab.\n\nRecommended fix:\nRemove tabIndex={-1} to restore default focusability. If the element must be removed from tab order, provide an alternative keyboard-accessible path.`; })(),
        deduplicationKey: dedupeKey,
      });
    }

    // A3-P1: role="button" with tabIndex but no key handler
    const roleButtonRegex = new RegExp(`<(${NON_INTERACTIVE_TAGS})\\b([^>]*role\\s*=\\s*["']button["'][^>]*)>`, 'gi');
    while ((match = roleButtonRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (!/tabIndex\s*=\s*\{?\s*[0-9]/.test(attrs) && !/tabindex\s*=\s*["'][0-9]/.test(attrs)) continue;
      if (/onKeyDown|onKeyUp|onKeyPress/.test(attrs)) continue;

      const testIdMatch = attrs.match(/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabel = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = testIdMatch?.[1] || testIdMatch?.[2] || ariaLabel?.[1] || ariaLabel?.[2] || `<${tag} role="button">`;
      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const dedupeKey = `${filePath}|role-nokey|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        elementLabel: label, elementType: tag, role: 'button', sourceLabel: label, filePath, componentName,
        classificationCode: 'A3-P1', classification: 'potential',
        detection: `role="button" + tabIndex but no key handler`,
        evidence: `<${tag} role="button" tabIndex=0> at ${filePath}:${lineNumber} — missing Enter/Space activation`,
        explanation: `Has role="button" and tabIndex but no onKeyDown/onKeyUp handler. Keyboard users can focus but may not activate.`,
        confidence: 0.72,
        correctivePrompt: (() => { const fn = filePath.split('/').pop() || filePath; return `[${label} (${tag})] — ${fn}\n\nIssue reason:\nThis ${tag} has role="button" and tabIndex but missing keyboard activation handler (onKeyDown/onKeyUp). Keyboard users can focus but cannot activate it with Enter or Space.\n\nRecommended fix:\nReplace it with a native <button type="button">. If you must keep a ${tag}, add an onKeyDown handler that triggers on Enter and Space, and ensure :focus-visible styling.`; })(),
        deduplicationKey: dedupeKey,
      });
    }

    // A3-P1: <a> without href used as button
    const anchorNoHrefRegex = /<a\b([^>]*(?:onClick|onMouseDown|onPointerDown)[^>]*)>/gi;
    while ((match = anchorNoHrefRegex.exec(content)) !== null) {
      const attrs = match[1];
      if (/href\s*=\s*(?:"(?!#")(?![^"]*javascript:)[^"]+"|'(?!#')[^']+')/.test(attrs)) continue;
      const hasHref = /href\s*=/.test(attrs);
      if (hasHref && !/href\s*=\s*["']#["']/.test(attrs)) continue;

      const testIdMatch = attrs.match(/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabel = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = testIdMatch?.[1] || testIdMatch?.[2] || ariaLabel?.[1] || ariaLabel?.[2] || '<a> as button';
      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const dedupeKey = `${filePath}|a-nohref|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        elementLabel: label, elementType: 'a', role: 'link', sourceLabel: label, filePath, componentName,
        classificationCode: 'A3-P1', classification: 'potential',
        detection: `<a> with onClick but no valid href`,
        evidence: `<a onClick=...${hasHref ? ' href="#"' : ''}> at ${filePath}:${lineNumber}`,
        explanation: `<a> used as button with onClick${hasHref ? ' and href="#"' : ' but no href'}. Use <button> or add role="button".`,
        confidence: 0.68,
        correctivePrompt: (() => { const fn = filePath.split('/').pop() || filePath; return `[${label} (a)] — ${fn}\n\nIssue reason:\nThis <a> is used as a button with onClick${hasHref ? ' and href="#"' : ' but no href'}. It is not a valid navigation link and may confuse assistive technology.\n\nRecommended fix:\nReplace it with a <button type="button"> if it triggers an action. If it navigates, add a valid href. Ensure :focus-visible styling is present.`; })(),
        deduplicationKey: dedupeKey,
      });
    }
  }

  return findings;
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
- Focus styles (:focus, :focus-visible, outline declarations)
- ARIA attributes and semantic HTML usage
- Alt text for images

### A2 (Poor focus visibility) — STRICT CLASSIFICATION & DETECTION RULES:

**ABSOLUTE RULE:**
If an element does NOT remove the default browser focus outline, it MUST NOT be reported under A2.
Lack of a custom focus-visible style alone is NOT an accessibility issue — browser defaults are acceptable.

**PREREQUISITE — OUTLINE REMOVAL CHECK:**
ONLY evaluate an element for A2 if it explicitly removes the default focus outline or zeroes the ring:
- \`outline-none\`, \`focus:outline-none\`, or \`focus-visible:outline-none\` is present in the class list
- OR \`ring-0\`, \`focus:ring-0\`, or \`focus-visible:ring-0\` is present
- OR \`focus:border-0\`, \`focus-visible:border-0\` is present
If the element does NOT remove the outline AND does not zero the ring/border → SKIP (do not report)

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
   - AND does NOT zero the ring (\`ring-0\`, \`focus:ring-0\`, \`focus-visible:ring-0\`)
   - OR element does NOT meet focusability criteria above
   - DO NOT REPORT — do not include in violations array

2. **PASS — SKIP ENTIRELY:**
   - Element IS focusable AND removes outline BUT has a STRONG visible replacement:
   - Valid PASS replacements (clear focus indicator):
     * \`focus:ring-2\` or higher, \`focus-visible:ring-2\` or higher → PASS
     * \`ring-offset-2\` or higher → PASS
     * \`focus:border-*\` or \`focus-visible:border-*\` with strong color token (not gray-100/200) → PASS
     * \`focus-visible:outline-*\` (not \`outline-none\`) → PASS
     * Outline explicitly retained (no outline-none) → PASS
   - DO NOT REPORT — do not include in violations array

3. **HEURISTIC RISK (Borderline) — REPORT:**
   - Element IS focusable AND outline is removed AND replacement exists but is LIKELY TOO SUBTLE:
   - Specific borderline patterns (ANY of these → HEURISTIC):
     a) \`ring-1\` or \`focus:ring-1\` or \`focus-visible:ring-1\` (ring thickness < 2px)
     b) Muted ring color: \`ring-gray-100\`, \`ring-gray-200\`, \`ring-slate-100\`, \`ring-slate-200\`, \`ring-zinc-200\` (low-contrast ring)
     c) No ring offset: missing any \`ring-offset-*\` OR explicitly \`ring-offset-0\` (ring merges with element border)
     d) \`ring-1\` + muted color + no offset combination (very subtle)
     e) Focus indicator is ONLY a background/text color change (\`focus:bg-*\`, \`focus:text-*\`, \`focus-visible:bg-*\`) without ring/outline/border/shadow
     f) "Shadow only" focus: \`focus:shadow-sm\` or \`focus-visible:shadow-sm\` without ring/outline/border
     g) Styles exist only on \`:focus\` without \`:focus-visible\` (keyboard perception risk)
   - Set \`typeBadge: "HEURISTIC"\`
   - Set confidence to 60-75% (deterministic but subtle)
   - Evidence: list the exact subtle focus classes found. Use detection text like:
     "Subtle focus ring (ring-1 gray-200) without offset after outline removal — may be hard to perceive"

4. **CONFIRMED VIOLATION — REPORT:**
   - Element IS focusable AND outline is removed AND replacement is NONE OR ZERO:
   - Confirmed patterns:
     * \`outline-none\` + \`ring-0\` or no ring/border/shadow/bg/text at all
     * \`focus:outline-none\` + no replacement classes whatsoever
     * \`focus-visible:outline-none\` + only \`ring-0\` or \`focus:ring-0\`
   - IMPORTANT: If focus is removed AND no replacement → ALWAYS Confirmed, NEVER Borderline/Heuristic
   - Set \`typeBadge: "CONFIRMED"\`
   - Set confidence to 90-95% (deterministic)
   - Evidence: list the outline-removal class and note complete absence of replacement

**VARIANT HANDLING — IMPORTANT:**
- Treat \`focus:*\` and \`focus-visible:*\` equally as valid focus styling signals
- Do NOT require \`focus-visible:\` exclusively — \`focus:\` variants are valid indicators
- A \`focus:ring-2\` is equally valid as \`focus-visible:ring-2\` for PASS classification

**FOCUS STYLE CHECK — PRIORITY ORDER:**
When \`focus:outline-none\` or \`outline-none\` or \`ring-0\` is present, check for VISIBLE REPLACEMENTS:
1. Strong ring: \`focus:ring-2\` or higher, \`focus-visible:ring-2\` or higher → PASS
2. Border change: \`focus:border-*\`, \`focus-visible:border-*\` with distinct color → PASS
3. Outline replacement: \`focus-visible:outline-*\` (not \`outline-none\`) → PASS
4. Strong shadow: \`focus:shadow-md\` or larger → PASS
5. Subtle ring: \`ring-1\` / \`focus:ring-1\` with muted color (gray-100/200) and no offset → HEURISTIC RISK
6. Shadow-sm only: \`focus:shadow-sm\` without ring/outline/border → HEURISTIC RISK
7. Background/text ONLY: \`focus:bg-*\`, \`focus-visible:bg-*\`, \`focus:text-*\` with no other → HEURISTIC RISK
8. NONE of the above → CONFIRMED VIOLATION

**GROUPING RULE:**
Group identical background-only focus patterns into a SINGLE A2 finding with multiple occurrences listed.
Example: If 5 buttons all use \`focus:bg-primary\` without ring/border, report ONE violation listing all 5 locations.

**OUTPUT FORMAT FOR A2 VIOLATIONS ONLY:**
Each A2 finding MUST include rich element identity fields so users can locate the exact element:
\`\`\`json
{
  "ruleId": "A2",
  "ruleName": "Poor focus visibility",
  "category": "accessibility",
  "typeBadge": "CONFIRMED" or "HEURISTIC",
  "evidence": "focus:outline-none with only focus:bg-accent in Button.tsx",
  "diagnosis": "Button removes focus outline without visible replacement.",
  "contextualHint": "Add visible focus ring or border for keyboard accessibility.",
  "confidence": 0.50,
  "role": "button",
  "accessibleName": "More options",
  "sourceLabel": "More options (kebab menu)",
  "selectorHint": "<Button aria-label=\"More options\" className=\"...outline-none\">",
  "filePath": "src/components/Header.tsx",
  "componentName": "Header"
}
\`\`\`
**Element identity fields (MANDATORY for every A2 finding):**
- "role": The HTML tag name or ARIA role (e.g., "button", "link", "input", "menuitem", "tab")
- "accessibleName": Computed accessible name from aria-label, aria-labelledby, or visible text content. Use "" (empty string) if none found.
- "sourceLabel": Best human-readable label describing the element (e.g., "3-dot menu", "Submit", "Close dialog"). Use visible text, aria-label, or contextual description.
- "selectorHint": The most useful selector to find the element — prefer data-testid if present, then id, then a class fragment, then component path with nearest JSX snippet (e.g., \`<Button aria-label="More options">\`)
- "filePath": Full file path where the element is defined
- "componentName": PascalCase component name if identifiable

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
      "ruleName": "Poor focus visibility",
      "category": "accessibility",
      "diagnosis": "In Button.tsx, outline-none removes focus ring without replacement.",
      "contextualHint": "Add visible focus-visible indicator for keyboard users.",
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

// ========== A4 DETERMINISTIC DETECTION (Missing Semantic Structure) ==========
interface A4Finding {
  elementLabel: string;
  elementType: string;
  role?: string;
  sourceLabel: string;
  filePath: string;
  componentName?: string;
  subCheck: 'A4.1' | 'A4.2' | 'A4.3' | 'A4.4';
  subCheckLabel: string;
  classification: 'confirmed' | 'potential';
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  correctivePrompt?: string;
  deduplicationKey: string;
}

function detectA4SemanticStructure(allFiles: Map<string, string>): A4Finding[] {
  const findings: A4Finding[] = [];
  const seenKeys = new Set<string>();

  // Track global heading/landmark presence
  let hasH1 = false;
  let hasMainLandmark = false;
  let hasNavLandmark = false;
  const headingLevelsUsed = new Set<number>();
  const clickableNonSemantics: A4Finding[] = [];
  const headingIssues: A4Finding[] = [];
  const landmarkIssues: A4Finding[] = [];
  const listIssues: A4Finding[] = [];

  const NON_INTERACTIVE_TAGS = 'div|span|p|li|section|article|header|footer|main|aside|nav|figure|figcaption|dd|dt|dl';
  // React handlers
  const CLICK_HANDLER_RE = /\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/;
  // HTML attribute handlers (case-insensitive)
  const HTML_CLICK_HANDLER_RE = /\b(onclick|onmousedown|onmouseup|onkeydown)\s*=/i;
  const INTERACTIVE_ROLES = /\brole\s*=\s*["'](button|link|menuitem|tab|option|checkbox|radio|switch|combobox|listbox|slider|treeitem|gridcell)["']/i;

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html)$/.test(filePath)) continue;
    if (!filePath.startsWith('src/') && !filePath.startsWith('components/') && !filePath.startsWith('app/') && !filePath.startsWith('pages/')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|html)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    // A4.1: Heading semantics
    const h1Match = content.match(/<h1\b/gi);
    if (h1Match) hasH1 = true;
    for (let i = 1; i <= 6; i++) {
      if (new RegExp(`<h${i}\\b`, 'i').test(content)) headingLevelsUsed.add(i);
    }

    // A4.2: Interactive elements are semantic (clickable div/span without role)
    const tagRegex = new RegExp(`<(${NON_INTERACTIVE_TAGS})\\b([^>]*)>`, 'gi');
    let match;
    while ((match = tagRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (!CLICK_HANDLER_RE.test(attrs) && !HTML_CLICK_HANDLER_RE.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      if (INTERACTIVE_ROLES.test(attrs)) continue;
      // Already has button/link semantics via tabIndex+role — skip
      if (/tabIndex\s*=\s*\{?\s*0\s*\}?/i.test(attrs) && INTERACTIVE_ROLES.test(attrs)) continue;

      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const handlerMatch = attrs.match(/\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/) || attrs.match(/\b(onclick|onmousedown|onmouseup|onkeydown)\s*=/i);
      const triggerHandler = handlerMatch?.[1] || 'onClick';

      const afterTag = content.slice(match.index + match[0].length, Math.min(content.length, match.index + match[0].length + 300));
      const childTextMatch = afterTag.match(/^([^<]{1,80})/);
      const innerText = childTextMatch?.[1]?.trim();
      const ariaLabelMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = ariaLabelMatch?.[1] || ariaLabelMatch?.[2] || (innerText && innerText.length <= 60 ? innerText : null) || `Clickable <${tag}>`;

      const dedupeKey = `A4.2|${filePath}|${tag}|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      clickableNonSemantics.push({
        elementLabel: label, elementType: tag, sourceLabel: label, filePath, componentName,
        subCheck: 'A4.2', subCheckLabel: 'Interactive semantics',
        classification: 'confirmed',
        detection: `${triggerHandler} on non-semantic <${tag}> without ARIA role`,
        evidence: `<${tag} ${triggerHandler}=...> at ${filePath}:${lineNumber}`,
        explanation: `Clickable <${tag}> with ${triggerHandler} but no semantic role (button/link). Screen readers cannot identify this as interactive.`,
        confidence: 0.95,
        correctivePrompt: `Replace clickable <${tag}> with <button> or <a>. If non-button must be used, add role="button", tabIndex="0", and Enter/Space handlers.`,
        deduplicationKey: dedupeKey,
      });
    }

    // A4.3: Landmark detection
    if (/<main\b/i.test(content) || /role\s*=\s*["']main["']/i.test(content)) hasMainLandmark = true;
    if (/<nav\b/i.test(content) || /role\s*=\s*["']navigation["']/i.test(content)) hasNavLandmark = true;

    // A4.4: Lists — detect repeated siblings with same class but no <ul>/<ol>
    const repeatedClassPattern = /className\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`})/g;
    const classCounts = new Map<string, number>();
    let classMatch;
    while ((classMatch = repeatedClassPattern.exec(content)) !== null) {
      const cls = classMatch[1] || classMatch[2] || classMatch[3] || '';
      if (cls.length > 10 && cls.length < 200) {
        classCounts.set(cls, (classCounts.get(cls) || 0) + 1);
      }
    }
    // If ≥3 siblings with same class and no <ul>/<ol> wrapping
    for (const [cls, count] of classCounts) {
      if (count >= 3) {
        // Check if file has semantic list elements
        const hasSemanticList = /<(?:ul|ol)\b/i.test(content) || /role\s*=\s*["']list["']/i.test(content);
        if (!hasSemanticList) {
          const listDedupeKey = `A4.4|${filePath}|${cls.substring(0, 30)}`;
          if (!seenKeys.has(listDedupeKey)) {
            seenKeys.add(listDedupeKey);
            listIssues.push({
              elementLabel: `Repeated items (${count}x)`, elementType: 'div', sourceLabel: `Repeated pattern in ${componentName || filePath}`,
              filePath, componentName,
              subCheck: 'A4.4', subCheckLabel: 'List semantics',
              classification: 'potential',
              detection: `${count} sibling elements with identical className, no <ul>/<ol> wrapper`,
              evidence: `Repeated class in ${filePath}: "${cls.substring(0, 60)}..."`,
              explanation: `${count} elements with the same class pattern but no semantic list (<ul>/<ol>) structure. Screen readers cannot convey the list relationship.`,
              confidence: 0.88,
              deduplicationKey: listDedupeKey,
            });
          }
        }
      }
    }
  }

  // A4.1: Post-scan heading analysis
  if (!hasH1 && headingLevelsUsed.size > 0) {
    headingIssues.push({
      elementLabel: 'Missing <h1>', elementType: 'h1', sourceLabel: 'Page heading',
      filePath: 'global', componentName: undefined,
      subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
      classification: 'confirmed',
      detection: 'No <h1> found in any source file',
      evidence: `Heading levels used: ${Array.from(headingLevelsUsed).sort().map(l => `h${l}`).join(', ')} — no h1`,
      explanation: 'No <h1> heading found. Every page should have exactly one <h1> representing the page title for screen reader navigation.',
      confidence: 0.90,
      correctivePrompt: 'Add exactly one <h1> element for the page title.',
      deduplicationKey: 'A4.1|no-h1',
    });
  }

  // Check for skipped heading levels
  const sortedLevels = Array.from(headingLevelsUsed).sort();
  for (let i = 1; i < sortedLevels.length; i++) {
    if (sortedLevels[i] - sortedLevels[i - 1] > 1) {
      headingIssues.push({
        elementLabel: `Heading level skip (h${sortedLevels[i - 1]} → h${sortedLevels[i]})`,
        elementType: `h${sortedLevels[i]}`, sourceLabel: 'Heading hierarchy',
        filePath: 'global', componentName: undefined,
        subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
        classification: 'potential',
        detection: `Heading level skips from h${sortedLevels[i - 1]} to h${sortedLevels[i]}`,
        evidence: `Heading levels used: ${sortedLevels.map(l => `h${l}`).join(', ')}`,
        explanation: `Heading level skips from h${sortedLevels[i - 1]} to h${sortedLevels[i]}. This breaks the logical document outline for screen readers.`,
        confidence: 0.78,
        deduplicationKey: `A4.1|skip-h${sortedLevels[i - 1]}-h${sortedLevels[i]}`,
      });
      break; // Report first skip only
    }
  }

  // Multiple h1s
  let h1Count = 0;
  for (const [, content] of allFiles) {
    const matches = content.match(/<h1\b/gi);
    if (matches) h1Count += matches.length;
  }
  if (h1Count > 1) {
    headingIssues.push({
      elementLabel: `Multiple <h1> elements (${h1Count})`, elementType: 'h1', sourceLabel: 'Page heading',
      filePath: 'global', componentName: undefined,
      subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
      classification: 'potential',
      detection: `${h1Count} <h1> elements found across source files`,
      evidence: `${h1Count} <h1> tags detected`,
      explanation: `Multiple <h1> elements detected. Pages should generally have exactly one <h1> for the page title.`,
      confidence: 0.72,
      deduplicationKey: 'A4.1|multiple-h1',
    });
  }

  // A4.3: Missing landmarks
  if (!hasMainLandmark) {
    landmarkIssues.push({
      elementLabel: 'Missing <main> landmark', elementType: 'main', sourceLabel: 'Page landmark',
      filePath: 'global', componentName: undefined,
      subCheck: 'A4.3', subCheckLabel: 'Landmark regions',
      classification: 'potential',
      detection: 'No <main> or role="main" found',
      evidence: 'No main landmark detected in source files',
      explanation: 'No <main> landmark found. Screen readers use landmarks to navigate page regions efficiently.',
      confidence: 0.75,
      deduplicationKey: 'A4.3|no-main',
    });
  }

  findings.push(...headingIssues, ...clickableNonSemantics, ...landmarkIssues, ...listIssues);
  return findings;
}

// ========== A5 DETERMINISTIC DETECTION (Missing Form Labels) ==========
interface A5Finding {
  elementLabel: string;
  elementType: string;
  inputSubtype?: string;
  role?: string;
  sourceLabel: string;
  filePath: string;
  componentName?: string;
  subCheck: 'A5.1' | 'A5.2' | 'A5.3' | 'A5.4' | 'A5.5' | 'A5.6';
  subCheckLabel: string;
  classification: 'confirmed' | 'potential';
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  correctivePrompt?: string;
  advisoryGuidance?: string;
  deduplicationKey: string;
  potentialSubtype?: 'accuracy' | 'borderline';
}

function detectA5FormLabels(allFiles: Map<string, string>): A5Finding[] {
  const findings: A5Finding[] = [];
  const seenKeys = new Set<string>();

  // Collect all ids defined by controls and all label[for] targets across files
  // For simplicity, we scan per-file since most label+control pairs are co-located.

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|html|htm)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    // Collect all id= attributes from controls
    const controlIds = new Set<string>();
    const controlIdRegex = /(?:id)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
    let idMatch;
    while ((idMatch = controlIdRegex.exec(content)) !== null) {
      const id = idMatch[1] || idMatch[2] || idMatch[3];
      if (id) controlIds.add(id);
    }

    // Count id occurrences for duplicate detection
    const idCounts = new Map<string, number>();
    for (const id of controlIds) {
      const idRegex = new RegExp(`id\\s*=\\s*(?:"|'|\\{["'])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:"|'|["']\\})`, 'g');
      const matches = content.match(idRegex);
      if (matches) idCounts.set(id, matches.length);
    }

    // Collect label[for] / htmlFor targets
    const labelForTargets = new Set<string>();
    const labelForRegex = /(?:htmlFor|for)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
    let labelForMatch;
    while ((labelForMatch = labelForRegex.exec(content)) !== null) {
      const target = labelForMatch[1] || labelForMatch[2] || labelForMatch[3];
      if (target) labelForTargets.add(target);
    }

    // Find form controls: <input>, <textarea>, <select>, and ARIA input roles
    const CONTROL_TAGS = 'input|textarea|select';
    const ARIA_INPUT_ROLES = /\brole\s*=\s*["'](textbox|combobox|searchbox|spinbutton)["']/i;
    const EXCLUDED_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button']);

    const controlRegex = new RegExp(`<(${CONTROL_TAGS})\\b([^>]*)(?:>|\\/>)`, 'gi');
    let match;
    while ((match = controlRegex.exec(content)) !== null) {
      const tag = match[1].toLowerCase();
      const attrs = match[2];

      // Exclude hidden, submit, reset, button types
      if (tag === 'input') {
        const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        const inputType = (typeMatch?.[1] || typeMatch?.[2] || 'text').toLowerCase();
        if (EXCLUDED_INPUT_TYPES.has(inputType)) continue;
      }

      // Exclude disabled controls
      if (/\bdisabled\b/.test(attrs)) continue;
      // Exclude aria-hidden="true"
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;

      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;

      // Extract input type for display
      const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const inputSubtype = tag === 'input' ? (typeMatch?.[1] || typeMatch?.[2] || 'text') : undefined;

      // Check for valid label sources
      const hasAriaLabel = /aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs) && !/aria-label\s*=\s*["']\s*["']/.test(attrs);
      const hasAriaLabelledBy = /aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs);
      const controlIdMatch = attrs.match(/(?:^|\s)id\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/);
      const controlId = controlIdMatch?.[1] || controlIdMatch?.[2] || controlIdMatch?.[3];
      const hasExplicitLabel = controlId ? labelForTargets.has(controlId) : false;

      // Check if wrapped in <label>
      // Simple heuristic: search backwards for unclosed <label> before this control
      const beforeControl = content.slice(Math.max(0, match.index - 500), match.index);
      const lastLabelOpen = beforeControl.lastIndexOf('<label');
      const lastLabelClose = beforeControl.lastIndexOf('</label');
      const isWrappedInLabel = lastLabelOpen > lastLabelClose && lastLabelOpen !== -1;

      const hasValidLabel = hasAriaLabel || hasAriaLabelledBy || hasExplicitLabel || isWrappedInLabel;

      // Extract placeholder
      const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2];
      const hasPlaceholder = !!placeholder && placeholder.trim().length > 0;

      // Build a label for the finding
      const nameMatch = attrs.match(/(?:name|id)\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const elementName = nameMatch?.[1] || nameMatch?.[2] || '';
      const ariaLabelVal = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = ariaLabelVal?.[1] || ariaLabelVal?.[2] || placeholder || elementName || `<${tag}> control`;
      const fileName = filePath.split('/').pop() || filePath;

      // A5.3: Broken label association — label[for] targets a non-existent or duplicate id
      if (controlId && hasExplicitLabel) {
        const idCount = idCounts.get(controlId) || 0;
        if (idCount > 1) {
          const dedupeKey = `A5.3|${filePath}|${controlId}|duplicate`;
          if (!seenKeys.has(dedupeKey)) {
            seenKeys.add(dedupeKey);
            findings.push({
              elementLabel: label, elementType: tag, inputSubtype, sourceLabel: label, filePath, componentName,
              subCheck: 'A5.3', subCheckLabel: 'Broken label association',
              classification: 'confirmed',
              detection: `Duplicate id="${controlId}" — ambiguous label association`,
              evidence: `<${tag} id="${controlId}"> at ${filePath}:${lineNumber} — ${idCount} elements share this id`,
              explanation: `Multiple elements share id="${controlId}", creating ambiguous label-control association.`,
              confidence: 0.92,
              correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nMultiple elements share id="${controlId}". The <label for="${controlId}"> cannot uniquely target the correct control.\n\nRecommended fix:\nAssign unique ids to each form control and update the corresponding <label for> attributes.`,
              deduplicationKey: dedupeKey,
            });
          }
          continue; // Don't double-report
        }
      }

      if (hasValidLabel) continue; // Properly labeled — skip

      // title is NOT a valid label source — title-only inputs remain A5.1 Confirmed

      // A5.2: Placeholder-only labeling
      if (hasPlaceholder && !hasValidLabel) {
        const dedupeKey = `A5.2|${filePath}|${tag}|${label}|${lineNumber}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          findings.push({
            elementLabel: label, elementType: tag, inputSubtype, sourceLabel: label, filePath, componentName,
            subCheck: 'A5.2', subCheckLabel: 'Placeholder used as label',
            classification: 'confirmed',
            detection: `<${tag}> has placeholder="${placeholder}" but no label/aria-label/aria-labelledby`,
            evidence: `<${tag} placeholder="${placeholder}"> at ${filePath}:${lineNumber} — missing label association`,
            explanation: `Placeholder text "${placeholder}" is the only label. Placeholders disappear on input and are not reliably announced by all screen readers.`,
            confidence: 0.95,
            correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nPlaceholder text is the only label for this control. Placeholders are not sufficient labels per WCAG 3.3.2.\n\nRecommended fix:\nAdd a persistent <label> associated with this input using for/id, or provide an accessible name via aria-label or aria-labelledby.`,
            deduplicationKey: dedupeKey,
          });
        }
        continue; // Don't double-report as A5.1
      }

      // A5.1: Missing accessible label entirely
      const dedupeKey = `A5.1|${filePath}|${tag}|${label}|${lineNumber}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        findings.push({
          elementLabel: label, elementType: tag, inputSubtype, sourceLabel: label, filePath, componentName,
          subCheck: 'A5.1', subCheckLabel: 'Missing label association',
          classification: 'confirmed',
          detection: `<${tag}> has no label, aria-label, or aria-labelledby`,
          evidence: `<${tag}> at ${filePath}:${lineNumber} — no programmatic label source found`,
          explanation: `Form control <${tag}> has no accessible name. Screen readers cannot identify what this control is for.`,
          confidence: 0.97,
          correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nThis form control has no programmatic label (no <label>, aria-label, or aria-labelledby).\n\nRecommended fix:\nAdd a visible <label> associated with this input using for + id, or provide an accessible name via aria-label or aria-labelledby.`,
          deduplicationKey: dedupeKey,
        });
      }
    }

    // Also detect ARIA input roles on non-form elements
    const ariaInputRegex = new RegExp(`<(div|span|p|section)\\b([^>]*role\\s*=\\s*["'](?:textbox|combobox|searchbox|spinbutton)["'][^>]*)>`, 'gi');
    while ((match = ariaInputRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (/\bdisabled\b/.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;

      const hasAriaLabel = /aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs) && !/aria-label\s*=\s*["']\s*["']/.test(attrs);
      const hasAriaLabelledBy = /aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs);
      if (hasAriaLabel || hasAriaLabelledBy) continue;

      const roleMatch = attrs.match(/role\s*=\s*["']([^"']+)["']/i);
      const role = roleMatch?.[1] || 'textbox';
      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const label = `<${tag} role="${role}">`;

      const dedupeKey = `A5.1|${filePath}|${tag}|${role}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      const fileName = filePath.split('/').pop() || filePath;
      findings.push({
        elementLabel: label, elementType: tag, role, sourceLabel: label, filePath, componentName,
        subCheck: 'A5.1', subCheckLabel: 'Missing label association',
        classification: 'confirmed',
        detection: `<${tag} role="${role}"> has no aria-label or aria-labelledby`,
        evidence: `<${tag} role="${role}"> at ${filePath}:${lineNumber} — no programmatic label`,
        explanation: `Custom input (role="${role}") has no accessible name. Screen readers cannot identify what this control is for.`,
        confidence: 0.95,
        correctivePrompt: `[${label}] — ${fileName}\n\nIssue reason:\nCustom input with role="${role}" has no programmatic label.\n\nRecommended fix:\nAdd aria-label or aria-labelledby to provide an accessible name for this control.`,
        deduplicationKey: dedupeKey,
      });
    }

    // Also detect contenteditable elements with role="textbox"
    const contenteditableRegex = /<(\w+)\b([^>]*contenteditable\s*=\s*["']true["'][^>]*)>/gi;
    while ((match = contenteditableRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (/\bdisabled\b/.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;

      const hasAriaLabel = /aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs) && !/aria-label\s*=\s*["']\s*["']/.test(attrs);
      const hasAriaLabelledBy = /aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs);
      if (hasAriaLabel || hasAriaLabelledBy) continue;

      const roleMatch2 = attrs.match(/role\s*=\s*["']([^"']+)["']/i);
      const role = roleMatch2?.[1] || 'textbox';
      const linesBefore2 = content.slice(0, match.index).split('\n');
      const lineNumber2 = linesBefore2.length;
      const label2 = `<${tag} contenteditable role="${role}">`;

      const dedupeKey = `A5.1|${filePath}|${tag}|contenteditable|${lineNumber2}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      const fileName2 = filePath.split('/').pop() || filePath;
      findings.push({
        elementLabel: label2, elementType: tag, role, sourceLabel: label2, filePath, componentName,
        subCheck: 'A5.1', subCheckLabel: 'Missing label association',
        classification: 'confirmed',
        detection: `<${tag} contenteditable="true"> has no aria-label or aria-labelledby`,
        evidence: `<${tag} contenteditable="true"> at ${filePath}:${lineNumber2} — no programmatic label`,
        explanation: `Contenteditable element (role="${role}") has no accessible name.`,
        confidence: 0.95,
        correctivePrompt: `[${label2}] — ${fileName2}\n\nIssue reason:\nContenteditable element has no programmatic label.\n\nRecommended fix:\nAdd aria-label or aria-labelledby.`,
        deduplicationKey: dedupeKey,
      });
    }

    // A5.3: Orphan labels — label[for] targets a non-existent id (run once per file, after controls)
    for (const forTarget of labelForTargets) {
      if (!controlIds.has(forTarget)) {
        const dedupeKey = `A5.3|${filePath}|${forTarget}|missing`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          const fileName3 = filePath.split('/').pop() || filePath;
          findings.push({
            elementLabel: `label[for="${forTarget}"]`, elementType: 'label', sourceLabel: `Orphan label for="${forTarget}"`, filePath, componentName,
            subCheck: 'A5.3', subCheckLabel: 'Broken label association',
            classification: 'confirmed',
            detection: `<label for="${forTarget}"> references non-existent id`,
            evidence: `label for="${forTarget}" in ${filePath} — no element with id="${forTarget}" found`,
            explanation: `A <label for="${forTarget}"> exists but no form control with id="${forTarget}" was found.`,
            confidence: 0.90,
            correctivePrompt: `[label for="${forTarget}"] — ${fileName3}\n\nIssue reason:\nThe label references id="${forTarget}" but no form control with that id exists.\n\nRecommended fix:\nEnsure the target form control has id="${forTarget}", or update the label's for attribute to match the control's actual id.`,
            deduplicationKey: dedupeKey,
          });
        }
      }
    }
  }

  // Post-process: suppress A5.1 for controls in the same file where an A5.3 orphan label exists
  // The orphan label is the root cause — reporting both is redundant.
  const a53Files = new Set(findings.filter(f => f.subCheck === 'A5.3').map(f => f.filePath));
  const deduped = findings.filter(f => {
    if (f.subCheck === 'A5.1' && a53Files.has(f.filePath)) {
      return false;
    }
    return true;
  });

  // ========== Potential sub-checks (A5.P1–P4) ==========
  // Only run on controls that already have a valid accessible name (no confirmed finding).
  const confirmedKeys = new Set(deduped.map(f => `${f.filePath}|${f.elementType}|${f.elementLabel}`));
  const potentialFindings: A5Finding[] = [];
  const GENERIC_LABELS = new Set(['input', 'field', 'value', 'text', 'enter here', 'type here', 'select', 'option']);

  // Track accessible names per file for A5.P2 duplicate detection
  const labelsByFile = new Map<string, Map<string, { tag: string; label: string; line: number; filePath: string; componentName: string }[]>>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/') || filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|html|htm)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    const labelForTargets = new Set<string>();
    const labelForRegex2 = /(?:htmlFor|for)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
    let lfm;
    while ((lfm = labelForRegex2.exec(content)) !== null) {
      const t = lfm[1] || lfm[2] || lfm[3];
      if (t) labelForTargets.add(t);
    }

    // Collect all id->text mappings for aria-labelledby resolution
    const idTextMap = new Map<string, string>();
    const idTextRegex = /<(\w+)\b[^>]*id\s*=\s*["']([^"']+)["'][^>]*>([^<]*)</g;
    let itm;
    while ((itm = idTextRegex.exec(content)) !== null) {
      idTextMap.set(itm[2], itm[3].trim());
    }

    if (!labelsByFile.has(filePath)) labelsByFile.set(filePath, new Map());
    const fileLabels = labelsByFile.get(filePath)!;

    const EXCLUDED_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button']);
    const controlRegex2 = /<(input|textarea|select)\b([^>]*)(?:>|\/>)/gi;
    let match2;
    while ((match2 = controlRegex2.exec(content)) !== null) {
      const tag = match2[1].toLowerCase();
      const attrs = match2[2];

      if (tag === 'input') {
        const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        const inputType = (typeMatch?.[1] || typeMatch?.[2] || 'text').toLowerCase();
        if (EXCLUDED_INPUT_TYPES.has(inputType)) continue;
      }
      if (/\bdisabled\b/.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;

      const linesBefore = content.slice(0, match2.index).split('\n');
      const lineNumber = linesBefore.length;

      // Determine accessible name
      const ariaLabelMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabelVal = ariaLabelMatch?.[1] || ariaLabelMatch?.[2] || '';
      const hasAriaLabel = ariaLabelVal.trim().length > 0;

      const ariaLabelledByMatch = attrs.match(/aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabelledByVal = ariaLabelledByMatch?.[1] || ariaLabelledByMatch?.[2] || '';
      const hasAriaLabelledBy = ariaLabelledByVal.trim().length > 0;

      const controlIdMatch = attrs.match(/(?:^|\s)id\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const controlId = controlIdMatch?.[1] || controlIdMatch?.[2];
      const hasExplicitLabel = controlId ? labelForTargets.has(controlId) : false;

      const beforeControl = content.slice(Math.max(0, match2.index - 500), match2.index);
      const lastLabelOpen = beforeControl.lastIndexOf('<label');
      const lastLabelClose = beforeControl.lastIndexOf('</label');
      const isWrappedInLabel = lastLabelOpen > lastLabelClose && lastLabelOpen !== -1;

      const hasValidLabel = hasAriaLabel || hasAriaLabelledBy || hasExplicitLabel || isWrappedInLabel;

      // Check title attribute
      const titleMatch = attrs.match(/title\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const titleVal = titleMatch?.[1] || titleMatch?.[2] || '';
      const hasTitle = titleVal.trim().length > 0;

      const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2] || '';

      const nameMatch = attrs.match(/(?:name|id)\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const elementName = nameMatch?.[1] || nameMatch?.[2] || '';
      const label = ariaLabelVal || placeholder || elementName || `<${tag}> control`;

      // Skip if this control has a confirmed finding
      const controlKey = `${filePath}|${tag}|${label}`;
      if (confirmedKeys.has(controlKey)) continue;

      const fileName = filePath.split('/').pop() || filePath;

      if (!hasValidLabel) continue; // No label at all — already handled by confirmed checks

      // Resolve accessible name text for quality checks
      let accessibleName = '';
      if (hasAriaLabel) {
        accessibleName = ariaLabelVal;
      } else if (hasAriaLabelledBy) {
        const ids = ariaLabelledByVal.split(/\s+/);
        accessibleName = ids.map(id => idTextMap.get(id) || '').join(' ').trim();
      } else if (isWrappedInLabel) {
        // Extract text from wrapping label (simplified)
        const labelStart = beforeControl.lastIndexOf('<label');
        const labelContent = beforeControl.slice(labelStart);
        const labelTextMatch = labelContent.match(/>([^<]*)</);
        accessibleName = labelTextMatch?.[1]?.trim() || '';
      } else if (hasExplicitLabel && controlId) {
        // Find label text from label[for=controlId]
        const labelTextRegex = new RegExp(`<label[^>]*(?:for|htmlFor)\\s*=\\s*["']${controlId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>([^<]*)`, 'i');
        const ltm = content.match(labelTextRegex);
        accessibleName = ltm?.[1]?.trim() || '';
      }

      // Track for A5.P2 duplicate detection
      if (accessibleName) {
        const normalizedName = accessibleName.trim().toLowerCase();
        if (!fileLabels.has(normalizedName)) fileLabels.set(normalizedName, []);
        fileLabels.get(normalizedName)!.push({ tag, label: accessibleName, line: lineNumber, filePath, componentName });
      }

      // A5.4: Generic label text
      if (accessibleName && GENERIC_LABELS.has(accessibleName.trim().toLowerCase())) {
        const dedupeKey = `A5.4|${filePath}|${tag}|${accessibleName}|${lineNumber}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          potentialFindings.push({
            elementLabel: accessibleName, elementType: tag, sourceLabel: accessibleName, filePath, componentName,
            subCheck: 'A5.4', subCheckLabel: 'Generic label text',
            classification: 'potential', potentialSubtype: 'borderline',
            detection: `<${tag}> label "${accessibleName}" is generic`,
            evidence: `label text "${accessibleName}" at ${filePath}:${lineNumber}`,
            explanation: `The label "${accessibleName}" is too generic to be meaningful. Users relying on screen readers cannot distinguish this control from others.`,
            confidence: 0.88,
            advisoryGuidance: 'Use a descriptive label that explains the purpose of this control (e.g., "Email address" instead of "Input").',
            deduplicationKey: dedupeKey,
          });
        }
      }

      // A5.6: Noisy aria-labelledby
      if (hasAriaLabelledBy && accessibleName) {
        const NOISY_TOKENS = /\b(optional|required|hint|note|help|info|used for)\b/i;
        if (accessibleName.length > 60 || NOISY_TOKENS.test(accessibleName)) {
          const dedupeKey = `A5.6|${filePath}|${tag}|${lineNumber}`;
          if (!seenKeys.has(dedupeKey)) {
            seenKeys.add(dedupeKey);
            potentialFindings.push({
              elementLabel: label, elementType: tag, sourceLabel: label, filePath, componentName,
              subCheck: 'A5.6', subCheckLabel: 'Noisy aria-labelledby',
              classification: 'potential', potentialSubtype: 'borderline',
              detection: `<${tag}> aria-labelledby resolves to noisy/long text`,
              evidence: `Resolved text: "${accessibleName.slice(0, 80)}${accessibleName.length > 80 ? '…' : ''}" at ${filePath}:${lineNumber}`,
              explanation: `The aria-labelledby resolves to text that is too long (${accessibleName.length} chars) or contains advisory tokens (optional/required/hint). This creates a confusing experience for screen reader users.`,
              confidence: 0.82,
              advisoryGuidance: 'Simplify the referenced label text. Move hints and status indicators to aria-describedby instead of aria-labelledby.',
              deduplicationKey: dedupeKey,
            });
          }
        }
      }
    }
  }

  // A5.5: Duplicate label text (per file)
  for (const [, fileLabels] of labelsByFile) {
    for (const [normalizedName, controls] of fileLabels) {
      if (controls.length < 2) continue;
      const dedupeKey = `A5.5|${controls[0].filePath}|${normalizedName}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      const controlList = controls.map(c => `<${c.tag}> at line ${c.line}`).join(', ');
      potentialFindings.push({
        elementLabel: controls[0].label, elementType: controls[0].tag, sourceLabel: controls[0].label,
        filePath: controls[0].filePath, componentName: controls[0].componentName,
        subCheck: 'A5.5', subCheckLabel: 'Duplicate label text',
        classification: 'potential', potentialSubtype: 'borderline',
        detection: `${controls.length} controls share label "${controls[0].label}"`,
        evidence: `Duplicate label "${controls[0].label}": ${controlList}`,
        explanation: `Multiple controls share the same accessible name "${controls[0].label}". Screen reader users cannot distinguish between them.`,
        confidence: 0.90,
        advisoryGuidance: 'Give each control a unique, descriptive label to differentiate them.',
        deduplicationKey: dedupeKey,
      });
    }
  }

  return [...deduped, ...potentialFindings];
}

// ========== A6 DETERMINISTIC DETECTION (Missing Accessible Names) ==========
// WCAG 2.1 — 4.1.2 Name, Role, Value (Level A)
// Detects interactive elements that lack an accessible name.
// Only Confirmed findings — no Potential sub-checks.

interface A6Finding {
  elementLabel: string;
  elementType: string;
  role?: string;
  sourceLabel: string;
  filePath: string;
  componentName?: string;
  subCheck: 'A6.1' | 'A6.2';
  subCheckLabel: string;
  classification: 'confirmed';
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  correctivePrompt?: string;
  deduplicationKey: string;
}

function detectA6AccessibleNames(allFiles: Map<string, string>): A6Finding[] {
  const findings: A6Finding[] = [];
  const seenKeys = new Set<string>();

  // Target elements: native interactive + ARIA interactive roles
  // Exclude form fields handled by A5: input:not([type=button|submit|reset|image]), textarea, select
  const A6_NATIVE_INTERACTIVE = /<(button|a)\b([^>]*)>/gi;
  const A6_INPUT_INTERACTIVE = /<input\b([^>]*type\s*=\s*["'](button|submit|reset|image)["'][^>]*)>/gi;
  const A6_ARIA_ROLES = /\brole\s*=\s*["'](button|link|tab|menuitem|switch|checkbox|radio|combobox|option)["']/i;
  const A6_ARIA_INTERACTIVE_RE = new RegExp(`<(div|span|li|a|section|article|header|footer|nav|td|th|p)\\b([^>]*role\\s*=\\s*["'](?:button|link|tab|menuitem|switch|checkbox|radio|combobox|option)["'][^>]*)>`, 'gi');

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|html|htm)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    // Collect all IDs and their text content for aria-labelledby resolution
    const idTextMap = new Map<string, string>();
    const idTextRegex = /<(\w+)\b[^>]*id\s*=\s*["']([^"']+)["'][^>]*>([^<]*)</g;
    let itm;
    while ((itm = idTextRegex.exec(content)) !== null) {
      idTextMap.set(itm[2], itm[3].trim());
    }

    function checkElement(tag: string, attrs: string, matchIndex: number) {
      // Exclusions
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) return;
      if (/\bhidden\b/.test(attrs) && !/hidden\s*=\s*["']false["']/i.test(attrs)) return;
      if (/\bdisabled\b/.test(attrs)) return;
      if (/aria-disabled\s*=\s*["']true["']/i.test(attrs)) return;
      if (/role\s*=\s*["'](presentation|none)["']/i.test(attrs)) return;

      // For <a>, require href to be a link target
      if (tag.toLowerCase() === 'a' && !/href\s*=/.test(attrs)) return;

      const linesBefore = content.slice(0, matchIndex).split('\n');
      const lineNumber = linesBefore.length;
      const fileName = filePath.split('/').pop() || filePath;

      // Compute accessible name
      // 1. aria-labelledby
      const ariaLabelledByMatch = attrs.match(/aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabelledByVal = ariaLabelledByMatch?.[1] || ariaLabelledByMatch?.[2] || '';

      if (ariaLabelledByVal.trim()) {
        const ids = ariaLabelledByVal.trim().split(/\s+/);
        const resolvedText = ids.map(id => idTextMap.get(id) || '').join(' ').trim();
        const missingIds = ids.filter(id => !idTextMap.has(id));

        if (missingIds.length > 0 || resolvedText === '') {
          // A6.2: Broken aria-labelledby reference
          const roleMatch = attrs.match(/role\s*=\s*["']([^"']+)["']/i);
          const role = roleMatch?.[1] || tag.toLowerCase();
          const label = `<${tag}> aria-labelledby="${ariaLabelledByVal}"`;
          const dedupeKey = `A6.2|${filePath}|${tag}|${ariaLabelledByVal}|${lineNumber}`;
          if (seenKeys.has(dedupeKey)) return;
          seenKeys.add(dedupeKey);

          findings.push({
            elementLabel: label, elementType: tag.toLowerCase(), role, sourceLabel: label, filePath, componentName,
            subCheck: 'A6.2', subCheckLabel: 'Broken aria-labelledby reference', classification: 'confirmed',
            detection: `aria-labelledby references ${missingIds.length > 0 ? 'missing ID(s): ' + missingIds.join(', ') : 'empty text'}`,
            evidence: `<${tag} aria-labelledby="${ariaLabelledByVal}"> at ${filePath}:${lineNumber}`,
            explanation: `aria-labelledby references ${missingIds.length > 0 ? 'non-existent ID(s) (' + missingIds.join(', ') + ')' : 'IDs that resolve to empty text'}, so no accessible name is exposed.`,
            confidence: 0.97,
            correctivePrompt: `[${label}] — ${fileName}\n\nIssue reason:\naria-labelledby references ${missingIds.length > 0 ? 'missing' : 'empty'} IDs.\n\nRecommended fix:\nEnsure aria-labelledby references existing element IDs with label text, or use aria-label.`,
            deduplicationKey: dedupeKey,
          });
          return; // A6.2 suppresses A6.1 for same element
        }
        // Has valid aria-labelledby with text — passes
        return;
      }

      // 2. aria-label
      const ariaLabelMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabelVal = (ariaLabelMatch?.[1] || ariaLabelMatch?.[2] || '').trim();
      if (ariaLabelVal.length > 0) return; // Has accessible name

      // 3. Text content / child text / img[alt]
      const afterTag = content.slice(matchIndex + tag.length + attrs.length + 2, Math.min(content.length, matchIndex + tag.length + attrs.length + 500));
      // Find closing tag
      const closingTagRegex = new RegExp(`</${tag}\\s*>`, 'i');
      const closingMatch = afterTag.match(closingTagRegex);
      const innerContent = closingMatch ? afterTag.slice(0, closingMatch.index) : afterTag.slice(0, 200);

      // Check for visible text (excluding nested tags)
      const visibleText = innerContent.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (visibleText.length > 0) return; // Has text content

      // Check for img[alt] inside the element
      const imgAltMatch = innerContent.match(/<img\b[^>]*alt\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/i);
      const imgAlt = (imgAltMatch?.[1] || imgAltMatch?.[2] || '').trim();
      if (imgAlt.length > 0) return; // Has img alt as name

      // Check for sr-only/visually-hidden text
      const srOnlyMatch = innerContent.match(/<span\b[^>]*class(?:Name)?\s*=\s*(?:"[^"]*(?:sr-only|visually-hidden)[^"]*"|'[^']*(?:sr-only|visually-hidden)[^']*')[^>]*>([^<]*)</i);
      const srOnlyText = (srOnlyMatch?.[1] || '').trim();
      if (srOnlyText.length > 0) return; // Has screen-reader-only text

      // For input[type="image"], check alt attribute
      if (tag.toLowerCase() === 'input') {
        const altMatch = attrs.match(/alt\s*=\s*(?:"([^"]+)"|'([^']+)')/);
        const altVal = (altMatch?.[1] || altMatch?.[2] || '').trim();
        if (altVal.length > 0) return;
      }

      // Also check title on the element itself — but title does NOT provide accessible name for A6
      // (title is only a tooltip, not a proper accessible name)

      // No accessible name found — A6.1
      const roleMatch = attrs.match(/role\s*=\s*["']([^"']+)["']/i);
      const role = roleMatch?.[1] || tag.toLowerCase();
      const ariaLabelAttr = ariaLabelVal ? ` aria-label=""` : '';
      const label = `<${tag.toLowerCase()}${role !== tag.toLowerCase() ? ` role="${role}"` : ''}>`;
      const dedupeKey = `A6.1|${filePath}|${tag}|${role}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);

      const nameSources = ['text content', 'aria-label', 'aria-labelledby'];
      if (tag.toLowerCase() === 'a' || tag.toLowerCase() === 'button') {
        nameSources.push('child img[alt]');
      }

      findings.push({
        elementLabel: label, elementType: tag.toLowerCase(), role, sourceLabel: label, filePath, componentName,
        subCheck: 'A6.1', subCheckLabel: 'Missing accessible name', classification: 'confirmed',
        detection: `<${tag.toLowerCase()}> has no accessible name`,
        evidence: `<${tag.toLowerCase()}> at ${filePath}:${lineNumber} — checked: ${nameSources.join(', ')}`,
        explanation: `Interactive element <${tag.toLowerCase()}>${role !== tag.toLowerCase() ? ' (role="' + role + '")' : ''} has no programmatic accessible name. Screen readers cannot identify its purpose.`,
        confidence: 0.97,
        correctivePrompt: `[${label}] — ${fileName}\n\nIssue reason:\nNo accessible name.\n\nRecommended fix:\nAdd visible text, aria-label, or aria-labelledby.`,
        deduplicationKey: dedupeKey,
      });
    }

    // Scan native <button> and <a href>
    let match;
    const buttonAnchorRegex = /<(button|a)\b([^>]*)>/gi;
    while ((match = buttonAnchorRegex.exec(content)) !== null) {
      checkElement(match[1], match[2], match.index);
    }

    // Scan <input type="button|submit|reset|image">
    const inputInteractiveRegex = /<input\b([^>]*type\s*=\s*["'](button|submit|reset|image)["'][^>]*)>/gi;
    while ((match = inputInteractiveRegex.exec(content)) !== null) {
      // For input[type=submit/reset], the type itself provides a name — skip
      const inputType = match[2].toLowerCase();
      if (inputType === 'submit' || inputType === 'reset') continue;
      checkElement('input', match[1], match.index);
    }

    // Scan ARIA interactive roles on non-form elements
    const ariaInteractiveRegex = new RegExp(`<(div|span|li|a|section|article|header|footer|nav|td|th|p)\\b([^>]*role\\s*=\\s*["'](?:button|link|tab|menuitem|switch|checkbox|radio|combobox|option)["'][^>]*)>`, 'gi');
    while ((match = ariaInteractiveRegex.exec(content)) !== null) {
      checkElement(match[1], match[2], match.index);
    }
  }

  return findings;
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
    
    // Separate A2 (focus) violations for aggregation (only from selected rules)
    const a2Violations: any[] = []; // A2 = Poor focus visibility (formerly A5)
    const otherViolations: any[] = [];
    
    filteredBySelection.forEach((v: any) => {
      if (v.ruleId === 'A2' || v.ruleId === 'A5') {
        // Accept both old A5 and new A2 IDs during transition
        v.ruleId = 'A2';
        a2Violations.push(v);
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
    
    // Process non-A2/U1 violations
    const filteredOtherViolations = [...nonU1OtherViolations, ...validatedU1Violations]
      .map((v: any) => {
        const rule = allRules.find(r => r.id === v.ruleId);
        return {
          ...v,
          correctivePrompt: rule?.correctivePrompt || v.correctivePrompt || '',
        };
      });

    // ========== A2 AGGREGATION LOGIC (Focus Visibility — Deterministic) ==========
    // Process and aggregate A2 violations into a single result object
    // Only report A2 when: outline is removed AND no visible focus replacement exists
    interface A2FocusItem {
      component_name: string;
      file_path: string;
      element_type: string;
      typeBadge: 'Confirmed Violation' | 'Heuristic Risk';
      focus_classes: string[];
      detection: string;
      confidence: number;
      rationale: string;
      occurrence_count?: number;
      // Identity fields from AI
      role?: string;
      accessibleName?: string;
      sourceLabel?: string;
      selectorHint?: string;
    }
    
    const a2FocusDedupeMap = new Map<string, A2FocusItem>();
    const a2ValidViolations: any[] = [];
    
    // First pass: filter A2 violations to only include actual violations
    for (const v of a2Violations) {
      const evidence = (v.evidence || '');
      const evidenceLower = evidence.toLowerCase();
      const diagnosis = (v.diagnosis || '').toLowerCase();
      const combined = evidenceLower + ' ' + diagnosis;
      
      // ABSOLUTE RULE: Only evaluate elements that explicitly remove the browser outline or zero the ring/border
      const mentionsOutlineRemoval = /outline-none|focus:outline-none|focus-visible:outline-none|ring-0|focus:ring-0|focus-visible:ring-0|focus:border-0|focus-visible:border-0/.test(combined);
      if (!mentionsOutlineRemoval) {
        console.log(`A2 SKIP (no outline removal): ${evidence}`);
        continue;
      }
      
      // Extract actual focus-related class tokens from the evidence
      const focusClassTokens: string[] = evidence.match(/focus(?:-visible)?:(?:ring(?:-\w+)?|border(?:-\w+)?|shadow(?:-\w+)?|outline(?:-\w+)?|bg-\w+|text-\w+)/gi) || [];
      
      // Check for STRONG visible focus replacement indicators (actual class tokens)
      // IMPORTANT: ring-1 is NOT a strong replacement — only ring-2 or higher counts as PASS
      const hasStrongRingToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:ring-[2-9]/i.test(t));
      const hasBorderToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:border(?!-0)/i.test(t));
      const hasShadowToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:shadow-(?!none|sm\b)/i.test(t));
      const hasOutlineToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:outline-(?!none)/i.test(t));
      
      // Also check in diagnosis for class mentions
      const hasStrongRingInDiagnosis = /focus(?:-visible)?:ring-[2-9]|ring-offset-[2-9]/.test(combined);
      const hasBorderInDiagnosis = /focus(?:-visible)?:border-(?!0)/.test(combined);
      const hasShadowInDiagnosis = /focus(?:-visible)?:shadow-(?!none|sm\b)/.test(combined);
      
      const hasVisibleReplacement = hasStrongRingToken || hasBorderToken || hasShadowToken || hasOutlineToken ||
                                     hasStrongRingInDiagnosis || hasBorderInDiagnosis || hasShadowInDiagnosis;
      
      // Check if explicitly marked as pass/acceptable
      const mentionsAcceptable = /(?<!no\s)(?<!without\s)(?<!lacks?\s)(?<!missing\s)(?:acceptable|compliant|has visible|proper focus|adequate focus|valid focus)/i.test(combined);
      const explicitlyPasses = /\bpass\b(?!word)/i.test(combined) && !/does not pass|doesn't pass|fail/i.test(combined);
      
      // If evidence shows valid replacement or acceptable, this is a PASS - skip entirely
      if (hasVisibleReplacement) {
        console.log(`A2 PASS (has strong focus replacement): ${evidence} [tokens: ${focusClassTokens.join(', ')}]`);
        continue;
      }
      
      if (mentionsAcceptable || explicitlyPasses) {
        console.log(`A2 PASS (explicitly acceptable): ${evidence}`);
        continue;
      }
      
      // ── Borderline vs Confirmed classification ──
      // Borderline = focus styling EXISTS but is too subtle
      // Confirmed = focus removed with NO replacement at all (or only zeros)
      // IMPORTANT: If outline is removed AND no replacement → always Confirmed, NEVER borderline
      
      const hasBgToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:bg-/i.test(t));
      const hasTextToken = focusClassTokens.some((t: string) => /focus(?:-visible)?:text-/i.test(t));
      const hasBackgroundOnlyFocus = (hasBgToken || hasTextToken || /focus:bg-|focus-visible:bg-|focus:text-|focus-visible:text-/.test(combined)) && 
                                      !hasStrongRingToken && !hasBorderToken && !hasShadowToken && !hasOutlineToken;
      
      // Check for ring-1 only (too subtle — width < 2px)
      const hasRing1Only = /(?:focus(?:-visible)?:)?ring-1\b/.test(combined) && !/focus(?:-visible)?:ring-[2-9]/.test(combined);
      
      // Check for muted ring colors (low-contrast ring)
      const hasMutedRingColor = /ring-(?:gray|slate|zinc)-(?:100|200)\b/.test(combined);
      
      // Check for missing ring offset or ring-offset-0
      const hasNoOffset = !/ring-offset-[1-9]/.test(combined) || /ring-offset-0\b/.test(combined);
      
      // Check for "shadow only" focus: focus:shadow-sm without ring/outline/border
      const hasShadowSmOnly = /focus(?:-visible)?:shadow-sm\b/.test(combined) && 
                               !hasStrongRingToken && !hasBorderToken && !hasOutlineToken;
      
      // Check for :focus only without :focus-visible (keyboard perception risk)
      const hasFocusOnlyStyles = /\bfocus:(?:ring-[^0]|border-(?!0)|shadow-(?!none)|outline-(?!none))/.test(combined) && !/focus-visible:/.test(combined);
      
      // Borderline requires at least SOME visible focus styling that is merely too subtle
      // If NO focus styling exists at all, it's Confirmed (blocking), not borderline
      const hasAnySubtleFocusStyling = hasBackgroundOnlyFocus || hasRing1Only || hasMutedRingColor || hasShadowSmOnly || hasFocusOnlyStyles;
      const isBorderline = hasAnySubtleFocusStyling;
      
      // This is a valid violation - add it
      console.log(`A2 VIOLATION: ${evidence} [borderline: ${isBorderline}]`);
      a2ValidViolations.push({
        ...v,
        isBorderline,
        detectedFocusClasses: focusClassTokens,
      });
    }
    
    // Second pass: aggregate valid A2 violations
    const a2InvalidComponentNames = new Set([
      'clear', 'close', 'open', 'toggle', 'show', 'hide', 'set', 'get', 'add', 'remove',
      'delete', 'edit', 'update', 'create', 'submit', 'cancel', 'save', 'reset',
      'next', 'previous', 'prev', 'back', 'forward', 'up', 'down', 'left', 'right',
      'true', 'false', 'yes', 'no', 'on', 'off', 'enabled', 'disabled',
      'text', 'label', 'container', 'wrapper',
      'component', 'element', 'item', 'items', 'default', 'variants', 'variant'
    ]);
    
    for (const v of a2ValidViolations) {
      const evidence = (v.evidence || '');
      const combined = (evidence + ' ' + (v.diagnosis || '')).toLowerCase();
      
      // Extract file path first (most reliable)
      const fileMatch = (evidence || v.contextualHint || '').match(/([a-zA-Z0-9_-]+\.(?:tsx|jsx|ts|js|vue|svelte))/i);
      
      // Extract PascalCase component names
      const componentMatch = evidence.match(/\b([A-Z][a-zA-Z0-9]*(?:Button|Close|Toggle|Trigger|Nav|Icon|Control|Action|Link|Card|Dialog|Modal|Menu|Header|Footer|Sidebar|Panel|Form|Input|Select|Textarea))\b/);
      const simpleComponentMatch = evidence.match(/(?:in\s+)?([A-Z][a-zA-Z0-9]{3,})/);
      
      // Resolve component name
      let componentName = '';
      let filePath = fileMatch?.[1] || v.filePath || '';
      
      if (componentMatch?.[1] && componentMatch[1].length > 4) {
        componentName = componentMatch[1];
      } else if (simpleComponentMatch?.[1] && simpleComponentMatch[1].length > 3) {
        const candidate = simpleComponentMatch[1];
        if (!a2InvalidComponentNames.has(candidate.toLowerCase())) {
          componentName = candidate;
        }
      }
      if (!componentName && filePath) {
        const fileName = filePath.replace(/\.(tsx|jsx|ts|js|vue|svelte)$/i, '');
        if (fileName && fileName.length > 2 && !a2InvalidComponentNames.has(fileName.toLowerCase())) {
          componentName = `Unnamed component (${filePath})`;
        }
      }
      if (!componentName && v.componentName && !a2InvalidComponentNames.has(v.componentName.toLowerCase())) {
        componentName = v.componentName;
      }
      
      // Determine element type from evidence
      let elementType = 'interactive element';
      if (/\bbutton\b/i.test(combined)) elementType = 'button';
      else if (/\blink\b|\ba\b(?:\s|>)/i.test(combined)) elementType = 'link';
      else if (/\binput\b/i.test(combined)) elementType = 'input';
      else if (/\bselect\b/i.test(combined)) elementType = 'select';
      else if (/\btextarea\b/i.test(combined)) elementType = 'textarea';
      else if (/\btab\b/i.test(combined)) elementType = 'tab';
      else if (/\bmenu/i.test(combined)) elementType = 'menuitem';
      
      // Extract focus-related classes mentioned
      const focusClasses: string[] = [];
      const classMatches = combined.match(/(?:focus:|focus-visible:)?(?:outline-none|ring-0|border-0|bg-[\w-]+|ring-[\w-]+|border-[\w-]+|text-[\w-]+|shadow-[\w-]+|ring-offset-[\w-]+)/g);
      if (classMatches) {
        focusClasses.push(...new Set(classMatches));
      }
      
      // Build detection string with descriptive text
      let detection: string;
      if (v.isBorderline) {
        const subtleDetails = focusClasses.filter(c => /focus|ring|border|bg-|text-|shadow/.test(c)).join(', ') || 'background/text change only';
        // Build a specific detection description
        const hasRing1 = /ring-1\b/.test(subtleDetails);
        const hasMuted = /(?:gray|slate|zinc)-(?:100|200)/.test(subtleDetails);
        const hasNoOff = !(/ring-offset-[1-9]/.test(subtleDetails));
        const hasShadowSm = /shadow-sm/.test(subtleDetails);
        
        const hasBgTextOnly = /(?:focus|focus-visible):(?:bg-|text-)/.test(subtleDetails) && 
                               !/ring-[1-9]|border-|shadow-|outline-(?!none)/.test(subtleDetails);
        
        if (hasBgTextOnly) {
          detection = `Focus indicated only by background/text color change (${subtleDetails}) after outline removal — contrast not verifiable statically`;
        } else if (hasRing1 && hasMuted && hasNoOff) {
          detection = `Subtle focus ring (${subtleDetails}) without offset after outline removal — may be hard to perceive`;
        } else if (hasShadowSm) {
          detection = `Focus uses shadow-sm only (${subtleDetails}) without ring/outline/border — may be too subtle`;
        } else {
          detection = `Focus styling exists but may be too subtle (${subtleDetails})`;
        }
      } else {
        detection = `Focus indicator removed (${focusClasses.filter(c => /outline-none|ring-0|border-0/.test(c)).join(', ') || 'outline-none'}) without visible replacement`;
      }
      
      // Determine classification
      const typeBadge: 'Confirmed Violation' | 'Heuristic Risk' = v.isBorderline ? 'Heuristic Risk' : 'Confirmed Violation';
      
      // Calculate confidence per classification
      let confidence = v.confidence || 0.90;
      if (v.isBorderline) {
        // Potential Risk (borderline): 60–75% deterministic
        confidence = Math.min(confidence, 0.75);
        confidence = Math.max(confidence, 0.60);
      } else {
        // Confirmed (blocking): 90–95% deterministic
        confidence = Math.min(confidence, 0.95);
        confidence = Math.max(confidence, 0.90);
      }
      
      // Deduplicate focus classes (avoid listing both outline-none and focus:outline-none unless both genuinely exist)
      const classesToRemove = focusClasses.filter((cls) => {
        if (cls === 'outline-none' && (focusClasses.includes('focus:outline-none') || focusClasses.includes('focus-visible:outline-none'))) return true;
        if (cls === 'ring-0' && (focusClasses.includes('focus:ring-0') || focusClasses.includes('focus-visible:ring-0'))) return true;
        if (cls === 'border-0' && focusClasses.includes('focus:border-0')) return true;
        return false;
      });
      for (const cls of classesToRemove) {
        const idx = focusClasses.indexOf(cls);
        if (idx !== -1) focusClasses.splice(idx, 1);
      }
      
      let rationale: string;
      if (!v.isBorderline) {
        rationale = 'Element removes the default browser outline without providing a visible focus replacement.';
      } else {
        const classStr = focusClasses.join(' ');
        const hasBgTextOnly = /(?:focus|focus-visible):(?:bg-|text-)/.test(classStr) && 
                               !/ring-[1-9]|border-|shadow-|outline-(?!none)/.test(classStr);
        if (hasBgTextOnly) {
          rationale = 'Issue reason: Outline removed; focus relies only on bg/text change; contrast can\'t be verified statically.\n\nRecommended fix: Add a clear focus-visible indicator (e.g., focus-visible:ring-2 + focus-visible:ring-offset-2) or restore outline.';
        } else {
          rationale = 'Focus indication relies on a subtle or low-contrast indicator (e.g., ring-1 with muted color, shadow-sm only), which may be insufficient for users with visual impairments.';
        }
      }
      
      // Deduplication key
      const dedupeKey = componentName || filePath || 'unknown';
      
      if (a2FocusDedupeMap.has(dedupeKey)) {
        const existing = a2FocusDedupeMap.get(dedupeKey)!;
        existing.occurrence_count = (existing.occurrence_count || 1) + 1;
        if (confidence > existing.confidence) {
          existing.confidence = confidence;
        }
        focusClasses.forEach(c => {
          if (!existing.focus_classes.includes(c)) {
            existing.focus_classes.push(c);
          }
        });
      } else {
        // Extract identity fields from AI output
        const aiRole = v.role || elementType;
        const aiAccessibleName = v.accessibleName ?? '';
        const aiSourceLabel = v.sourceLabel || componentName || 'Interactive element';
        const aiSelectorHint = v.selectorHint || 
          (filePath ? `<${elementType || 'element'}> in ${filePath}` : undefined);
        
        const item: A2FocusItem = {
          component_name: componentName,
          file_path: filePath,
          element_type: elementType,
          typeBadge,
          focus_classes: focusClasses,
          detection,
          confidence: Math.round(confidence * 100) / 100,
          rationale,
          occurrence_count: 1,
          role: aiRole,
          accessibleName: aiAccessibleName,
          sourceLabel: aiSourceLabel,
          selectorHint: aiSelectorHint,
        };
        a2FocusDedupeMap.set(dedupeKey, item);
      }
    }
    
    const a2FocusItems = Array.from(a2FocusDedupeMap.values());
    
    // Create aggregated A2 result ONLY if there are actual violations
    let aggregatedA2: any = null;
    if (a2FocusItems.length > 0) {
      const overallConfidence = Math.max(...a2FocusItems.map(i => i.confidence));
      
      const confirmedCount = a2FocusItems.filter(i => i.typeBadge === 'Confirmed Violation').length;
      const heuristicCount = a2FocusItems.filter(i => i.typeBadge === 'Heuristic Risk').length;
      
      // Determine overall status: confirmed if ANY confirmed items exist
      const hasConfirmedItems = confirmedCount > 0;
      const a2Status = hasConfirmedItems ? 'confirmed' : 'potential';
      const a2Subtype = hasConfirmedItems ? undefined : 'borderline';
      
      // Build a2Elements array for the aggregated card UI
      const a2Elements = a2FocusItems.map((item) => {
        const isConfirmed = item.typeBadge === 'Confirmed Violation';
        const elSubtype = isConfirmed ? undefined : 'borderline' as const;
        
        // Derive accessible name from component name / evidence
        const accessibleName = (item as any).accessibleName || '';
        const sourceLabel = (item as any).sourceLabel || item.component_name || 'Interactive element';
        const role = (item as any).role || item.element_type || 'interactive element';
        const selectorHint = (item as any).selectorHint || 
          (item.file_path ? `<${item.element_type || 'element'}> in ${item.file_path}` : undefined);
        
        return {
          elementLabel: sourceLabel,
          elementType: item.element_type,
          role,
          accessibleName,
          sourceLabel,
          selectorHint,
          textSnippet: undefined,
          location: item.file_path || 'Unknown file',
          detection: item.detection,
          focusClasses: item.focus_classes,
          classification: isConfirmed ? 'confirmed' as const : 'potential' as const,
          potentialSubtype: elSubtype,
          explanation: item.rationale,
          confidence: item.confidence,
          correctivePrompt: isConfirmed
            ? `[${sourceLabel} ${item.element_type}] — ${item.file_path || 'Source file'}\n\nIssue reason:\nFocus indicator is removed (${item.focus_classes.filter(c => /outline-none|ring-0/.test(c)).join(', ') || 'outline-none'}) without a visible replacement.\n\nRecommended fix:\nAdd a visible keyboard focus style using :focus-visible (e.g., focus-visible:ring-2 focus-visible:ring-offset-2 or an outline/border/underline) and apply consistently across all instances.`
            : undefined,
          deduplicationKey: `${item.file_path}|${item.component_name}`,
        };
      });
      
      const typeBreakdown = [
        confirmedCount > 0 ? `${confirmedCount} confirmed violation(s)` : '',
        heuristicCount > 0 ? `${heuristicCount} borderline risk(s)` : '',
      ].filter(Boolean).join(' and ');
      
      const summary = `Focus visibility issues detected: ${typeBreakdown}. ` +
        `Elements that remove the default browser outline (outline-none) without providing a visible focus replacement ` +
        `(ring, border, or shadow) may reduce keyboard accessibility.`;
      
      aggregatedA2 = {
        ruleId: 'A2',
        ruleName: 'Poor focus visibility',
        category: 'accessibility',
        status: a2Status,
        potentialSubtype: a2Subtype,
        blocksConvergence: a2Status === 'confirmed',
        inputType: 'zip',
        isA2Aggregated: true,
        a2Elements,
        diagnosis: summary,
        contextualHint: 'Interactive elements remove the default focus outline without a visible replacement indicator.',
        correctivePrompt: 'Add a visible focus indicator (focus ring, border change, shadow, or distinct background change) for interactive elements that remove the default outline. Do not alter layout structure or component behavior beyond focus styling.',
        confidence: Math.round(overallConfidence * 100) / 100,
        ...(a2Status === 'potential' ? {
          advisoryGuidance: 'Focus styling exists but may be too subtle. Consider using a clearer focus-visible indicator (e.g., ring-2 with offset) and ensure it is visually distinct.',
        } : {}),
      };
      
      console.log(`A2 aggregated: ${a2Violations.length} findings → ${a2FocusItems.length} valid violations → 1 result (${confirmedCount} confirmed, ${heuristicCount} heuristic)`);
    } else {
      console.log(`A2: No valid violations found (${a2Violations.length} filtered out as PASS or NOT APPLICABLE)`);
    }
    
    // Combine all violations
    let aiViolations = [
      ...filteredOtherViolations,
      ...(aggregatedA2 ? [aggregatedA2] : []),
    ];

    // ========== Deterministic U1 (primary action sub-checks) ==========
    let aggregatedU1: any = null;
    if (selectedRulesSet.has('U1')) {
      const u1Findings = detectU1PrimaryAction(allFiles);
      if (u1Findings.length > 0) {
        aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'U1');
        const confirmedCount = u1Findings.filter(f => f.classification === 'confirmed').length;
        const potentialCount = u1Findings.filter(f => f.classification === 'potential').length;
        const hasConfirmed = confirmedCount > 0;
        const overallConfidence = Math.max(...u1Findings.map(f => f.confidence));
        const u1Elements = u1Findings.map(f => ({
          elementLabel: f.elementLabel, elementType: f.elementType,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          explanation: f.explanation, confidence: f.confidence,
          advisoryGuidance: f.advisoryGuidance, deduplicationKey: f.deduplicationKey,
        }));
        aggregatedU1 = {
          ruleId: 'U1', ruleName: 'Unclear primary action', category: 'usability',
          status: hasConfirmed ? 'confirmed' : 'potential',
          blocksConvergence: false,
          inputType: 'zip', isU1Aggregated: true, u1Elements,
          diagnosis: `Primary action clarity issues: ${confirmedCount} confirmed, ${potentialCount} potential.`,
          contextualHint: 'Establish a clear visual hierarchy with one primary action per group.',
          advisoryGuidance: 'Visually distinguish the primary action (stronger color/weight/placement) and use specific labels.',
          confidence: Math.round(overallConfidence * 100) / 100,
        };
        console.log(`U1 aggregated: ${u1Findings.length} findings (${confirmedCount} confirmed, ${potentialCount} potential)`);
      }
    }

    // ========== Deterministic A3 (keyboard operability) ==========
    let aggregatedA3: any = null;
    if (selectedRulesSet.has('A3')) {
      const a3Findings = detectA3KeyboardOperability(allFiles);
      if (a3Findings.length > 0) {
        const confirmedCount = a3Findings.filter(f => f.classification === 'confirmed').length;
        const potentialCount = a3Findings.filter(f => f.classification === 'potential').length;
        const hasConfirmed = confirmedCount > 0;
        const overallConfidence = Math.max(...a3Findings.map(f => f.confidence));

        const a3Elements = a3Findings.map(f => ({
          elementLabel: f.sourceLabel,
          elementType: f.elementType,
          role: f.role,
          sourceLabel: f.sourceLabel,
          location: f.filePath,
          detection: f.detection,
          evidence: f.evidence,
          classification: f.classification,
          classificationCode: f.classificationCode,
          potentialSubtype: f.classification === 'potential' ? 'borderline' as const : undefined,
          explanation: f.explanation,
          confidence: f.confidence,
          correctivePrompt: f.correctivePrompt,
          deduplicationKey: f.deduplicationKey,
        }));

        const typeBreakdown = [
          confirmedCount > 0 ? `${confirmedCount} confirmed violation(s)` : '',
          potentialCount > 0 ? `${potentialCount} potential risk(s)` : '',
        ].filter(Boolean).join(' and ');

        aggregatedA3 = {
          ruleId: 'A3',
          ruleName: 'Incomplete keyboard operability',
          category: 'accessibility',
          status: hasConfirmed ? 'confirmed' : 'potential',
          potentialSubtype: hasConfirmed ? undefined : 'borderline',
          blocksConvergence: hasConfirmed,
          inputType: 'zip',
          isA3Aggregated: true,
          a3Elements,
          diagnosis: `Keyboard operability issues detected: ${typeBreakdown}. Interactive elements that lack proper keyboard semantics prevent keyboard-only users from accessing functionality.`,
          contextualHint: 'Ensure all interactive elements are keyboard accessible using native elements or ARIA + key handlers.',
          correctivePrompt: 'Ensure all interactive elements are keyboard accessible: use native <button>/<a href> elements, or add role, tabIndex=0, and Enter/Space key handlers.',
          confidence: Math.round(overallConfidence * 100) / 100,
          ...(hasConfirmed ? {} : {
            advisoryGuidance: 'Keyboard support may be incomplete. Ensure custom controls are reachable via Tab and activate with Enter/Space.',
          }),
        };

        console.log(`A3 aggregated: ${a3Findings.length} findings → 1 result (${confirmedCount} confirmed, ${potentialCount} potential)`);
      } else {
        console.log('A3: No keyboard operability issues found');
      }
    }

    // ========== Deterministic A4 (semantic structure) ==========
    let aggregatedA4: any = null;
    if (selectedRulesSet.has('A4')) {
      const a4Findings = detectA4SemanticStructure(allFiles);
      if (a4Findings.length > 0) {
        const confirmedCount = a4Findings.filter(f => f.classification === 'confirmed').length;
        const potentialCount = a4Findings.filter(f => f.classification === 'potential').length;
        const hasConfirmed = confirmedCount > 0;
        const overallConfidence = Math.max(...a4Findings.map(f => f.confidence));

        const a4Elements = a4Findings.map(f => ({
          elementLabel: f.sourceLabel, elementType: f.elementType, role: f.role, sourceLabel: f.sourceLabel,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          potentialSubtype: f.classification === 'potential' ? 'borderline' as const : undefined,
          explanation: f.explanation, confidence: f.confidence, correctivePrompt: f.correctivePrompt,
          deduplicationKey: f.deduplicationKey,
        }));

        const typeBreakdown = [
          confirmedCount > 0 ? `${confirmedCount} confirmed` : '',
          potentialCount > 0 ? `${potentialCount} potential` : '',
        ].filter(Boolean).join(' and ');

        aggregatedA4 = {
          ruleId: 'A4', ruleName: 'Missing semantic structure', category: 'accessibility',
          status: hasConfirmed ? 'confirmed' : 'potential',
          potentialSubtype: hasConfirmed ? undefined : 'borderline',
          blocksConvergence: hasConfirmed, inputType: 'zip', isA4Aggregated: true, a4Elements,
          diagnosis: `Semantic structure issues detected: ${typeBreakdown}. WCAG 1.3.1 requires meaningful structure via headings, landmarks, lists, and semantic interactive elements.`,
          contextualHint: 'Use semantic HTML elements to represent page hierarchy and structure.',
          correctivePrompt: 'Use semantic HTML elements (<h1>–<h6>, <main>, <nav>, <button>, <ul>/<ol>) to represent page structure.',
          confidence: Math.round(overallConfidence * 100) / 100,
          ...(hasConfirmed ? {} : { advisoryGuidance: 'Semantic structure may be incomplete. Verify headings, landmarks, and list patterns.' }),
        };
        console.log(`A4 aggregated: ${a4Findings.length} findings (${confirmedCount} confirmed, ${potentialCount} potential)`);
      } else {
        console.log('A4: No semantic structure issues found');
      }
    }

    // ========== Deterministic A5 (form labels) ==========
    let aggregatedA5: any = null;
    if (selectedRulesSet.has('A5')) {
      const a5Findings = detectA5FormLabels(allFiles);
      if (a5Findings.length > 0) {
        const confirmedFindings = a5Findings.filter(f => f.classification === 'confirmed');
        const potentialFindings = a5Findings.filter(f => f.classification === 'potential');
        const overallConfidence = Math.max(...a5Findings.map(f => f.confidence));

        const a5Elements = a5Findings.map(f => ({
          elementLabel: f.sourceLabel, elementType: f.elementType, inputSubtype: f.inputSubtype,
          role: f.role, sourceLabel: f.sourceLabel,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          explanation: f.explanation, confidence: f.confidence,
          correctivePrompt: f.correctivePrompt,
          advisoryGuidance: f.advisoryGuidance,
          potentialSubtype: f.potentialSubtype,
          deduplicationKey: f.deduplicationKey,
        }));

        const subCheckBreakdown = [
          confirmedFindings.filter(f => f.subCheck === 'A5.1').length > 0 ? `${confirmedFindings.filter(f => f.subCheck === 'A5.1').length} missing labels` : '',
          confirmedFindings.filter(f => f.subCheck === 'A5.2').length > 0 ? `${confirmedFindings.filter(f => f.subCheck === 'A5.2').length} placeholder-only` : '',
          confirmedFindings.filter(f => f.subCheck === 'A5.3').length > 0 ? `${confirmedFindings.filter(f => f.subCheck === 'A5.3').length} broken associations` : '',
          potentialFindings.length > 0 ? `${potentialFindings.length} potential quality issues` : '',
        ].filter(Boolean).join(', ');

        const hasConfirmed = confirmedFindings.length > 0;
        aggregatedA5 = {
          ruleId: 'A5', ruleName: 'Missing form labels (Input clarity)', category: 'accessibility',
          status: hasConfirmed ? 'confirmed' : 'potential',
          blocksConvergence: hasConfirmed, inputType: 'zip', isA5Aggregated: true, a5Elements,
          diagnosis: `Form label issues detected: ${confirmedFindings.length} confirmed, ${potentialFindings.length} potential (${subCheckBreakdown}). WCAG 1.3.1 and 3.3.2 require form controls to have programmatic labels.`,
          contextualHint: 'Add visible <label> elements or aria-label/aria-labelledby for all form controls.',
          correctivePrompt: hasConfirmed ? 'Add visible <label> elements associated with form controls using for/id, or provide accessible names via aria-label/aria-labelledby. Do not rely on placeholder text as the sole label.' : undefined,
          advisoryGuidance: potentialFindings.length > 0 ? 'Review label quality: avoid generic text, duplicate labels, title-only naming, and noisy aria-labelledby references.' : undefined,
          confidence: Math.round(overallConfidence * 100) / 100,
        };
        console.log(`A5 aggregated: ${a5Findings.length} findings (${confirmedFindings.length} confirmed, ${potentialFindings.length} potential)`);
      } else {
        console.log('A5: No form label issues found');
      }
    }

    // ========== Deterministic A6 (accessible names) ==========
    let aggregatedA6: any = null;
    if (selectedRulesSet.has('A6')) {
      const a6Findings = detectA6AccessibleNames(allFiles);
      if (a6Findings.length > 0) {
        const overallConfidence = Math.max(...a6Findings.map(f => f.confidence));
        const a6Elements = a6Findings.map(f => ({
          elementLabel: f.sourceLabel, elementType: f.elementType, role: f.role, sourceLabel: f.sourceLabel,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          explanation: f.explanation, confidence: f.confidence,
          correctivePrompt: f.correctivePrompt,
          deduplicationKey: f.deduplicationKey,
        }));
        const a61Count = a6Findings.filter(f => f.subCheck === 'A6.1').length;
        const a62Count = a6Findings.filter(f => f.subCheck === 'A6.2').length;
        const breakdown = [
          a61Count > 0 ? `${a61Count} missing names` : '',
          a62Count > 0 ? `${a62Count} broken references` : '',
        ].filter(Boolean).join(', ');
        aggregatedA6 = {
          ruleId: 'A6', ruleName: 'Missing accessible names (Name, Role, Value)', category: 'accessibility',
          status: 'confirmed', blocksConvergence: true, inputType: 'zip', isA6Aggregated: true, a6Elements,
          diagnosis: `Accessible name issues detected: ${a6Findings.length} confirmed (${breakdown}). WCAG 4.1.2 requires interactive elements to have programmatic accessible names.`,
          contextualHint: 'Add visible text, aria-label, or aria-labelledby to interactive elements.',
          correctivePrompt: 'Add visible text content, aria-label, or aria-labelledby to interactive elements. For icon-only buttons/links, add an aria-label.',
          confidence: Math.round(overallConfidence * 100) / 100,
        };
        console.log(`A6 aggregated: ${a6Findings.length} findings (${a61Count} missing names, ${a62Count} broken refs)`);
      } else {
        console.log('A6: No accessible name issues found');
      }
    }

    // Aggregate per-element A1 findings into at most 1 potential card
    const aggregatedA1Violations: any[] = [];
    if (contrastViolations.length > 0) {
      const a1Elements = contrastViolations.map(v => ({
        elementLabel: v.elementIdentifier || v.elementDescription || 'Unknown element',
        textSnippet: v.evidence,
        location: v.evidence || '',
        foregroundHex: v.foregroundHex,
        backgroundStatus: v.backgroundStatus || 'unmeasurable',
        contrastNotMeasurable: true,
        thresholdUsed: 4.5 as const,
        explanation: v.diagnosis,
        reasonCodes: v.reasonCodes || ['STATIC_ANALYSIS'],
        deduplicationKey: `a1|${v.elementIdentifier}|${v.foregroundHex}`,
      }));
      const avgConfidence = contrastViolations.reduce((sum, v) => sum + v.confidence, 0) / contrastViolations.length;
      aggregatedA1Violations.push({
        ruleId: 'A1',
        ruleName: 'Insufficient text contrast',
        category: 'accessibility',
        status: 'potential',
        isA1Aggregated: true,
        a1Elements,
        diagnosis: `${a1Elements.length} text element${a1Elements.length !== 1 ? 's' : ''} with potential contrast issues detected via static code analysis.`,
        correctivePrompt: 'Verify text contrast meets WCAG AA requirements (4.5:1 for normal text, 3:1 for large text) using browser DevTools after rendering.',
        contextualHint: 'Verify contrast with browser DevTools or accessibility testing tools after rendering.',
        confidence: Math.round(avgConfidence * 100) / 100,
        reasonCodes: ['STATIC_ANALYSIS'],
        potentialRiskReason: 'STATIC_ANALYSIS',
        advisoryGuidance: 'Upload screenshots of the rendered UI for higher-confidence verification.',
        blocksConvergence: false,
        inputType: 'zip',
        samplingMethod: 'inferred',
      });
      console.log(`A1 aggregated (ZIP): ${contrastViolations.length} potential elements → 1 Potential card`);
    }

    // Merge aggregated A1 with AI violations (no raw contrast violations)
    const allViolations = [...aggregatedA1Violations, ...aiViolations, ...(aggregatedU1 ? [aggregatedU1] : []), ...(aggregatedA3 ? [aggregatedA3] : []), ...(aggregatedA4 ? [aggregatedA4] : []), ...(aggregatedA5 ? [aggregatedA5] : []), ...(aggregatedA6 ? [aggregatedA6] : [])];

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