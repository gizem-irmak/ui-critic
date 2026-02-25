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
    { id: 'U1', name: 'Unclear primary action', diagnosis: 'Users may struggle to identify the main action due to competing visual emphasis or missing affordances.', correctivePrompt: 'Establish a clear visual hierarchy by emphasizing one primary action and de-emphasizing secondary actions using variant demotion (outline, ghost, link).' },
    { id: 'U2', name: 'Incomplete / Unclear navigation', diagnosis: 'Navigation paths are missing, ambiguous, or prevent users from understanding their current location.', correctivePrompt: 'Ensure clear navigation paths including back, forward, breadcrumb, and cancel options. Provide visible indicators of current location.' },
    { id: 'U3', name: 'Truncated or inaccessible content', diagnosis: 'Important content is truncated, clipped, or hidden in ways that prevent users from accessing full information.', correctivePrompt: 'Ensure all meaningful text is fully visible. Adjust layout, wrapping, or container sizes. Provide affordances to reveal truncated content.' },
    { id: 'U4', name: 'Recognition-to-recall regression', diagnosis: 'The interface requires users to recall information from memory instead of recognizing it from visible options.', correctivePrompt: 'Make options, commands, and actions visible or easily retrievable. Reduce reliance on user memory by providing contextual cues and labels.' },
    { id: 'U5', name: 'Insufficient interaction feedback', diagnosis: 'Users receive inadequate or no visible feedback about the result of their actions.', correctivePrompt: 'Add visible feedback after user actions: loading indicators, success/error confirmations, or state change animations.' },
    { id: 'U6', name: 'Weak grouping / layout coherence', diagnosis: 'Related elements lack visual grouping or alignment, reducing scannability and comprehension.', correctivePrompt: 'Improve alignment and grouping to visually associate related elements. Use consistent spacing, borders, or background differentiation.' },
  ],
  ethics: [
    { id: 'E1', name: 'Insufficient transparency in high-impact actions', diagnosis: 'High-impact actions lack adequate disclosure, confirmation, or consequence explanation.', correctivePrompt: 'Add confirmation steps with clear consequence disclosure for irreversible or high-impact actions.' },
    { id: 'E2', name: 'Imbalanced or manipulative choice architecture', diagnosis: 'Choice presentation uses visual weight, ordering, or defaults to nudge users toward a specific option.', correctivePrompt: 'Present choices with equal visual weight and neutral defaults. Ensure monetized options are not visually dominant.' },
    { id: 'E3', name: 'Obscured or restricted user control', diagnosis: 'User control options (opt-out, cancel, dismiss) are visually suppressed or harder to access.', correctivePrompt: 'Make opt-out, cancel, and control options clearly visible with equal visual hierarchy and accessibility.' },
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

// Path 2: Tailwind-token emphasis for plain <button className="..."> (no CVA)
function classifyTailwindEmphasis(className: string): Emphasis {
  const s = className.toLowerCase();
  // High-emphasis signals: bg-primary, bg-*600/700, or explicit filled bg + text-white
  if (/\bbg-primary\b/.test(s)) return 'high';
  if (/\bbg-\w+-[6-9]00\b/.test(s)) return 'high';
  if (/\btext-white\b/.test(s) && /\bbg-/.test(s) && !/\bbg-transparent\b/.test(s)) return 'high';
  // Low-emphasis signals
  if (/\bborder\b/.test(s) && !/\bbg-/.test(s)) return 'low';
  if (/\bbg-transparent\b/.test(s)) return 'low';
  if (/\bunderline\b/.test(s)) return 'low';
  // Medium: bg-secondary or bg-gray/muted tones
  if (/\bbg-(secondary|muted|gray-\d+|slate-\d+)\b/.test(s)) return 'medium';
  return 'unknown';
}

// Unified CTA emphasis classifier — tool-agnostic (CVA + Tailwind + semantic classes)
function classifyCTAEmphasis(params: {
  variant: string | null;
  variantConfig: CvaVariantConfig | null;
  className: string;
}): { emphasis: Emphasis; cue: string } {
  const { variant, variantConfig, className } = params;
  const s = (className || '').toLowerCase();

  // Path A: CVA variant resolution (design-system components)
  if (variantConfig && (variant || variantConfig.defaultVariant)) {
    const resolvedVariant = variant || variantConfig.defaultVariant || 'default';
    const result = classifyButtonEmphasis({
      resolvedVariant,
      variantConfig,
      instanceClassName: className,
    });
    if (result.emphasis !== 'unknown') {
      return { emphasis: result.emphasis, cue: `variant="${resolvedVariant}"` };
    }
  }

  // Path B: Tailwind utility class tokens
  if (/\bbg-primary\b/.test(s)) return { emphasis: 'high', cue: 'bg-primary' };
  if (/\bbg-\w+-[6-8]00\b/.test(s)) {
    const m = s.match(/\b(bg-\w+-[6-8]00)\b/);
    return { emphasis: 'high', cue: m?.[1] || 'bg-dark' };
  }
  if (/\btext-white\b/.test(s) && /\bbg-/.test(s) && !/\bbg-transparent\b/.test(s)) {
    const bgM = s.match(/\b(bg-\S+)\b/);
    return { emphasis: 'high', cue: `${bgM?.[1] || 'bg-*'} + text-white` };
  }

  // Path C: Semantic class cues (generic CSS frameworks, custom classes)
  if (/\b(?:btn-primary|button-primary|cta-primary|main-action)\b/.test(s)) {
    return { emphasis: 'high', cue: 'semantic:btn-primary' };
  }
  // "primary" alone — only if not a Tailwind utility prefix already handled
  if (/\bprimary\b/.test(s) && !/\b(?:text-primary|bg-primary|border-primary|ring-primary|outline-primary)\b/.test(s)) {
    return { emphasis: 'high', cue: 'semantic:primary' };
  }

  // Path D: Inline style heuristic (backgroundColor with contrast foreground)
  if (/style\s*=/.test(s) && /background-?color/i.test(s) && /color\s*:\s*(?:white|#fff)/i.test(s)) {
    return { emphasis: 'high', cue: 'inline-style:filled' };
  }

  // LOW signals
  if (/\b(?:ghost|link)\b/.test(s)) return { emphasis: 'low', cue: 'semantic:ghost/link' };
  if (/\bborder\b/.test(s) && !/\bbg-/.test(s)) return { emphasis: 'low', cue: 'border-only' };
  if (/\bbg-transparent\b/.test(s)) return { emphasis: 'low', cue: 'bg-transparent' };
  if (/\bunderline\b/.test(s)) return { emphasis: 'low', cue: 'underline' };
  if (/\b(?:btn-outline|button-outline|btn-ghost|btn-link|btn-text)\b/.test(s)) return { emphasis: 'low', cue: 'semantic:outline' };

  // MEDIUM signals
  if (/\b(?:secondary|btn-secondary|button-secondary)\b/.test(s)) return { emphasis: 'medium', cue: 'semantic:secondary' };
  if (/\bbg-(secondary|muted|gray-\d+|slate-\d+)\b/.test(s)) return { emphasis: 'medium', cue: 'bg-muted' };
  if (/\b(?:outline)\b/.test(s) && !/\b(?:btn-outline|button-outline)\b/.test(s)) return { emphasis: 'medium', cue: 'outline' };

  return { emphasis: 'unknown', cue: '' };
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
  offset: number; // character offset in the source content
}

function extractButtonUsagesFromJsx(content: string, buttonLocalNames: Set<string>, baseOffset = 0): ButtonUsage[] {
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

    usages.push({ label, variant, className, hasOnClick, offset: baseOffset + match.index });
  }

  return usages;
}

// Extract all CTA candidates: buttons + anchor-as-button
function extractCTAElements(content: string, buttonLocalNames: Set<string>, baseOffset = 0): ButtonUsage[] {
  const usages = extractButtonUsagesFromJsx(content, buttonLocalNames, baseOffset);

  // Also extract <a role="button"> and <a> with button-like class
  const anchorRegex = /<a\b([^>]*)>([^<]*(?:<(?!\/a)[^<]*)*)<\/a>/gi;
  let aMatch;
  while ((aMatch = anchorRegex.exec(content)) !== null) {
    const attrs = aMatch[1] || '';
    const children = aMatch[2] || '';

    const isRoleButton = /role\s*=\s*["']button["']/i.test(attrs);
    const hasButtonClass = /\b(?:btn|button|cta)\b/i.test(attrs);

    if (!isRoleButton && !hasButtonClass) continue;

    const classMatch = attrs.match(/(?:className|class)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{[`"']([^`"']+)[`"']\})/);
    const className = classMatch ? (classMatch[1] || classMatch[2] || classMatch[3] || '') : '';

    let label = children.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!label) {
      const ariaMatch = attrs.match(/(?:aria-label|title)\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      label = ariaMatch ? (ariaMatch[1] || ariaMatch[2] || 'Link') : 'Link';
    }

    usages.push({
      label,
      variant: null,
      className,
      hasOnClick: /onClick\s*=/.test(attrs),
      offset: baseOffset + aMatch.index,
    });
  }

  return usages;
}

// Extract action groups (any UI region likely to contain CTAs)
interface ActionGroup {
  containerType: string;
  buttons: ButtonUsage[];
  lineContext: string;
  offset: number;
  containerEnd: number;
}

function extractActionGroups(content: string, buttonLocalNames: Set<string>): ActionGroup[] {
  const groups: ActionGroup[] = [];

  // Named containers that are always considered CTA regions
  const NAMED_CONTAINERS = 'CardFooter|ModalFooter|DialogFooter|DialogActions|ButtonGroup|Actions|Toolbar|HeaderActions|FormActions';
  // Layout class tokens that indicate a CTA region
  const LAYOUT_CLASS_RE = /(?:flex|grid|gap-|justify-|items-|space-x-|space-y-|actions|footer|toolbar|button-group)/;

  const openerRegex = new RegExp(`<(${NAMED_CONTAINERS}|div|footer|section|nav|header|aside|span)\\b([^>]*)>`, 'gi');
  let openerMatch;
  while ((openerMatch = openerRegex.exec(content)) !== null) {
    const tagName = openerMatch[1];
    const attrs = openerMatch[2] || '';
    const isNamedContainer = new RegExp(`^(${NAMED_CONTAINERS})$`, 'i').test(tagName);

    if (!isNamedContainer) {
      if (!LAYOUT_CLASS_RE.test(attrs)) continue;
    }

    const containerType = isNamedContainer ? tagName : 'FlexContainer';
    const openTagEnd = openerMatch.index + openerMatch[0].length;

    // Depth-tracking to find matching close tag
    const nestRegex = new RegExp(`<(/?)(${tagName})\\b`, 'gi');
    nestRegex.lastIndex = openTagEnd;
    let depth = 1;
    let nestMatch;
    let containerEnd = -1;
    while ((nestMatch = nestRegex.exec(content)) !== null) {
      if (nestMatch[1] === '/') {
        depth--;
        if (depth === 0) {
          const closeIdx = content.indexOf('>', nestMatch.index);
          containerEnd = closeIdx >= 0 ? closeIdx + 1 : nestMatch.index + nestMatch[0].length;
          break;
        }
      } else {
        depth++;
      }
    }
    if (containerEnd < 0) continue;

    const containerContent = content.slice(openTagEnd, containerEnd);
    const buttons = extractCTAElements(containerContent, buttonLocalNames, openTagEnd);

    console.log(`[U1.2] container candidate: <${tagName}> (offset ${openerMatch.index}), CTAs = ${buttons.length}, labels = [${buttons.map(b => b.label).join(', ')}]`);

    if (buttons.length >= 2) {
      groups.push({
        containerType,
        buttons,
        lineContext: content.slice(openerMatch.index, Math.min(openerMatch.index + 200, containerEnd)),
        offset: openerMatch.index,
        containerEnd,
      });
    }
  }

  // Deduplicate: prefer innermost (most specific) containers
  const sorted = groups.sort((a, b) => a.offset - b.offset);
  const deduped: ActionGroup[] = [];
  for (const g of sorted) {
    const gEnd = g.containerEnd;
    const containedByExisting = deduped.some(d => d.offset <= g.offset && d.containerEnd >= gEnd);
    if (!containedByExisting) {
      for (let i = deduped.length - 1; i >= 0; i--) {
        if (g.offset <= deduped[i].offset && gEnd >= deduped[i].containerEnd) {
          deduped.splice(i, 1);
        }
      }
      deduped.push(g);
    }
  }

  return deduped;
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
  // Scoped suppression: track form content ranges that triggered U1.1 per file
  // Key = filePath, Value = array of { start, end } character offsets of the <form>...</form> block
  const u11FormScopes = new Map<string, Array<{ start: number; end: number }>>();

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
        const formStart = formMatch.index;
        const formEnd = formStart + formMatch[0].length;
        console.log(`[U1.1] fired: form scope ${filePath} chars ${formStart}-${formEnd}`);

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
          confidence: 1.0,
          advisoryGuidance: 'Add a clear submit action (e.g., "Save", "Submit") tied to the form.',
          deduplicationKey: `U1.1|${filePath}`,
        });
        if (!u11FormScopes.has(filePath)) u11FormScopes.set(filePath, []);
        u11FormScopes.get(filePath)!.push({ start: formStart, end: formEnd });
      }
    }
  }

  // Helper: check if a character offset falls within any U1.1 form scope for a file
  const isInsideU11Form = (filePath: string, offset: number): boolean => {
    const scopes = u11FormScopes.get(filePath);
    if (!scopes) return false;
    return scopes.some(s => offset >= s.start && offset <= s.end);
  };

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
    // No longer skip entire file — scoped suppression handled below

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

    // U1.2: Check action groups for competing primaries (tool-agnostic)
    const u12SuppressedLabels = new Set<string>();
    const actionGroups = extractActionGroups(content, buttonLocalNames);
    const coveredOffsets = new Set<number>();

    const processU12Region = (
      ctaUsages: ButtonUsage[],
      regionLabel: string,
      regionType: 'container' | 'line-window',
      regionOffset: number,
    ) => {
      const ctas: Array<{ label: string; emphasis: Emphasis; cue: string }> = [];
      for (const btn of ctaUsages) {
        const result = classifyCTAEmphasis({
          variant: btn.variant,
          variantConfig: buttonImpl?.config || null,
          className: btn.className,
        });
        ctas.push({ label: btn.label, emphasis: result.emphasis, cue: result.cue });
      }

      console.log(`[U1.2] region "${regionLabel}" (${regionType}) in ${filePath}, CTAs = ${ctas.length}, emphasis = [${ctas.map(c => `${c.label}:${c.emphasis}(${c.cue})`).join(', ')}]`);

      const highs = ctas.filter(c => c.emphasis === 'high');
      if (highs.length < 2) return;

      const groupKey = `${filePath}|${regionLabel}`;
      if (seenU12Groups.has(groupKey)) return;
      seenU12Groups.add(groupKey);

      const labels = ctas.map(c => c.label);
      const cueList = highs.map(h => h.cue).join(', ');
      console.log(`[U1.2] fired: ${regionLabel} in ${filePath} — ${highs.length} HIGH CTAs [${cueList}]`);

      // Signal-based confidence
      let u12Confidence = 0.60;
      if (regionType === 'container') u12Confidence += 0.10;
      const strongCues = highs.filter(h => /variant=|bg-\w+-[6-8]00|bg-primary|btn-primary|semantic:/.test(h.cue));
      if (strongCues.length === highs.length) u12Confidence += 0.10;
      const offsets = ctaUsages.map(b => b.offset);
      if (offsets.length >= 2 && Math.max(...offsets) - Math.min(...offsets) < 500) u12Confidence += 0.05;
      u12Confidence = Math.min(u12Confidence, 0.90);

      findings.push({
        subCheck: 'U1.2',
        subCheckLabel: 'Multiple equivalent CTAs',
        classification: 'potential',
        elementLabel: `${componentName} — ${regionLabel}`,
        elementType: 'button group',
        filePath,
        detection: `${highs.length}+ equivalent high-emphasis CTAs in the same region`,
        evidence: `${labels.join(', ')} — emphasis cues: [${cueList}] (${regionType === 'container' ? regionLabel : 'line-window proximity'})`,
        explanation: `${highs.length} CTA buttons share equivalent high-emphasis styling in the same UI region, making the primary action unclear.`,
        confidence: u12Confidence,
        advisoryGuidance: 'Visually distinguish the primary action and demote secondary actions to outline/ghost/link variants.',
        deduplicationKey: `U1.2|${filePath}|${regionLabel}`,
      });
      for (const cta of ctas) {
        u12SuppressedLabels.add(cta.label.trim().toLowerCase());
      }
    };

    // Process container-based groups
    for (const group of actionGroups) {
      if (isInsideU11Form(filePath, group.offset)) {
        console.log(`[U1.2] suppressed: container at offset ${group.offset} is inside U1.1 form scope in ${filePath}`);
        continue;
      }
      for (const btn of group.buttons) coveredOffsets.add(btn.offset);
      processU12Region(group.buttons, group.containerType, 'container', group.offset);
    }

    // Line-window fallback: group orphaned CTAs by proximity (±40 lines ≈ ±1600 chars)
    const LINE_WINDOW_CHARS = 1600;
    const allCTAsInFile = extractCTAElements(content, buttonLocalNames);
    const orphanedCTAs = allCTAsInFile.filter(c => !coveredOffsets.has(c.offset));
    if (orphanedCTAs.length >= 2) {
      const sortedOrphans = orphanedCTAs.sort((a, b) => a.offset - b.offset);
      let windowStart = 0;
      while (windowStart < sortedOrphans.length) {
        const windowCTAs = [sortedOrphans[windowStart]];
        let windowEnd = windowStart + 1;
        while (windowEnd < sortedOrphans.length && sortedOrphans[windowEnd].offset - sortedOrphans[windowStart].offset <= LINE_WINDOW_CHARS) {
          windowCTAs.push(sortedOrphans[windowEnd]);
          windowEnd++;
        }
        if (windowCTAs.length >= 2) {
          const notInForm = windowCTAs.filter(c => !isInsideU11Form(filePath, c.offset));
          if (notInForm.length >= 2) {
            processU12Region(notInForm, `line-window@${sortedOrphans[windowStart].offset}`, 'line-window', sortedOrphans[windowStart].offset);
          }
        }
        windowStart = windowEnd;
      }
    }

    // U1.3: Generic CTA labels (suppressed if label already covered by U1.2 in same file)
    const allButtons = extractButtonUsagesFromJsx(content, buttonLocalNames);
    for (const btn of allButtons) {
      const labelLower = btn.label.trim().toLowerCase();
      if (GENERIC_LABELS.has(labelLower)) {
        // Scoped suppression: skip if this button is inside a U1.1 form
        if (isInsideU11Form(filePath, btn.offset)) {
          console.log(`[U1.3] suppressed: "${btn.label}" at offset ${btn.offset} is inside U1.1 form scope in ${filePath}`);
          continue;
        }
        // Skip if this label was part of a U1.2 competing-CTAs group in this file
        if (u12SuppressedLabels.has(labelLower)) {
          console.log(`[U1.3] suppressed: "${btn.label}" covered by U1.2 in same container`);
          continue;
        }
        const dedupeKey = `U1.3|${filePath}|${labelLower}`;
        if (findings.some(f => f.deduplicationKey === dedupeKey)) continue;

        // Signal-based confidence for U1.3
        const HIGH_RISK_GENERICS = new Set(['continue', 'next', 'submit', 'save', 'confirm', 'ok']);
        let u13Confidence = 0.55;
        // +0.10 if label is in high-risk generic set
        if (HIGH_RISK_GENERICS.has(labelLower)) {
          u13Confidence += 0.10;
        }
        // +0.05 if no contextual heading or nearby descriptive text detected
        // Heuristic: check if there's an <h1-h6> or <label> near the button in the file
        const hasNearbyHeading = /<(?:h[1-6]|label|legend)\b[^>]*>/.test(content);
        if (!hasNearbyHeading) {
          u13Confidence += 0.05;
        }
        // +0.05 if button is visually emphasized (high-emphasis styling)
        const btnEmphasis = buttonImpl && (btn.variant || buttonImpl.config.defaultVariant)
          ? classifyButtonEmphasis({
              resolvedVariant: btn.variant || buttonImpl.config.defaultVariant || 'default',
              variantConfig: buttonImpl.config,
              instanceClassName: btn.className,
            }).emphasis
          : classifyTailwindEmphasis(btn.className);
        if (btnEmphasis === 'high') {
          u13Confidence += 0.05;
        }
        u13Confidence = Math.min(u13Confidence, 0.80);

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
          confidence: u13Confidence,
          advisoryGuidance: 'Use specific, action-oriented labels (e.g., "Save changes" instead of "Save", "Create account" instead of "Submit").',
          deduplicationKey: dedupeKey,
        });
      }
    }
  }

  return findings;
}

// =====================
// U3 Content Accessibility Detection (sub-checks U3.D1, U3.D2, U3.D3, U3.D4)
// =====================

interface U3Finding {
  subCheck: 'U3.D1' | 'U3.D2' | 'U3.D3' | 'U3.D4';
  subCheckLabel: string;
  classification: 'potential';
  elementLabel: string;
  elementType: string;
  filePath: string;
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  advisoryGuidance: string;
  textPreview?: string;
  deduplicationKey: string;
}

function extractU3TextPreview(content: string, pos: number): string | undefined {
  const after = content.slice(pos, Math.min(content.length, pos + 800));

  // Helper: cap at 120 chars
  const cap = (s: string): string => s.length > 120 ? s.slice(0, 117) + '…' : s;

  // Helper: check if a string looks like CSS/className tokens
  const looksLikeClasses = (s: string): boolean =>
    /^[\w\s\-/[\]:!.#]+$/.test(s) && /\b(text-|bg-|flex|grid|p-|m-|w-|h-|rounded|border|font-|block|inline|hidden|overflow|relative|absolute|max-|min-)/.test(s);

  // 1) Collect visible JSX text nodes: text between > and <
  //    but skip anything inside attribute positions
  const textParts: string[] = [];
  const jsxTextRe = />([^<>{]+)</g;
  let tm;
  while ((tm = jsxTextRe.exec(after)) !== null) {
    const raw = tm[1].trim();
    if (raw.length < 3) continue;
    // Skip if it looks like CSS class tokens leaked
    if (looksLikeClasses(raw)) continue;
    // Skip pure whitespace/punctuation
    if (!/[a-zA-Z]/.test(raw)) continue;
    textParts.push(raw);
  }

  if (textParts.length > 0) {
    const joined = textParts.join(' ').trim();
    if (joined.length > 0) return cap(joined);
  }

  // 2) Look for string literal CHILDREN (not attribute values)
  //    Match patterns like: >{`some template text`}< or >{"literal"}<
  const childStringRe = />\s*\{\s*[`"']([^`"']{5,})[`"']\s*\}\s*</g;
  let csm;
  while ((csm = childStringRe.exec(after)) !== null) {
    const raw = csm[1].trim();
    if (raw.length > 0 && !looksLikeClasses(raw)) return cap(raw);
  }

  // 3) Dynamic expressions as children: >{variable}< or > {item.title} <
  //    Must appear between > and < to be a child, not an attribute
  const dynChildRe = />\s*\{([a-zA-Z_][\w.]*)\}\s*</g;
  let dm;
  const dynNames: string[] = [];
  while ((dm = dynChildRe.exec(after)) !== null) {
    const varName = dm[1];
    // Skip common non-text props that might appear in children expressions
    if (/^(className|style|key|ref|id|onClick|onChange|onSubmit|disabled|checked|value|type|src|href|alt)$/.test(varName)) continue;
    dynNames.push(varName);
  }
  if (dynNames.length > 0) {
    const meaningful = dynNames.find(n => /^(title|name|label|description|text|content|message|email|url|summary|body|comment|note|caption|heading|subtitle|placeholder|address|bio|detail)$/i.test(n) || n.includes('.'));
    if (meaningful) return `(dynamic text: ${meaningful})`;
    return `(dynamic text: ${dynNames[0]})`;
  }

  // 4) Broader dynamic children: >{someExpression}<
  const dynBroadRe = />\s*\{([^}]{3,40})\}\s*</g;
  let db;
  while ((db = dynBroadRe.exec(after)) !== null) {
    const expr = db[1].trim();
    if (/[a-zA-Z]/.test(expr) && !/className|style|onClick/i.test(expr)) return '(dynamic text)';
  }

  return undefined;
}

function detectU3ContentAccessibility(allFiles: Map<string, string>): U3Finding[] {
  const findings: U3Finding[] = [];
  const seenKeys = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    const fileName = filePath.split('/').pop() || filePath;

    // --- U3.D1: Line clamp / ellipsis truncation without expand ---
    const truncationPatterns = [
      { re: /\bline-clamp-[1-3]\b/g, label: 'line-clamp' },
      { re: /\btruncate\b/g, label: 'truncate' },
      { re: /\btext-ellipsis\b/g, label: 'text-ellipsis' },
    ];

    for (const { re, label } of truncationPatterns) {
      let m;
      while ((m = re.exec(content)) !== null) {
        const pos = m.index;
        const lineNumber = content.slice(0, pos).split('\n').length;

        // Check surrounding context (~500 chars) for expand mechanism
        const context = content.slice(Math.max(0, pos - 200), Math.min(content.length, pos + 300)).toLowerCase();
        const hasExpand = /show\s*more|expand|read\s*more|see\s*all|view\s*more|toggle|title\s*=|tooltip/i.test(context);
        if (hasExpand) continue;

        // Skip if in a scroll container or has overflow-auto
        if (/overflow-(?:auto|y-auto|x-auto|scroll)\b/.test(context)) continue;

        const dedupeKey = `U3.D1|${filePath}|${lineNumber}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        findings.push({
          subCheck: 'U3.D1',
          subCheckLabel: 'Line clamp / ellipsis truncation',
          classification: 'potential',
          elementLabel: `Truncated text (${label})`,
          elementType: 'text',
          filePath,
          detection: `${m[0]} without expand mechanism`,
          evidence: `${m[0]} at ${fileName}:${lineNumber} — no "Show more", toggle, or title tooltip found nearby`,
          explanation: `Text is truncated using ${label} without a visible mechanism to reveal full content. Users may miss important information.`,
          confidence: 0.70,
          textPreview: extractU3TextPreview(content, pos),
          advisoryGuidance: 'Ensure truncated content has an accessible expand mechanism (e.g., "Show more" button, expandable section, or title tooltip).',
          deduplicationKey: dedupeKey,
        });
      }
    }

    // Also detect whitespace-nowrap + overflow-hidden combo (inline truncation)
    const nowrapRe = /\bwhitespace-nowrap\b/g;
    let nwm;
    while ((nwm = nowrapRe.exec(content)) !== null) {
      const pos = nwm.index;
      const context = content.slice(Math.max(0, pos - 200), Math.min(content.length, pos + 300));
      if (!/overflow-hidden\b/.test(context)) continue;
      const hasExpand = /show\s*more|expand|read\s*more|title\s*=|tooltip/i.test(context);
      if (hasExpand) continue;
      const lineNumber = content.slice(0, pos).split('\n').length;
      const dedupeKey = `U3.D1|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        subCheck: 'U3.D1',
        subCheckLabel: 'Line clamp / ellipsis truncation',
        classification: 'potential',
        elementLabel: 'Truncated text (nowrap + overflow)',
        elementType: 'text',
        filePath,
        detection: 'whitespace-nowrap + overflow-hidden without expand mechanism',
        evidence: `whitespace-nowrap + overflow-hidden at ${fileName}:${lineNumber}`,
        explanation: 'Text is forced to a single line with overflow hidden, potentially clipping important content.',
        confidence: 0.70,
        textPreview: extractU3TextPreview(content, pos),
        advisoryGuidance: 'Add a title attribute or expand mechanism for nowrap-truncated text.',
        deduplicationKey: dedupeKey,
      });
    }

    // --- U3.D2: Overflow clipping with fixed height ---
    const heightPatterns = /\b(?:max-h-\d+|h-\d+)\b/g;
    let hm;
    while ((hm = heightPatterns.exec(content)) !== null) {
      const pos = hm.index;
      const context = content.slice(Math.max(0, pos - 200), Math.min(content.length, pos + 300));
      // Must have overflow-hidden
      if (!/overflow-hidden\b|overflow-y-hidden\b/.test(context)) continue;
      // Must NOT have scroll
      if (/overflow-(?:auto|scroll|y-auto|y-scroll)\b/.test(context)) continue;
      // Should contain text-like content indicators
      const hasTextContent = /<p\b|<span\b|<div\b[^>]*>[^<]{20,}|children|text|description|content|message/i.test(context);
      if (!hasTextContent) continue;
      // Skip if expand mechanism
      const hasExpand = /show\s*more|expand|read\s*more|see\s*all|toggle/i.test(context);
      if (hasExpand) continue;

      const lineNumber = content.slice(0, pos).split('\n').length;
      const dedupeKey = `U3.D2|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        subCheck: 'U3.D2',
        subCheckLabel: 'Overflow clipping',
        classification: 'potential',
        elementLabel: 'Fixed-height overflow container',
        elementType: 'container',
        filePath,
        detection: `${hm[0]} + overflow-hidden without scroll or expand`,
        evidence: `${hm[0]} with overflow-hidden at ${fileName}:${lineNumber} — content may be clipped without user access`,
        explanation: `Container has a fixed height (${hm[0]}) with overflow-hidden, which may clip text content without providing scroll or expand access.`,
        confidence: 0.72,
        textPreview: extractU3TextPreview(content, pos),
        advisoryGuidance: 'Use overflow-auto for scrollable containers, or add an expand mechanism when content may exceed the fixed height.',
        deduplicationKey: dedupeKey,
      });
    }

    // --- U3.D3: Scroll trap risk ---
    // Nested overflow-y-scroll/auto inside fixed height
    const scrollRe = /\boverflow-y-(?:scroll|auto)\b/g;
    let sm;
    while ((sm = scrollRe.exec(content)) !== null) {
      const pos = sm.index;
      const context = content.slice(Math.max(0, pos - 300), Math.min(content.length, pos + 300));
      // Look for nested scroll indicator: another overflow-y-scroll/auto nearby
      const scrollMatches = context.match(/overflow-y-(?:scroll|auto)/g);
      if (!scrollMatches || scrollMatches.length < 2) continue;
      // Must have fixed height
      if (!/\b(?:max-h-|h-\d+)\b/.test(context)) continue;

      const lineNumber = content.slice(0, pos).split('\n').length;
      const dedupeKey = `U3.D3|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        subCheck: 'U3.D3',
        subCheckLabel: 'Scroll trap risk',
        classification: 'potential',
        elementLabel: 'Nested scroll container',
        elementType: 'container',
        filePath,
        detection: 'Nested scroll containers with fixed height',
        evidence: `Multiple overflow-y-scroll/auto within fixed-height region at ${fileName}:${lineNumber}`,
        explanation: 'Nested scrollable containers within a fixed-height parent may create a scroll trap where users cannot easily scroll the outer page.',
        confidence: 0.68,
        advisoryGuidance: 'Avoid nesting scrollable containers. If necessary, ensure the inner container has clear scroll affordances and does not trap scroll events.',
        deduplicationKey: dedupeKey,
      });
    }

    // --- U3.D4: Hidden content without control ---
    // Check for aria-hidden, hidden attr, display:none on meaningful content
    const hiddenPatterns = [
      { re: /aria-hidden\s*=\s*["']true["']/gi, label: 'aria-hidden="true"' },
      { re: /\bhidden\b(?!\s*=\s*["']false)/g, label: 'hidden attribute' },
    ];

    for (const { re, label } of hiddenPatterns) {
      let hm2;
      while ((hm2 = re.exec(content)) !== null) {
        const pos = hm2.index;
        const context = content.slice(Math.max(0, pos - 100), Math.min(content.length, pos + 400));

        // Skip decorative elements (icons, svgs, separators)
        if (/\bsvg\b|icon|separator|divider|decorat/i.test(context.slice(0, 150))) continue;
        // Skip sr-only / visually-hidden (accessibility patterns)
        if (/sr-only|visually-hidden/i.test(context)) continue;

        // Must contain meaningful content (text, form, interactive elements)
        const hasMeaningful = /<(?:p|h[1-6]|span|div|form|input|button|a)\b[^>]*>[^<]{5,}/i.test(context.slice(100)) ||
          /\b(?:description|message|content|paragraph|text|label)\b/i.test(context);
        if (!hasMeaningful) continue;

        // Check for toggle/control nearby
        const hasToggle = /toggle|show|expand|open|visible|setVisible|setOpen|setShow|useState/i.test(context);
        if (hasToggle) continue;

        const lineNumber = content.slice(0, pos).split('\n').length;
        const dedupeKey = `U3.D4|${filePath}|${lineNumber}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        findings.push({
          subCheck: 'U3.D4',
          subCheckLabel: 'Hidden content without control',
          classification: 'potential',
          elementLabel: `Hidden content (${label})`,
          elementType: 'content',
          filePath,
          detection: `${label} on content element without visible toggle`,
          evidence: `${label} at ${fileName}:${lineNumber} — meaningful content hidden without an associated toggle or control`,
          explanation: `Content is hidden using ${label} without a visible mechanism to reveal it. Users cannot access the hidden information.`,
          confidence: 0.68,
          textPreview: extractU3TextPreview(content, pos),
          advisoryGuidance: 'If the hidden content is meaningful, provide a visible toggle or control to reveal it. If decorative, ensure aria-hidden is appropriate.',
          deduplicationKey: dedupeKey,
        });
      }
    }
  }

  // Aggregate: cap per file to avoid noise (max 3 findings per file)
  const byFile = new Map<string, U3Finding[]>();
  for (const f of findings) {
    const existing = byFile.get(f.filePath) || [];
    existing.push(f);
    byFile.set(f.filePath, existing);
  }
  const capped: U3Finding[] = [];
  for (const [, fileFindgs] of byFile) {
    capped.push(...fileFindgs.slice(0, 3));
  }

  // Confidence adjustment: base 0.70 + 0.05 per additional sub-check, cap 0.85
  const subChecks = new Set(capped.map(f => f.subCheck));
  const bonus = Math.min((subChecks.size - 1) * 0.05, 0.15);
  for (const f of capped) {
    f.confidence = Math.min(f.confidence + bonus, 0.85);
  }

  console.log(`[U3] Detection: ${findings.length} raw findings, ${capped.length} after capping (${subChecks.size} unique sub-checks)`);

  return capped;
}


// =====================
// U5 Interaction Feedback Detection (sub-checks U5.D1, U5.D2, U5.D3)
// =====================

interface U5Finding {
  subCheck: 'U5.D1' | 'U5.D2' | 'U5.D3';
  subCheckLabel: string;
  elementLabel: string;
  elementType: string;
  filePath: string;
  detection: string;
  evidence: string;
  confidence: number;
  deduplicationKey: string;
}

function detectU5InteractionFeedback(allFiles: Map<string, string>): U5Finding[] {
  const findings: U5Finding[] = [];
  const seenKeys = new Set<string>();

  // Broadened async signal patterns
  const ASYNC_SIGNALS = [
    /\basync\b/, /\bawait\b/, /\bfetch\s*\(/, /\baxios[.\(]/,
    /\.then\s*\(/, /\bnew\s+Promise\b/, /\bsetTimeout\s*\(/,
    /\bsetInterval\s*\(/, /\bmutate\s*\(/, /\bmutateAsync\s*\(/,
    /\bmutation\b/, /\buseMutation\b/, /\bonSubmit\s*=\s*\{\s*handleSubmit/,
  ];

  // Feedback signals — must be checked in context
  function hasFeedbackInContext(content: string, handlerName?: string): { has: boolean; details: string[] } {
    const found: string[] = [];
    // Loading/submitting state variables
    if (/\b(?:isLoading|isSubmitting|isPending|loading|submitting)\s*[,;=)}\]]/i.test(content)) found.push('loading-state-var');
    // Disabled binding with loading
    if (/disabled\s*=\s*\{[^}]*(?:isLoading|isSubmitting|isPending|loading|submitting|pending)/i.test(content)) found.push('disabled-binding');
    // aria-busy
    if (/aria-busy/i.test(content)) found.push('aria-busy');
    // Spinner/loader components
    if (/(?:Spinner|Loader|LoadingIndicator|CircularProgress|<Oval|<Rings|<TailSpin)\b/i.test(content)) found.push('spinner-component');
    // Label swap ("Saving...", "Loading...")
    if (/(?:Saving|Loading|Submitting|Processing|Please wait)\.\.\./i.test(content)) found.push('label-swap');
    // Toast/notification
    if (/\btoast\s*\(|\btoast\.\w+\s*\(|useToast|Sonner|Snackbar|notification\s*\./i.test(content)) found.push('toast');
    // Success/error conditional rendering
    if (/\b(?:isSuccess|isError|error|success|message|status)\b\s*&&/i.test(content) ||
        /\{(?:isSuccess|isError|error|success|message)\s*&&/i.test(content) ||
        /(?:isSuccess|isError|error|success)\s*\?\s*/i.test(content)) found.push('success-error-render');
    // Alert/FormMessage
    if (/\bAlert\b|FormMessage|ErrorMessage|SuccessMessage/i.test(content)) found.push('alert-component');

    return { has: found.length > 0, details: found };
  }

  // Extract function body by name from file content
  function extractHandlerBody(content: string, handlerName: string): string | null {
    // Match: const handlerName = ... OR function handlerName(...)
    const patterns = [
      new RegExp(`(?:const|let|var)\\s+${handlerName}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|\\w+)\\s*=>\\s*\\{`, 'g'),
      new RegExp(`(?:const|let|var)\\s+${handlerName}\\s*=\\s*(?:async\\s*)?function\\s*\\([^)]*\\)\\s*\\{`, 'g'),
      new RegExp(`(?:async\\s+)?function\\s+${handlerName}\\s*\\([^)]*\\)\\s*\\{`, 'g'),
    ];
    for (const pat of patterns) {
      const m = pat.exec(content);
      if (m) {
        const start = m.index + m[0].length - 1; // at opening {
        let depth = 1, i = start + 1;
        while (depth > 0 && i < content.length) {
          if (content[i] === '{') depth++;
          else if (content[i] === '}') depth--;
          i++;
        }
        return content.slice(m.index, i);
      }
    }
    return null;
  }

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    const fileName = filePath.split('/').pop() || filePath;
    console.log(`[U5] scanning ${filePath}`);

    // ========== U5.D1: Async action without loading/disabled feedback ==========
    // Strategy: find ALL onClick/onSubmit attributes, resolve their handler bodies, check for async signals

    // Pattern 1: Inline handlers — onClick={() => { ... }} or onClick={async () => { ... }}
    const inlineHandlerRe = /(?:onClick|onSubmit)\s*=\s*\{\s*(?:async\s*)?\(?[^)]*\)?\s*=>\s*/gi;
    // Pattern 2: Function reference handlers — onClick={handleSave} or onSubmit={handleSubmit}
    const refHandlerRe = /(?:onClick|onSubmit)\s*=\s*\{\s*(\w+)\s*\}/gi;
    // Pattern 3: react-hook-form — onSubmit={handleSubmit(onSubmit)} or handleSubmit(submitHandler)
    const rhfHandlerRe = /onSubmit\s*=\s*\{\s*handleSubmit\s*\(\s*(\w+)\s*\)/gi;

    interface HandlerCandidate {
      pos: number;
      type: 'onClick' | 'onSubmit';
      handlerName?: string;
      handlerBody: string;
      label: string;
    }

    const candidates: HandlerCandidate[] = [];

    // Collect inline handlers
    let m: RegExpExecArray | null;
    const inlineRe2 = /(?:onClick|onSubmit)\s*=\s*\{\s*(?:async\s*)?\(?[^)]*\)?\s*=>\s*\{?/gi;
    while ((m = inlineRe2.exec(content)) !== null) {
      const handlerType = m[0].includes('onSubmit') ? 'onSubmit' : 'onClick';
      // Extract inline body: from match to end of handler block
      const startPos = m.index;
      const afterMatch = content.slice(startPos);
      // Find the opening { of the handler body
      const braceIdx = afterMatch.indexOf('{', m[0].length - 1);
      let handlerBody = afterMatch.slice(0, Math.min(500, afterMatch.length));
      if (braceIdx !== -1) {
        let depth = 0, i = braceIdx;
        while (i < afterMatch.length && i < braceIdx + 2000) {
          if (afterMatch[i] === '{') depth++;
          else if (afterMatch[i] === '}') { depth--; if (depth === 0) break; }
          i++;
        }
        handlerBody = afterMatch.slice(0, i + 1);
      }

      // Extract label from surrounding JSX
      const before = content.slice(Math.max(0, startPos - 200), startPos);
      const after = content.slice(startPos, Math.min(content.length, startPos + 400));
      const btnText = after.match(/>([^<]{2,40})</);
      const ariaLabel = (before.match(/aria-label\s*=\s*["']([^"']+)["']/i) || after.match(/aria-label\s*=\s*["']([^"']+)["']/i));
      const label = ariaLabel?.[1] || btnText?.[1]?.replace(/\{[^}]*\}/g, '').trim() || 'Action button';

      candidates.push({ pos: startPos, type: handlerType as any, handlerBody, label });
    }

    // Collect function-reference handlers
    const refRe2 = /(?:onClick|onSubmit)\s*=\s*\{\s*(\w+)\s*\}/gi;
    while ((m = refRe2.exec(content)) !== null) {
      const handlerType = m[0].includes('onSubmit') ? 'onSubmit' : 'onClick';
      const handlerName = m[1];
      // Don't match if already captured as inline
      if (candidates.some(c => Math.abs(c.pos - m!.index) < 5)) continue;

      const body = extractHandlerBody(content, handlerName);
      if (!body) {
        console.log(`[U5]   handler ref ${handlerName} — could not extract body, skipping`);
        continue;
      }

      const before = content.slice(Math.max(0, m.index - 200), m.index);
      const after = content.slice(m.index, Math.min(content.length, m.index + 400));
      const btnText = after.match(/>([^<]{2,40})</);
      const ariaLabel = (before.match(/aria-label\s*=\s*["']([^"']+)["']/i) || after.match(/aria-label\s*=\s*["']([^"']+)["']/i));
      const label = ariaLabel?.[1] || btnText?.[1]?.replace(/\{[^}]*\}/g, '').trim() || handlerName;

      candidates.push({ pos: m.index, type: handlerType as any, handlerName, handlerBody: body, label });
    }

    // Collect react-hook-form onSubmit={handleSubmit(onSubmitFn)}
    const rhfRe2 = /onSubmit\s*=\s*\{\s*handleSubmit\s*\(\s*(\w+)\s*\)/gi;
    while ((m = rhfRe2.exec(content)) !== null) {
      const handlerName = m[1];
      if (candidates.some(c => Math.abs(c.pos - m!.index) < 10)) continue;
      const body = extractHandlerBody(content, handlerName) || '';
      candidates.push({ pos: m.index, type: 'onSubmit', handlerName, handlerBody: body || 'handleSubmit wrapper', label: 'Form submit' });
    }

    console.log(`[U5]   found ${candidates.length} handler candidate(s) in ${fileName}`);

    for (const cand of candidates) {
      const lineNumber = content.slice(0, cand.pos).split('\n').length;

      // Check if handler body has async signals
      const hasAsyncSignal = ASYNC_SIGNALS.some(re => re.test(cand.handlerBody));
      // Also check if the handler function declaration is async
      const isAsyncDecl = /\basync\b/.test(cand.handlerBody.slice(0, 80));
      const isAsync = hasAsyncSignal || isAsyncDecl;

      console.log(`[U5]   candidate: ${cand.type} "${cand.label}" at L${lineNumber} | async=${isAsync} (signals: ${ASYNC_SIGNALS.filter(re => re.test(cand.handlerBody)).map((_, i) => ['async','await','fetch','axios','.then','new Promise','setTimeout','setInterval','mutate','mutateAsync','mutation','useMutation','handleSubmit'][i]).join(',')})`);

      if (!isAsync) continue; // Only flag async handlers

      // Check feedback — scoped to file but must relate to actual patterns
      const feedback = hasFeedbackInContext(content, cand.handlerName);
      console.log(`[U5]   feedback signals: ${feedback.has ? feedback.details.join(', ') : 'NONE'}`);

      if (feedback.has) continue; // Feedback exists, skip

      const dedupeKey = `U5.D1|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      let conf = 0.65;
      conf += 0.10; // D1 strong async
      if (!feedback.details.includes('disabled-binding')) conf += 0.05;
      if (!feedback.details.includes('spinner-component') && !feedback.details.includes('label-swap')) conf += 0.05;
      if (!feedback.details.includes('toast') && !feedback.details.includes('success-error-render')) conf += 0.05;

      findings.push({
        subCheck: 'U5.D1',
        subCheckLabel: 'Async action without loading/disabled feedback',
        elementLabel: `"${cand.label}" button`,
        elementType: cand.type === 'onSubmit' ? 'form' : 'button',
        filePath,
        detection: `Async handler without loading state, disabled binding, or spinner`,
        evidence: `${cand.type}=${cand.handlerName || '(inline)'} at ${fileName}:${lineNumber} — no isLoading, disabled, aria-busy, spinner, or toast detected`,
        confidence: Math.min(conf, 0.85),
        deduplicationKey: dedupeKey,
      });
    }

    // --- U5.D2: Form submit without success/error feedback ---
    const formRe = /<form\b[^>]*onSubmit/gi;
    let fm;
    while ((fm = formRe.exec(content)) !== null) {
      const pos = fm.index;
      const lineNumber = content.slice(0, pos).split('\n').length;

      const feedback = hasFeedbackInContext(content);
      if (feedback.has) continue;

      // Already flagged as D1? Skip to avoid noise
      const d1Key = `U5.D1|${filePath}|${lineNumber}`;
      if (seenKeys.has(d1Key)) continue;

      const dedupeKey = `U5.D2|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      let conf = 0.65;
      if (!feedback.details.includes('toast') && !feedback.details.includes('success-error-render')) conf += 0.05;

      findings.push({
        subCheck: 'U5.D2',
        subCheckLabel: 'Form submit without success/error feedback',
        elementLabel: 'Form submit',
        elementType: 'form',
        filePath,
        detection: `Form onSubmit without toast, alert, or success/error state rendering`,
        evidence: `<form onSubmit> at ${fileName}:${lineNumber} — no toast(), Snackbar, error/success conditional rendering detected`,
        confidence: Math.min(conf, 0.85),
        deduplicationKey: dedupeKey,
      });
    }

    // --- U5.D3: Toggle/state change without visible state indication (weaker) ---
    const toggleRe = /onClick\s*=\s*\{[^}]*(?:set\w+\s*\(\s*!\w+|set\w+\s*\(\s*prev\s*=>\s*!prev)/gi;
    let tm;
    while ((tm = toggleRe.exec(content)) !== null) {
      const pos = tm.index;
      const lineNumber = content.slice(0, pos).split('\n').length;
      const context = content.slice(Math.max(0, pos - 300), Math.min(content.length, pos + 300));

      const hasAriaState = /aria-pressed|aria-checked|role\s*=\s*["']switch["']/i.test(context);
      const hasClassConditional = /className\s*=\s*\{[^}]*\?\s*/i.test(context) || /\?\s*["'][^"']*["']\s*:\s*["']/i.test(context);
      const hasTextSwap = /\?\s*["'](?:On|Off|Active|Inactive|Enabled|Disabled|Show|Hide|Open|Close)["']/i.test(context);

      if (hasAriaState || hasClassConditional || hasTextSwap) continue;

      const dedupeKey = `U5.D3|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        subCheck: 'U5.D3',
        subCheckLabel: 'Toggle without visible state indication',
        elementLabel: 'Toggle control',
        elementType: 'toggle',
        filePath,
        detection: `Boolean toggle without aria-pressed/checked, className conditional, or text swap`,
        evidence: `onClick toggles boolean state at ${fileName}:${lineNumber} — no aria-pressed, aria-checked, className ternary, or text swap found`,
        confidence: 0.65,
        deduplicationKey: dedupeKey,
      });
    }
  }

  // Cap per file to avoid noise (max 3 per file)
  const byFile = new Map<string, U5Finding[]>();
  for (const f of findings) {
    const ex = byFile.get(f.filePath) || [];
    ex.push(f);
    byFile.set(f.filePath, ex);
  }
  const capped: U5Finding[] = [];
  for (const [, ff] of byFile) {
    capped.push(...ff.slice(0, 3));
  }

  console.log(`[U5] Detection: ${findings.length} raw findings, ${capped.length} after capping`);
  return capped;
}

// =====================
// U2 Navigation Detection (sub-checks U2.D1, U2.D2, U2.D3)
// =====================

interface U2Finding {
  subCheck: 'U2.D1' | 'U2.D2' | 'U2.D3';
  subCheckLabel: string;
  classification: 'potential';
  elementLabel: string;
  elementType: string;
  filePath: string;
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  advisoryGuidance: string;
  deduplicationKey: string;
}

function detectU2Navigation(allFiles: Map<string, string>): U2Finding[] {
  const findings: U2Finding[] = [];
  const seenKeys = new Set<string>();

  // --- Collect structural navigation signals across all files ---
  let routeCount = 0;
  let hasNavElement = false;
  let hasRoleNavigation = false;
  let hasNavLinks = false;
  let hasBreadcrumb = false;
  let hasBreadcrumbImport = false;
  let hasBreadcrumbRendered = false;
  let hasBackButton = false;
  const routeFiles: string[] = [];
  const nestedRouteFiles: string[] = [];
  const breadcrumbImportFiles: string[] = [];
  const layoutFiles: string[] = [];

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    const contentLower = content.toLowerCase();

    // Detect route definitions (React Router, Next.js, etc.)
    const routePatterns = [
      /<Route\b/gi,
      /path\s*[:=]\s*["']\//gi,
      /createBrowserRouter/gi,
      /useRoutes/gi,
    ];
    let fileRouteCount = 0;
    for (const pat of routePatterns) {
      const matches = content.match(pat);
      if (matches) fileRouteCount += matches.length;
    }
    if (fileRouteCount > 0) {
      routeCount += fileRouteCount;
      routeFiles.push(filePath);
    }

    // Detect nested routes (children property or nested <Route> inside <Route>)
    if (/<Route\b[^>]*>\s*<Route\b/s.test(content) || /children\s*:\s*\[/s.test(content)) {
      nestedRouteFiles.push(filePath);
    }

    // Detect <nav> element
    if (/<nav\b/i.test(content)) hasNavElement = true;
    if (/role\s*=\s*["']navigation["']/i.test(content)) hasRoleNavigation = true;

    // Detect navigation link components
    if (/<(?:Link|NavLink|a)\b[^>]*(?:href|to)\s*=/i.test(content)) {
      // Only count if in a layout-like file
      if (/layout|sidebar|navbar|header|navigation|menu|app\./i.test(filePath)) {
        hasNavLinks = true;
        layoutFiles.push(filePath);
      }
    }

    // Detect breadcrumb
    if (/breadcrumb/i.test(content)) {
      hasBreadcrumb = true;
      if (/import\s.*breadcrumb/i.test(content) || /from\s+['"].*breadcrumb/i.test(content)) {
        hasBreadcrumbImport = true;
        breadcrumbImportFiles.push(filePath);
      }
      if (/<Breadcrumb\b/i.test(content) || /role\s*=\s*["']breadcrumb["']/i.test(content) || /<nav\b[^>]*aria-label\s*=\s*["']breadcrumb["']/i.test(content)) {
        hasBreadcrumbRendered = true;
      }
    }

    // Detect back button / back navigation
    if (/(?:back|go\s*back|navigate\(-1\)|history\.back|router\.back|useNavigate.*-1)/i.test(content)) {
      hasBackButton = true;
    }
    if (/<(?:Button|button|a|Link)\b[^>]*>(?:[^<]*(?:Back|Go back|Return|← Back)[^<]*)<\//i.test(content)) {
      hasBackButton = true;
    }
  }

  const hasNavContainer = hasNavElement || hasRoleNavigation;

  // --- U2.D1: No navigation container ---
  // Trigger if: multiple routes AND no <nav>/role="navigation" AND no visible nav links in layouts
  if (routeCount >= 3 && !hasNavContainer && !hasNavLinks) {
    const dedupeKey = 'U2.D1|global';
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      findings.push({
        subCheck: 'U2.D1',
        subCheckLabel: 'No navigation container',
        classification: 'potential',
        elementLabel: 'Application routing',
        elementType: 'navigation',
        filePath: routeFiles[0] || 'Unknown',
        detection: `${routeCount} routes detected without <nav> element or role="navigation"`,
        evidence: `Route definitions found in: ${routeFiles.slice(0, 3).join(', ')}${routeFiles.length > 3 ? ` (+${routeFiles.length - 3} more)` : ''}. No <nav> or role="navigation" detected in any file. No navigation links found in layout files.`,
        explanation: `The application defines ${routeCount} routes but lacks a visible navigation container (<nav> or role="navigation"). Users may not have a clear way to navigate between sections.`,
        confidence: 0.70,
        advisoryGuidance: 'Add a <nav> element or role="navigation" container with links to main application routes. Ensure users can discover and navigate between sections.',
        deduplicationKey: dedupeKey,
      });
    }
  }

  // --- U2.D2: No back affordance in nested route ---
  // Trigger if: nested routes detected AND no back button AND no breadcrumb
  if (nestedRouteFiles.length > 0 && !hasBackButton && !hasBreadcrumbRendered) {
    const dedupeKey = 'U2.D2|global';
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      findings.push({
        subCheck: 'U2.D2',
        subCheckLabel: 'No back affordance in nested route',
        classification: 'potential',
        elementLabel: 'Nested route navigation',
        elementType: 'navigation',
        filePath: nestedRouteFiles[0],
        detection: 'Nested routes without back button or breadcrumb navigation',
        evidence: `Nested route structure detected in: ${nestedRouteFiles.slice(0, 3).join(', ')}. No back button (navigate(-1), history.back, "Back" label) or breadcrumb component found.`,
        explanation: 'Nested routes exist but no back navigation affordance (back button or breadcrumb) was detected. Users in child routes may not have a clear way to return to parent views.',
        confidence: 0.68,
        advisoryGuidance: 'Add a back button or breadcrumb trail in nested route views so users can navigate to parent routes.',
        deduplicationKey: dedupeKey,
      });
    }
  }

  // --- U2.D3: Breadcrumb inconsistency ---
  // Trigger if: breadcrumb imported but not rendered, OR role="breadcrumb" with no children
  if (hasBreadcrumbImport && !hasBreadcrumbRendered) {
    const dedupeKey = 'U2.D3|global';
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      findings.push({
        subCheck: 'U2.D3',
        subCheckLabel: 'Breadcrumb inconsistency',
        classification: 'potential',
        elementLabel: 'Breadcrumb component',
        elementType: 'navigation',
        filePath: breadcrumbImportFiles[0] || 'Unknown',
        detection: 'Breadcrumb component imported but not rendered',
        evidence: `Breadcrumb import detected in: ${breadcrumbImportFiles.join(', ')}. No <Breadcrumb> rendering or role="breadcrumb" usage found.`,
        explanation: 'A breadcrumb component is imported but does not appear to be rendered. This may indicate incomplete navigation implementation.',
        confidence: 0.72,
        advisoryGuidance: 'Render the breadcrumb component in relevant views or remove the unused import.',
        deduplicationKey: dedupeKey,
      });
    }
  }

  console.log(`[U2] Detection: routes=${routeCount}, hasNav=${hasNavContainer}, hasNavLinks=${hasNavLinks}, hasBreadcrumb=${hasBreadcrumbRendered}, hasBackButton=${hasBackButton}, nested=${nestedRouteFiles.length}, findings=${findings.length}`);

  return findings;
}

// Tailwind color mappings — full default palette
const TAILWIND_COLORS: Record<string, string> = {
  // White/Black
  'white': '#ffffff', 'black': '#000000',
  // Gray
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb',
  'gray-300': '#d1d5db', 'gray-400': '#9ca3af', 'gray-500': '#6b7280',
  'gray-600': '#4b5563', 'gray-700': '#374151', 'gray-800': '#1f2937', 'gray-900': '#111827', 'gray-950': '#030712',
  // Slate
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0',
  'slate-300': '#cbd5e1', 'slate-400': '#94a3b8', 'slate-500': '#64748b',
  'slate-600': '#475569', 'slate-700': '#334155', 'slate-800': '#1e293b', 'slate-900': '#0f172a', 'slate-950': '#020617',
  // Zinc
  'zinc-50': '#fafafa', 'zinc-100': '#f4f4f5', 'zinc-200': '#e4e4e7',
  'zinc-300': '#d4d4d8', 'zinc-400': '#a1a1aa', 'zinc-500': '#71717a',
  'zinc-600': '#52525b', 'zinc-700': '#3f3f46', 'zinc-800': '#27272a', 'zinc-900': '#18181b', 'zinc-950': '#09090b',
  // Neutral
  'neutral-50': '#fafafa', 'neutral-100': '#f5f5f5', 'neutral-200': '#e5e5e5',
  'neutral-300': '#d4d4d4', 'neutral-400': '#a3a3a3', 'neutral-500': '#737373',
  'neutral-600': '#525252', 'neutral-700': '#404040', 'neutral-800': '#262626', 'neutral-900': '#171717', 'neutral-950': '#0a0a0a',
  // Stone
  'stone-50': '#fafaf9', 'stone-100': '#f5f5f4', 'stone-200': '#e7e5e4',
  'stone-300': '#d6d3d1', 'stone-400': '#a8a29e', 'stone-500': '#78716c',
  'stone-600': '#57534e', 'stone-700': '#44403c', 'stone-800': '#292524', 'stone-900': '#1c1917', 'stone-950': '#0c0a09',
  // Red
  'red-50': '#fef2f2', 'red-100': '#fee2e2', 'red-200': '#fecaca',
  'red-300': '#fca5a5', 'red-400': '#f87171', 'red-500': '#ef4444',
  'red-600': '#dc2626', 'red-700': '#b91c1c', 'red-800': '#991b1b', 'red-900': '#7f1d1d', 'red-950': '#450a0a',
  // Orange
  'orange-50': '#fff7ed', 'orange-100': '#ffedd5', 'orange-200': '#fed7aa',
  'orange-300': '#fdba74', 'orange-400': '#fb923c', 'orange-500': '#f97316',
  'orange-600': '#ea580c', 'orange-700': '#c2410c', 'orange-800': '#9a3412', 'orange-900': '#7c2d12', 'orange-950': '#431407',
  // Amber
  'amber-50': '#fffbeb', 'amber-100': '#fef3c7', 'amber-200': '#fde68a',
  'amber-300': '#fcd34d', 'amber-400': '#fbbf24', 'amber-500': '#f59e0b',
  'amber-600': '#d97706', 'amber-700': '#b45309', 'amber-800': '#92400e', 'amber-900': '#78350f', 'amber-950': '#451a03',
  // Yellow
  'yellow-50': '#fefce8', 'yellow-100': '#fef9c3', 'yellow-200': '#fef08a',
  'yellow-300': '#fde047', 'yellow-400': '#facc15', 'yellow-500': '#eab308',
  'yellow-600': '#ca8a04', 'yellow-700': '#a16207', 'yellow-800': '#854d0e', 'yellow-900': '#713f12', 'yellow-950': '#422006',
  // Lime
  'lime-50': '#f7fee7', 'lime-100': '#ecfccb', 'lime-200': '#d9f99d',
  'lime-300': '#bef264', 'lime-400': '#a3e635', 'lime-500': '#84cc16',
  'lime-600': '#65a30d', 'lime-700': '#4d7c0f', 'lime-800': '#3f6212', 'lime-900': '#365314', 'lime-950': '#1a2e05',
  // Green
  'green-50': '#f0fdf4', 'green-100': '#dcfce7', 'green-200': '#bbf7d0',
  'green-300': '#86efac', 'green-400': '#4ade80', 'green-500': '#22c55e',
  'green-600': '#16a34a', 'green-700': '#15803d', 'green-800': '#166534', 'green-900': '#14532d', 'green-950': '#052e16',
  // Emerald
  'emerald-50': '#ecfdf5', 'emerald-100': '#d1fae5', 'emerald-200': '#a7f3d0',
  'emerald-300': '#6ee7b7', 'emerald-400': '#34d399', 'emerald-500': '#10b981',
  'emerald-600': '#059669', 'emerald-700': '#047857', 'emerald-800': '#065f46', 'emerald-900': '#064e3b', 'emerald-950': '#022c22',
  // Teal
  'teal-50': '#f0fdfa', 'teal-100': '#ccfbf1', 'teal-200': '#99f6e4',
  'teal-300': '#5eead4', 'teal-400': '#2dd4bf', 'teal-500': '#14b8a6',
  'teal-600': '#0d9488', 'teal-700': '#0f766e', 'teal-800': '#115e59', 'teal-900': '#134e4a', 'teal-950': '#042f2e',
  // Cyan
  'cyan-50': '#ecfeff', 'cyan-100': '#cffafe', 'cyan-200': '#a5f3fc',
  'cyan-300': '#67e8f9', 'cyan-400': '#22d3ee', 'cyan-500': '#06b6d4',
  'cyan-600': '#0891b2', 'cyan-700': '#0e7490', 'cyan-800': '#155e75', 'cyan-900': '#164e63', 'cyan-950': '#083344',
  // Sky
  'sky-50': '#f0f9ff', 'sky-100': '#e0f2fe', 'sky-200': '#bae6fd',
  'sky-300': '#7dd3fc', 'sky-400': '#38bdf8', 'sky-500': '#0ea5e9',
  'sky-600': '#0284c7', 'sky-700': '#0369a1', 'sky-800': '#075985', 'sky-900': '#0c4a6e', 'sky-950': '#082f49',
  // Blue
  'blue-50': '#eff6ff', 'blue-100': '#dbeafe', 'blue-200': '#bfdbfe',
  'blue-300': '#93c5fd', 'blue-400': '#60a5fa', 'blue-500': '#3b82f6',
  'blue-600': '#2563eb', 'blue-700': '#1d4ed8', 'blue-800': '#1e40af', 'blue-900': '#1e3a8a', 'blue-950': '#172554',
  // Indigo
  'indigo-50': '#eef2ff', 'indigo-100': '#e0e7ff', 'indigo-200': '#c7d2fe',
  'indigo-300': '#a5b4fc', 'indigo-400': '#818cf8', 'indigo-500': '#6366f1',
  'indigo-600': '#4f46e5', 'indigo-700': '#4338ca', 'indigo-800': '#3730a3', 'indigo-900': '#312e81', 'indigo-950': '#1e1b4b',
  // Violet
  'violet-50': '#f5f3ff', 'violet-100': '#ede9fe', 'violet-200': '#ddd6fe',
  'violet-300': '#c4b5fd', 'violet-400': '#a78bfa', 'violet-500': '#8b5cf6',
  'violet-600': '#7c3aed', 'violet-700': '#6d28d9', 'violet-800': '#5b21b6', 'violet-900': '#4c1d95', 'violet-950': '#2e1065',
  // Purple
  'purple-50': '#faf5ff', 'purple-100': '#f3e8ff', 'purple-200': '#e9d5ff',
  'purple-300': '#d8b4fe', 'purple-400': '#c084fc', 'purple-500': '#a855f7',
  'purple-600': '#9333ea', 'purple-700': '#7e22ce', 'purple-800': '#6b21a8', 'purple-900': '#581c87', 'purple-950': '#3b0764',
  // Fuchsia
  'fuchsia-50': '#fdf4ff', 'fuchsia-100': '#fae8ff', 'fuchsia-200': '#f5d0fe',
  'fuchsia-300': '#f0abfc', 'fuchsia-400': '#e879f9', 'fuchsia-500': '#d946ef',
  'fuchsia-600': '#c026d3', 'fuchsia-700': '#a21caf', 'fuchsia-800': '#86198f', 'fuchsia-900': '#701a75', 'fuchsia-950': '#4a044e',
  // Pink
  'pink-50': '#fdf2f8', 'pink-100': '#fce7f3', 'pink-200': '#fbcfe8',
  'pink-300': '#f9a8d4', 'pink-400': '#f472b6', 'pink-500': '#ec4899',
  'pink-600': '#db2777', 'pink-700': '#be185d', 'pink-800': '#9d174d', 'pink-900': '#831843', 'pink-950': '#500724',
  // Rose
  'rose-50': '#fff1f2', 'rose-100': '#ffe4e6', 'rose-200': '#fecdd3',
  'rose-300': '#fda4af', 'rose-400': '#fb7185', 'rose-500': '#f43f5e',
  'rose-600': '#e11d48', 'rose-700': '#be123c', 'rose-800': '#9f1239', 'rose-900': '#881337', 'rose-950': '#4c0519',
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

// ========== A1 TAILWIND-TOKEN + INLINE-STYLE CONTRAST COMPUTATION ==========
// Extracts text-*/bg-* Tailwind tokens AND inline style colors, traverses
// parent elements for background resolution, computes actual WCAG contrast
// ratio when both fg and bg are resolvable. Epistemic flags track source reliability.

type A1FgSource = 'tailwind_token' | 'inline_style';
type A1BgSource = 'tailwind_token' | 'inline_style' | 'assumed_default' | 'unresolved';
type A1EvidenceLevel = 'structural_deterministic' | 'structural_estimated';

// ===== INLINE STYLE COLOR HELPERS =====

/** Normalize shorthand hex (#fff → #ffffff) */
function normalizeHex(hex: string): string {
  hex = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    return '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  return hex;
}

/** Convert rgb(r, g, b) to hex */
function rgbStringToHex(rgb: string): string | null {
  const m = rgb.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (!m) return null;
  const r = Math.min(255, parseInt(m[1]));
  const g = Math.min(255, parseInt(m[2]));
  const b = Math.min(255, parseInt(m[3]));
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/** Parse a CSS color value (hex, rgb, named) → normalized hex or null */
function parseCssColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3,6}$/i.test(v)) return normalizeHex(v);
  if (v.startsWith('rgb')) return rgbStringToHex(v);
  // Small set of common named colors
  const named: Record<string, string> = {
    white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000',
    blue: '#0000ff', yellow: '#ffff00', transparent: '', inherit: '',
  };
  if (named[v] !== undefined) return named[v] || null;
  return null;
}

interface InlineStyleColors {
  fg: string | null;  // hex
  bg: string | null;  // hex
}

/**
 * Extract color/backgroundColor from a JSX style object:
 *   style={{ color: "#fff", backgroundColor: "rgb(22,163,106)" }}
 * or an HTML style string:
 *   style="color:#fff; background-color:#16a34a;"
 */
function extractInlineStyleColors(tagContent: string): InlineStyleColors {
  let fg: string | null = null;
  let bg: string | null = null;

  // --- JSX style object: style={{ ... }} ---
  const jsxStyleMatch = tagContent.match(/style\s*=\s*\{\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\s*\}/);
  if (jsxStyleMatch) {
    const inner = jsxStyleMatch[1];
    // color: "..." or color: '...'
    const colorM = inner.match(/\bcolor\s*:\s*["']([^"']+)["']/);
    if (colorM) fg = parseCssColor(colorM[1]);
    // backgroundColor: "..." or backgroundColor: '...'
    const bgColorM = inner.match(/backgroundColor\s*:\s*["']([^"']+)["']/);
    if (bgColorM) bg = parseCssColor(bgColorM[1]);
  }

  // --- HTML style string: style="..." ---
  if (!fg && !bg) {
    const htmlStyleMatch = tagContent.match(/style\s*=\s*"([^"]+)"/);
    if (htmlStyleMatch) {
      const styleStr = htmlStyleMatch[1];
      // color: ...;
      const colorM = styleStr.match(/(?:^|;)\s*color\s*:\s*([^;]+)/);
      if (colorM) fg = parseCssColor(colorM[1]);
      // background-color: ...;
      const bgColorM = styleStr.match(/background-color\s*:\s*([^;]+)/);
      if (bgColorM) bg = parseCssColor(bgColorM[1]);
    }
  }

  console.log("[A1] extracted fg:", fg, "bg:", bg, "from inline style");
  return { fg, bg };
}
type A1SizeStatus = 'normal' | 'large' | 'unknown';

interface A1TokenFinding {
  fgHex: string;
  fgClass: string;
  fgSource: A1FgSource;
  bgHex: string;
  bgClass: string | null;
  bgSource: A1BgSource;
  ratio: number | null;
  threshold: 4.5 | 3.0;
  sizeStatus: A1SizeStatus;
  evidenceLevel: A1EvidenceLevel;
  filePath: string;
  componentName?: string;
  elementContext?: string;
  jsxTag?: string;
  context: string;
  occurrence_count: number;
  textType: 'normal' | 'large';
  appliedThreshold: 4.5 | 3.0;
  wcagCriterion: '1.4.3';
}

// ===== A1 TEXT ELEMENT SCOPE =====
// Only these JSX/HTML tags contain readable text subject to WCAG 1.4.3.
const A1_TEXT_TAGS = new Set([
  'p', 'span', 'a', 'label', 'li', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'button', 'input', 'textarea',
  'strong', 'em', 'b', 'i', 'small', 'sub', 'sup',
  'blockquote', 'q', 'cite', 'abbr', 'code', 'pre',
  'dt', 'dd', 'figcaption', 'legend', 'caption',
  'summary', 'mark', 'time', 'address',
]);

// Tags that are never text content (always excluded)
const A1_EXCLUDED_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'g', 'use', 'defs', 'clipPath', 'mask', 'image']);

// Extract lucide-react icon imports to exclude them from A1 evaluation
function extractLucideImports(code: string): Set<string> {
  const icons = new Set<string>();
  const importRegex = /import\s*\{([^}]+)\}\s*from\s*["']lucide-react["']/g;
  let m;
  while ((m = importRegex.exec(code)) !== null) {
    const names = m[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean);
    for (const name of names) icons.add(name);
  }
  return icons;
}

// Check if a JSX tag represents a text-bearing element eligible for A1
function isTextElement(jsxTag: string | undefined, lucideIcons: Set<string>): boolean {
  if (!jsxTag) return true; // If tag unknown, be conservative and include
  
  const tagLower = jsxTag.toLowerCase();
  
  // Exclude SVG elements
  if (A1_EXCLUDED_TAGS.has(tagLower)) return false;
  
  // Exclude lucide-react icon components (PascalCase imports)
  if (lucideIcons.has(jsxTag)) return false;
  
  // For simple tags, check allowlist
  if (/^[a-z]/.test(jsxTag)) {
    return A1_TEXT_TAGS.has(tagLower);
  }
  
  // For compound tags (e.g., Card.Title), check if the last segment suggests text
  const lastSegment = jsxTag.split('.').pop()!;
  const textSegments = /^(Title|Description|Header|Label|Text|Caption|Name|Heading|Content|Footer|Subtitle)$/i;
  if (textSegments.test(lastSegment)) return true;
  
  // PascalCase components: include by default (could contain text), unless known icon
  return true;
}

const TW_COLOR_FAMILIES = 'gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black';

function extractJsxTag(code: string, matchIndex: number): string | undefined {
  // Scan backwards from the match to find the nearest JSX opening tag: <tagName ...>
  const scanStart = Math.max(0, matchIndex - 500);
  const before = code.slice(scanStart, matchIndex);
  // Match the last opening tag before the match position (not self-closing end or closing tag)
  const tagMatches = [...before.matchAll(/<([a-zA-Z][a-zA-Z0-9.]*)\s/g)];
  if (tagMatches.length > 0) {
    const lastTag = tagMatches[tagMatches.length - 1];
    return lastTag[1]; // e.g. "p", "span", "div", "Card.Title"
  }
  return undefined;
}

function extractTextColorTokens(code: string): Array<{ colorClass: string; colorName: string; context: string; matchIndex: number; jsxTag?: string }> {
  const results: Array<{ colorClass: string; colorName: string; context: string; matchIndex: number; jsxTag?: string }> = [];
  const textColorRegex = new RegExp(`text-(${TW_COLOR_FAMILIES})-?(\\d{2,3})?`, 'g');
  
  let match;
  while ((match = textColorRegex.exec(code)) !== null) {
    const colorClass = match[0];
    const colorName = match[1] + (match[2] ? `-${match[2]}` : '');
    const start = Math.max(0, match.index - 100);
    const end = Math.min(code.length, match.index + colorClass.length + 100);
    const context = code.slice(start, end).replace(/\n/g, ' ').trim();
    const jsxTag = extractJsxTag(code, match.index);
    results.push({ colorClass, colorName, context, matchIndex: match.index, jsxTag });
  }
  return results;
}

// Find the opening tag that contains the text-* class at textMatchIndex
function findContainingTagClasses(code: string, textMatchIndex: number): { tagStart: number; tagEnd: number; classes: string; tagName: string; tagContent: string } | null {
  let i = textMatchIndex;
  while (i >= 0 && code[i] !== '<') i--;
  if (i < 0) return null;
  const tagStart = i;
  const tagNameMatch = code.slice(tagStart).match(/^<\s*([A-Za-z][A-Za-z0-9_.]*)/);
  if (!tagNameMatch) return null;
  const tagName = tagNameMatch[1];
  let j = tagStart + 1;
  let braceDepth = 0;
  let inString: string | null = null;
  while (j < code.length) {
    const ch = code[j];
    if (inString) {
      if (ch === inString && code[j - 1] !== '\\') inString = null;
    } else if (braceDepth > 0) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      else if (ch === '"' || ch === "'" || ch === '`') inString = ch;
    } else {
      if (ch === '{') braceDepth++;
      else if (ch === '>' || (ch === '/' && j + 1 < code.length && code[j + 1] === '>')) {
        const tagEnd = ch === '/' ? j + 2 : j + 1;
        const tagContent = code.slice(tagStart, tagEnd);
        const classMatch = tagContent.match(/className\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`})/);
        const classes = classMatch ? (classMatch[1] || classMatch[2] || classMatch[3] || '') : '';
        return { tagStart, tagEnd, classes, tagName, tagContent };
      }
      else if (ch === '"' || ch === "'" || ch === '`') inString = ch;
    }
    j++;
  }
  return null;
}

/** Extract the full tag content string for a tag starting at pos */
function extractTagContent(code: string, pos: number): string | null {
  let end = pos + 1;
  let bd = 0;
  let inStr: string | null = null;
  while (end < code.length) {
    const ch = code[end];
    if (inStr) { if (ch === inStr && code[end - 1] !== '\\') inStr = null; }
    else if (bd > 0) {
      if (ch === '{') bd++;
      else if (ch === '}') bd--;
      else if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
    } else {
      if (ch === '{') bd++;
      else if (ch === '>' || (ch === '/' && end + 1 < code.length && code[end + 1] === '>')) {
        return code.slice(pos, end + (ch === '/' ? 2 : 1));
      }
      else if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
    }
    end++;
  }
  return null;
}

// Extract bg-* from a className string
function extractBgFromClasses(classes: string): { bgClass: string; bgName: string } | null {
  const bgRegex = new RegExp(`bg-(${TW_COLOR_FAMILIES})-?(\\d{2,3})?`);
  const m = classes.match(bgRegex);
  if (!m) return null;
  return { bgClass: m[0], bgName: m[1] + (m[2] ? `-${m[2]}` : '') };
}

// Walk up ancestor JSX elements to find the nearest bg-* class.
// Only considers actual ancestors (not siblings).
function findAncestorBg(code: string, tagStart: number): { bgClass: string; bgName: string; bgSourceType: 'ancestor' } | null {
  let pos = tagStart - 1;
  let depth = 0;
  
  while (pos >= 0) {
    // Check for closing tag end '>'
    if (code[pos] === '>') {
      let closeScan = pos - 1;
      while (closeScan >= 0 && code[closeScan] !== '<') closeScan--;
      if (closeScan >= 0 && closeScan + 1 < code.length && code[closeScan + 1] === '/') {
        depth++;
        pos = closeScan - 1;
        continue;
      }
    }
    
    // Check for opening tag start
    if (code[pos] === '<' && pos + 1 < code.length && code[pos + 1] !== '/' && code[pos + 1] !== '!') {
      if (depth > 0) {
        depth--;
        pos--;
        continue;
      }
      
      // depth === 0: genuine ancestor
      const tagNameM = code.slice(pos).match(/^<\s*([A-Za-z][A-Za-z0-9_.]*)/);
      if (tagNameM) {
        let end = pos + 1;
        let bd = 0;
        let inStr: string | null = null;
        while (end < code.length) {
          const ch = code[end];
          if (inStr) { if (ch === inStr && code[end - 1] !== '\\') inStr = null; }
          else if (bd > 0) {
            if (ch === '{') bd++;
            else if (ch === '}') bd--;
            else if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
          } else {
            if (ch === '{') bd++;
            else if (ch === '>' || (ch === '/' && end + 1 < code.length && code[end + 1] === '>')) break;
            else if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
          }
          end++;
        }
        const tagStr = code.slice(pos, end + 1);
        const classM = tagStr.match(/className\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`})/);
        const classes = classM ? (classM[1] || classM[2] || classM[3] || '') : '';
        const bg = extractBgFromClasses(classes);
        if (bg) return { ...bg, bgSourceType: 'ancestor' };
      }
      pos--;
      continue;
    }
    pos--;
  }
  return null;
}

// Resolve background for a text element: self → ancestor → assumed default
// Now also checks inline style colors on self and ancestors.
function resolveBackground(code: string, textMatchIndex: number): { bgClass: string | null; bgName: string | null; bgSourceType: 'self' | 'ancestor' | 'assumed_default'; inlineBgHex?: string } {
  const containingTag = findContainingTagClasses(code, textMatchIndex);
  if (containingTag) {
    // Check Tailwind bg-* on self
    const selfBg = extractBgFromClasses(containingTag.classes);
    if (selfBg) return { bgClass: selfBg.bgClass, bgName: selfBg.bgName, bgSourceType: 'self' };
    
    // Check inline style backgroundColor on self
    const selfInline = extractInlineStyleColors(containingTag.tagContent);
    if (selfInline.bg) return { bgClass: null, bgName: null, bgSourceType: 'self', inlineBgHex: selfInline.bg };
    
    // Check Tailwind bg-* on ancestors
    const ancestorBg = findAncestorBg(code, containingTag.tagStart);
    if (ancestorBg) return { bgClass: ancestorBg.bgClass, bgName: ancestorBg.bgName, bgSourceType: ancestorBg.bgSourceType };
    
    // Check inline style backgroundColor on ancestors
    const ancestorInlineBg = findAncestorInlineBg(code, containingTag.tagStart);
    if (ancestorInlineBg) return { bgClass: null, bgName: null, bgSourceType: 'ancestor', inlineBgHex: ancestorInlineBg };
  }
  
  return { bgClass: null, bgName: null, bgSourceType: 'assumed_default' };
}

/** Walk up ancestor JSX elements to find the nearest inline style backgroundColor */
function findAncestorInlineBg(code: string, tagStart: number): string | null {
  let pos = tagStart - 1;
  let depth = 0;
  while (pos >= 0) {
    if (code[pos] === '>') {
      let closeScan = pos - 1;
      while (closeScan >= 0 && code[closeScan] !== '<') closeScan--;
      if (closeScan >= 0 && closeScan + 1 < code.length && code[closeScan + 1] === '/') {
        depth++;
        pos = closeScan - 1;
        continue;
      }
    }
    if (code[pos] === '<' && pos + 1 < code.length && code[pos + 1] !== '/' && code[pos + 1] !== '!') {
      if (depth > 0) { depth--; pos--; continue; }
      const tc = extractTagContent(code, pos);
      if (tc) {
        const inlineColors = extractInlineStyleColors(tc);
        if (inlineColors.bg) return inlineColors.bg;
      }
      pos--;
      continue;
    }
    pos--;
  }
  return null;
}

// Best-effort text size inference from surrounding code context
function inferTextSize(context: string): A1SizeStatus {
  const lower = context.toLowerCase();
  if (/text-(3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/.test(context)) return 'large';
  if (/text-2xl\b/.test(context) && /font-(bold|extrabold|black|semibold)\b/.test(context)) return 'large';
  if (/<h[12]\b/.test(lower)) return 'large';
  if (/text-(xs|sm)\b/.test(context)) return 'normal';
  if (/<(p|span|label|td|li)\b/.test(lower)) return 'normal';
  return 'unknown';
}

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
  // Epistemic fields for Tailwind-token contrast computation
  fgSource?: A1FgSource;
  bgSource?: A1BgSource;
  evidenceLevel?: A1EvidenceLevel;
  sizeStatus?: A1SizeStatus;
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

function analyzeContrastInCode(files: Map<string, string>): ContrastViolation[] {
  const a1Findings: A1TokenFinding[] = [];
  
  for (const [filepath, content] of files) {
    let componentName = filepath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];
    
    // Build set of lucide-react icon imports for this file
    const lucideIcons = extractLucideImports(content);
    
    const textTokens = extractTextColorTokens(content);
    
    for (const { colorClass, colorName, context, matchIndex, jsxTag } of textTokens) {
      const fgHex = TAILWIND_COLORS[colorName];
      if (!fgHex) continue; // Unknown token — skip
      
      // --- WCAG 1.4.3 SCOPE FILTER ---
      // Only evaluate text-bearing elements; exclude SVGs, icons, non-text tags
      if (!isTextElement(jsxTag, lucideIcons)) continue;
      
      // --- Background resolution (ancestor-only, no sibling leakage) ---
      let bgHex: string;
      let bgClass: string | null = null;
      let bgSource: A1BgSource;
      
      const resolved = resolveBackground(content, matchIndex);
      if (resolved.inlineBgHex) {
        bgHex = resolved.inlineBgHex;
        bgClass = null;
        bgSource = 'inline_style';
        console.log("[A1] Tailwind fg + inline bg:", fgHex, bgHex, "in", filepath);
      } else if (resolved.bgName && TAILWIND_COLORS[resolved.bgName]) {
        bgHex = TAILWIND_COLORS[resolved.bgName];
        bgClass = resolved.bgClass;
        bgSource = 'tailwind_token';
      } else {
        bgHex = '#ffffff';
        bgSource = 'assumed_default';
      }
      
      // --- Contrast computation ---
      const ratio = getContrastRatio(fgHex, bgHex);
      
      // --- Size inference & WCAG 1.4.3 threshold ---
      const sizeStatus = inferTextSize(context);
      const textType: 'normal' | 'large' = sizeStatus === 'large' ? 'large' : 'normal';
      const threshold: 4.5 | 3.0 = textType === 'large' ? 3.0 : 4.5;
      
      const evidenceLevel: A1EvidenceLevel = bgSource === 'tailwind_token' || bgSource === 'inline_style'
        ? 'structural_deterministic'
        : 'structural_estimated';
      
      const elementContext = inferElementContext(context);
      
      // Only report if ratio fails threshold
      if (ratio !== null && ratio >= threshold) continue; // PASS
      
      a1Findings.push({
        fgHex,
        fgClass: colorClass,
        fgSource: 'tailwind_token',
        bgHex,
        bgClass,
        bgSource,
        ratio,
        threshold,
        sizeStatus,
        evidenceLevel,
        filePath: filepath,
        componentName: componentName || undefined,
        elementContext: elementContext || undefined,
        jsxTag,
        context,
        occurrence_count: 1,
        textType,
        appliedThreshold: threshold,
        wcagCriterion: '1.4.3',
      });
    }

    // ===== PASS 2: Inline JSX style objects =====
    const styleRegex = /style\s*=\s*\{\s*\{/g;
    let styleMatch;
    while ((styleMatch = styleRegex.exec(content)) !== null) {
      const containingTag = findContainingTagClasses(content, styleMatch.index);
      if (!containingTag) continue;
      const jsxTag = containingTag.tagName;
      if (!isTextElement(jsxTag, lucideIcons)) continue;
      const inlineColors = extractInlineStyleColors(containingTag.tagContent);
      if (!inlineColors.fg) continue;
      const fgHex = inlineColors.fg;
      let bgHex: string;
      let bgSource: A1BgSource;
      if (inlineColors.bg) {
        bgHex = inlineColors.bg;
        bgSource = 'inline_style';
      } else {
        const resolved = resolveBackground(content, styleMatch.index);
        if (resolved.inlineBgHex) { bgHex = resolved.inlineBgHex; bgSource = 'inline_style'; }
        else if (resolved.bgName && TAILWIND_COLORS[resolved.bgName]) { bgHex = TAILWIND_COLORS[resolved.bgName]; bgSource = 'tailwind_token'; }
        else { bgHex = '#ffffff'; bgSource = 'assumed_default'; }
      }
      console.log("[A1] inline style fg:", fgHex, "bg:", bgHex, "tag:", jsxTag, "in", filepath);
      const ratio = getContrastRatio(fgHex, bgHex);
      const ctxStart = Math.max(0, styleMatch.index - 100);
      const ctxEnd = Math.min(content.length, styleMatch.index + 200);
      const context = content.slice(ctxStart, ctxEnd).replace(/\n/g, ' ').trim();
      const sizeStatus = inferTextSize(context);
      const textType: 'normal' | 'large' = sizeStatus === 'large' ? 'large' : 'normal';
      const threshold: 4.5 | 3.0 = textType === 'large' ? 3.0 : 4.5;
      if (ratio !== null && ratio >= threshold) continue;
      a1Findings.push({
        fgHex, fgClass: `style:color(${fgHex})`, fgSource: 'inline_style',
        bgHex, bgClass: null, bgSource, ratio, threshold, sizeStatus,
        evidenceLevel: bgSource === 'assumed_default' ? 'structural_estimated' : 'structural_deterministic',
        filePath: filepath, componentName: componentName || undefined,
        elementContext: inferElementContext(context) || undefined,
        jsxTag, context, occurrence_count: 1, textType,
        appliedThreshold: threshold, wcagCriterion: '1.4.3',
      });
    }

    // ===== PASS 3: HTML style strings =====
    const htmlStyleRegex = /style\s*=\s*"([^"]+)"/g;
    let htmlMatch;
    while ((htmlMatch = htmlStyleRegex.exec(content)) !== null) {
      const styleStr = htmlMatch[1];
      const colorM = styleStr.match(/(?:^|;)\s*color\s*:\s*([^;]+)/);
      if (!colorM) continue;
      const fgHex = parseCssColor(colorM[1]);
      if (!fgHex) continue;
      const containingTag = findContainingTagClasses(content, htmlMatch.index);
      if (!containingTag) continue;
      const jsxTag = containingTag.tagName;
      if (!isTextElement(jsxTag, lucideIcons)) continue;
      let bgHex: string;
      let bgSource: A1BgSource;
      const bgColorM = styleStr.match(/background-color\s*:\s*([^;]+)/);
      if (bgColorM) {
        const parsed = parseCssColor(bgColorM[1]);
        if (parsed) { bgHex = parsed; bgSource = 'inline_style'; }
        else { bgHex = '#ffffff'; bgSource = 'assumed_default'; }
      } else {
        const resolved = resolveBackground(content, htmlMatch.index);
        if (resolved.inlineBgHex) { bgHex = resolved.inlineBgHex; bgSource = 'inline_style'; }
        else if (resolved.bgName && TAILWIND_COLORS[resolved.bgName]) { bgHex = TAILWIND_COLORS[resolved.bgName]; bgSource = 'tailwind_token'; }
        else { bgHex = '#ffffff'; bgSource = 'assumed_default'; }
      }
      console.log("[A1] HTML style fg:", fgHex, "bg:", bgHex, "tag:", jsxTag, "in", filepath);
      const ratio = getContrastRatio(fgHex, bgHex);
      const ctxStart = Math.max(0, htmlMatch.index - 100);
      const ctxEnd = Math.min(content.length, htmlMatch.index + 200);
      const context = content.slice(ctxStart, ctxEnd).replace(/\n/g, ' ').trim();
      const sizeStatus = inferTextSize(context);
      const textType: 'normal' | 'large' = sizeStatus === 'large' ? 'large' : 'normal';
      const threshold: 4.5 | 3.0 = textType === 'large' ? 3.0 : 4.5;
      if (ratio !== null && ratio >= threshold) continue;
      a1Findings.push({
        fgHex, fgClass: `style:color(${fgHex})`, fgSource: 'inline_style',
        bgHex, bgClass: null, bgSource, ratio, threshold, sizeStatus,
        evidenceLevel: bgSource === 'assumed_default' ? 'structural_estimated' : 'structural_deterministic',
        filePath: filepath, componentName: componentName || undefined,
        elementContext: inferElementContext(context) || undefined,
        jsxTag, context, occurrence_count: 1, textType,
        appliedThreshold: threshold, wcagCriterion: '1.4.3',
      });
    }
  }
  
  if (a1Findings.length === 0) return [];
  
  const dedupeMap = new Map<string, A1TokenFinding>();
  for (const finding of a1Findings) {
    const key = `${finding.fgClass}:${finding.bgSource}:${finding.bgHex}:${finding.filePath}`;
    if (dedupeMap.has(key)) {
      dedupeMap.get(key)!.occurrence_count += 1;
    } else {
      dedupeMap.set(key, { ...finding });
    }
  }
  
  const results: ContrastViolation[] = [];
  
  for (const finding of dedupeMap.values()) {
    const fileName = finding.filePath.split('/').pop() || finding.filePath;
    const elementIdentifier = finding.componentName
      ? `${finding.componentName} (${fileName})`
      : fileName;
    
    // Classification: Confirmed only when both fg AND bg are from Tailwind tokens
    const isConfirmed = finding.bgSource === 'tailwind_token' && finding.ratio !== null && finding.ratio < finding.threshold;
    const status: 'confirmed' | 'potential' = isConfirmed ? 'confirmed' : 'potential';
    
    // Reason codes
    const reasonCodes: string[] = ['STATIC_ANALYSIS'];
    if (finding.bgSource === 'assumed_default') reasonCodes.push('BG_ASSUMED_DEFAULT');
    if (finding.bgSource === 'unresolved') reasonCodes.push('BG_UNRESOLVED');
    if (finding.sizeStatus === 'unknown') reasonCodes.push('SIZE_UNKNOWN');
    
    // Risk level from ratio
    let riskLevel: 'high' | 'medium' | 'low' = 'medium';
    if (finding.ratio !== null) {
      if (finding.ratio < 2.5) riskLevel = 'high';
      else if (finding.ratio < 3.5) riskLevel = 'medium';
      else riskLevel = 'low';
    }
    
    const ratioStr = finding.ratio !== null ? `${finding.ratio.toFixed(2)}:1` : 'not computable';
    const bgNote = finding.bgSource === 'assumed_default'
      ? ' (background assumed #FFFFFF — no bg token found)'
      : finding.bgSource === 'inline_style'
        ? ` (background from inline style ${finding.bgHex})`
        : finding.bgSource === 'unresolved'
          ? ' (background unresolved)'
          : ` (background from ${finding.bgClass})`;
    
    const diagnosis = `Text ${finding.fgClass} (${finding.fgHex}) on ${finding.bgHex}${bgNote} — ` +
      `contrast ratio ${ratioStr} vs ${finding.threshold}:1 required (${finding.sizeStatus === 'large' ? 'large' : 'normal'} text).`;
    
    let correctivePrompt = '';
    if (isConfirmed) {
      correctivePrompt = `• ${finding.elementContext || 'Text element'} "${finding.fgClass}" in ${elementIdentifier}\n` +
        `  Issue: ${ratioStr} vs ${finding.threshold}:1 required\n` +
        `  Fix: Replace ${finding.fgClass} with a darker token (e.g., ${finding.fgClass.replace(/\d+$/, '700')}) ` +
        `or lighten background from ${finding.bgClass || finding.bgHex} to ensure ≥ ${finding.threshold}:1.`;
    }
    
    const advisoryGuidance = isConfirmed ? undefined :
      `Verify contrast in browser DevTools. Computed ratio: ${ratioStr}. ` +
      `If background differs from ${finding.bgHex}, re-check.`;
    
    results.push({
      ruleId: 'A1',
      ruleName: 'Insufficient text contrast',
      category: 'accessibility',
      status,
      samplingMethod: 'inferred',
      inputType: 'zip',
      contrastRatio: finding.ratio ?? undefined,
      thresholdUsed: finding.threshold,
      foregroundHex: finding.fgHex,
      backgroundHex: finding.bgHex,
      elementIdentifier,
      elementDescription: finding.elementContext,
      evidence: `${finding.fgClass}${finding.bgClass ? ` on ${finding.bgClass}` : ''} in ${finding.filePath}`,
      diagnosis,
      contextualHint: `Contrast ${ratioStr} — ${finding.evidenceLevel.replace(/_/g, ' ')}.`,
      correctivePrompt,
      confidence: isConfirmed ? 0.90 : (finding.bgSource === 'assumed_default' ? 0.55 : 0.40),
      riskLevel,
      reasonCodes: isConfirmed ? undefined : reasonCodes,
      potentialRiskReason: isConfirmed ? undefined : `Background source: ${finding.bgSource.replace(/_/g, ' ')}.`,
      backgroundStatus: finding.bgSource === 'tailwind_token' ? 'certain' : 'uncertain',
      blocksConvergence: isConfirmed,
      inputLimitation: finding.bgSource !== 'tailwind_token' ? `Background inferred (${finding.bgSource.replace(/_/g, ' ')}); verify at runtime.` : undefined,
      advisoryGuidance,
      fgSource: finding.fgSource,
      bgSource: finding.bgSource,
      evidenceLevel: finding.evidenceLevel,
      sizeStatus: finding.sizeStatus,
      affectedComponents: [{
        colorClass: finding.fgClass,
        hexColor: finding.fgHex,
        filePath: finding.filePath,
        componentName: finding.componentName,
        elementContext: finding.elementContext,
        jsxTag: finding.jsxTag,
        riskLevel,
        occurrence_count: finding.occurrence_count,
      }],
    });
  }
  
  const confirmed = results.filter(r => r.status === 'confirmed').length;
  const potential = results.filter(r => r.status === 'potential').length;
  console.log(`A1 token-contrast (ZIP): ${results.length} findings (${confirmed} confirmed, ${potential} potential)`);
  
  return results;
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
// Supports multiline JSX opening tags by extracting full tag blocks.

interface A3Finding {
  elementLabel: string;
  elementType: string;
  role?: string;
  sourceLabel: string;
  filePath: string;
  lineNumber: number;
  componentName?: string;
  classificationCode: string; // A3-C1, A3-C2, A3-C3, A3-P1
  classification: 'confirmed' | 'potential';
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  correctivePrompt?: string;
  deduplicationKey: string;
  detectedHandlers: string[];
  missingFeatures: string[];
}

/**
 * Extract multiline JSX opening tags from source.
 * Returns array of { tag, attrs, index, fullMatch } handling arrow functions inside attribute values.
 */
function extractJsxOpeningTags(content: string, tagPattern: string): Array<{tag: string; attrs: string; index: number; fullMatch: string}> {
  const results: Array<{tag: string; attrs: string; index: number; fullMatch: string}> = [];
  const openRegex = new RegExp(`<(${tagPattern})\\b`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = openRegex.exec(content)) !== null) {
    const startIdx = m.index;
    let i = startIdx + m[0].length;
    let depth = 0; // track { } depth for JSX expressions
    let inString: string | null = null;
    let inTemplateLiteral = false;
    let found = false;
    while (i < content.length) {
      const ch = content[i];
      if (inString) {
        if (ch === inString && content[i - 1] !== '\\') inString = null;
        i++; continue;
      }
      if (inTemplateLiteral) {
        if (ch === '`' && content[i - 1] !== '\\') inTemplateLiteral = false;
        i++; continue;
      }
      if (ch === '"' || ch === "'") { inString = ch; i++; continue; }
      if (ch === '`') { inTemplateLiteral = true; i++; continue; }
      if (ch === '{') { depth++; i++; continue; }
      if (ch === '}') { depth--; i++; continue; }
      if (depth === 0 && ch === '>') {
        const fullMatch = content.slice(startIdx, i + 1);
        const attrs = content.slice(startIdx + m[0].length, i);
        results.push({ tag: m[1], attrs, index: startIdx, fullMatch });
        found = true;
        break;
      }
      // Self-closing />
      if (depth === 0 && ch === '/' && i + 1 < content.length && content[i + 1] === '>') {
        const fullMatch = content.slice(startIdx, i + 2);
        const attrs = content.slice(startIdx + m[0].length, i);
        results.push({ tag: m[1], attrs, index: startIdx, fullMatch });
        found = true;
        break;
      }
      i++;
    }
    if (!found) continue;
  }
  return results;
}

/** Check if position is inside a native interactive ancestor (button, a, input, etc.) */
function isInsideInteractiveAncestor(content: string, position: number): boolean {
  // Look backwards for unclosed native interactive tags
  const precedingContent = content.slice(0, position);
  const nativeTags = ['button', 'a', 'input', 'select', 'textarea', 'label', 'details'];
  for (const tag of nativeTags) {
    // Count opens and closes
    const openRegex = new RegExp(`<${tag}\\b`, 'gi');
    const closeRegex = new RegExp(`</${tag}\\s*>`, 'gi');
    let opens = 0, closes = 0;
    let om;
    while ((om = openRegex.exec(precedingContent)) !== null) opens++;
    while ((om = closeRegex.exec(precedingContent)) !== null) closes++;
    if (opens > closes) return true;
  }
  return false;
}

/** Check if element is a <summary> inside <details> */
function isSummaryInDetails(content: string, position: number, tag: string): boolean {
  if (tag.toLowerCase() !== 'summary') return false;
  return isInsideInteractiveAncestor(content, position); // details is in the list
}

// ============================================================
// A2 Focus Visibility — Fully Deterministic Detection
// ============================================================

interface A2Finding {
  elementLabel: string;
  elementType: string;
  sourceLabel: string;
  filePath: string;
  lineNumber: number;
  componentName: string;
  classification: 'confirmed' | 'potential';
  detection: string;
  explanation: string;
  confidence: number;
  focusClasses: string[];
  correctivePrompt?: string;
  potentialSubtype?: 'borderline';
  potentialReason?: string;
  deduplicationKey: string;
  _a2Debug: {
    outlineRemoved: boolean;
    hasStrongReplacement: boolean;
    hasWeakFocusStyling: boolean;
    matchedTokens: string[];
  };
}

function detectA2FocusVisibility(allFiles: Map<string, string>): A2Finding[] {
  const findings: A2Finding[] = [];
  const seenKeys = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    const fileName = filePath.split('/').pop() || filePath;

    // Find all className attributes in the file
    const classNameRegex = /className\s*=\s*(?:"([^"]+)"|'([^']+)'|\{[^}]*(?:`([^`]+)`|["']([^"']+)["'])[^}]*\})/g;
    // Also find class= for HTML files
    const classRegex = /\bclass\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
    // Also find cva/cn base strings
    const cvaBaseRegex = /(?:cva|cn)\(\s*["'`]([^"'`]+)["'`]/g;

    const classStrings: Array<{ classStr: string; line: number }> = [];

    // Collect all class strings with their line numbers
    let match;
    while ((match = classNameRegex.exec(content)) !== null) {
      const classStr = match[1] || match[2] || match[3] || match[4] || '';
      if (!classStr) continue;
      const line = content.slice(0, match.index).split('\n').length;
      classStrings.push({ classStr, line });
    }
    while ((match = classRegex.exec(content)) !== null) {
      const classStr = match[1] || match[2] || '';
      if (!classStr) continue;
      const line = content.slice(0, match.index).split('\n').length;
      classStrings.push({ classStr, line });
    }
    while ((match = cvaBaseRegex.exec(content)) !== null) {
      const classStr = match[1] || '';
      if (!classStr) continue;
      const line = content.slice(0, match.index).split('\n').length;
      classStrings.push({ classStr, line });
    }

    for (const { classStr, line } of classStrings) {
      // Split into tokens
      const tokens = classStr.split(/\s+/).filter(Boolean);

      // STEP 1: Check outline removal
      const outlineRemovalTokens = tokens.filter(t =>
        t === 'outline-none' ||
        t === 'focus:outline-none' ||
        t === 'focus-visible:outline-none'
      );
      const outlineRemoved = outlineRemovalTokens.length > 0;
      if (!outlineRemoved) continue;

      // STEP 2: Check strong replacement (focus-scoped only)
      const strongReplacementTokens = tokens.filter(t =>
        /^focus(?:-visible)?:ring-(?!0$)/i.test(t) ||
        /^focus(?:-visible)?:border-(?!0$|none$)/i.test(t) ||
        /^focus(?:-visible)?:shadow-(?!none$)/i.test(t) ||
        /^focus(?:-visible)?:outline-(?!none$)/i.test(t)
      );
      const hasStrongReplacement = strongReplacementTokens.length > 0;

      if (hasStrongReplacement) {
        console.log(`A2 PASS (deterministic): ${filePath}:${line} — strong replacement [${strongReplacementTokens.join(', ')}]`);
        continue;
      }

      // STEP 3: Check weak focus styling (focus-scoped only)
      const weakFocusTokens = tokens.filter(t =>
        /^focus(?:-visible)?:bg-/i.test(t) ||
        /^focus(?:-visible)?:text-/i.test(t) ||
        /^focus(?:-visible)?:underline$/i.test(t) ||
        /^focus(?:-visible)?:opacity-/i.test(t) ||
        /^focus(?:-visible)?:font-/i.test(t)
      );
      const hasWeakFocusStyling = weakFocusTokens.length > 0;

      // Determine element type from surrounding context
      const contextBefore = content.slice(Math.max(0, content.lastIndexOf('\n', content.indexOf(classStr) - 1)), content.indexOf(classStr));
      let elementType = 'interactive element';
      if (/\bbutton\b|<button|<Button/i.test(contextBefore)) elementType = 'button';
      else if (/\binput\b|<input|<Input/i.test(contextBefore)) elementType = 'input';
      else if (/\bselect\b|<select|<Select/i.test(contextBefore)) elementType = 'select';
      else if (/\btextarea\b|<textarea|<Textarea/i.test(contextBefore)) elementType = 'textarea';
      else if (/\bmenuitem|MenuItem|DropdownMenu|ContextMenu/i.test(contextBefore)) elementType = 'menuitem';
      else if (/\btab\b|<Tab/i.test(contextBefore)) elementType = 'tab';
      else if (/\ba\b|<a\b|<Link/i.test(contextBefore)) elementType = 'link';

      const isBorderline = hasWeakFocusStyling;
      const allMatchedTokens = [...outlineRemovalTokens, ...(isBorderline ? weakFocusTokens : [])];

      const dedupeKey = `${filePath}|${componentName}|${line}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      let detection: string;
      if (isBorderline) {
        const details = [...outlineRemovalTokens, ...weakFocusTokens].join(', ');
        detection = `Focus indicated only by background/text color change (${details}) after outline removal — contrast not verifiable statically`;
      } else {
        detection = `Focus indicator removed (${outlineRemovalTokens.join(', ')}) without visible replacement`;
      }

      const explanation = isBorderline
        ? 'Issue reason: Outline removed; focus relies only on bg/text change; contrast can\'t be verified statically.\n\nRecommended fix: Add a clear focus-visible indicator (e.g., focus-visible:ring-2 + focus-visible:ring-offset-2) or restore outline.'
        : 'Element removes the default browser outline without providing a visible focus replacement.';

      const confidence = isBorderline ? 0.68 : 0.92;
      const sourceLabel = componentName || fileName.replace(/\.\w+$/, '');

      console.log(`A2 ${isBorderline ? 'BORDERLINE' : 'CONFIRMED'} (deterministic): ${filePath}:${line} tokens=[${allMatchedTokens.join(',')}]`);

      findings.push({
        elementLabel: sourceLabel,
        elementType,
        sourceLabel,
        filePath,
        lineNumber: line,
        componentName,
        classification: isBorderline ? 'potential' : 'confirmed',
        detection,
        explanation,
        confidence,
        focusClasses: allMatchedTokens,
        correctivePrompt: isBorderline ? undefined : `[${sourceLabel} ${elementType}] — ${filePath}\n\nIssue reason:\nFocus indicator is removed (${outlineRemovalTokens.join(', ')}) without a visible replacement.\n\nRecommended fix:\nAdd a visible keyboard focus style using :focus-visible (e.g., focus-visible:ring-2 focus-visible:ring-offset-2) and apply consistently across all instances.`,
        potentialSubtype: isBorderline ? 'borderline' : undefined,
        potentialReason: isBorderline ? 'Custom focus styles exist but perceptibility cannot be statically verified.' : undefined,
        deduplicationKey: dedupeKey,
        _a2Debug: {
          outlineRemoved,
          hasStrongReplacement,
          hasWeakFocusStyling,
          matchedTokens: allMatchedTokens,
        },
      });
    }
  }

  return findings;
}

const NON_INTERACTIVE_TAGS = 'div|span|p|li|section|article|header|footer|main|aside|nav|figure|figcaption|dd|dt|dl|summary';
const INTERACTIVE_ROLES_RE = /\brole\s*=\s*["'](button|link|menuitem|tab|option|checkbox|radio|switch|combobox|listbox|slider|treeitem|gridcell)["']/i;
const POINTER_HANDLER_RE = /\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/;
const KEY_HANDLER_RE = /\b(onKeyDown|onKeyUp|onKeyPress)\s*=/;

function detectA3KeyboardOperability(allFiles: Map<string, string>): A3Finding[] {
  const findings: A3Finding[] = [];
  const seenKeys = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js)$/.test(filePath)) continue;
    // Skip test/spec files and UI library primitives
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    const fileName = filePath.split('/').pop() || filePath;

    // ── A3-C1: Non-semantic elements with pointer handlers but missing keyboard support ──
    const nonInteractiveTags = extractJsxOpeningTags(content, NON_INTERACTIVE_TAGS);
    for (const { tag, attrs, index, fullMatch } of nonInteractiveTags) {
      // Must have a pointer handler
      if (!POINTER_HANDLER_RE.test(attrs)) continue;
      // Skip aria-hidden
      if (/aria-hidden\s*=\s*["']\s*true\s*["']/i.test(attrs)) continue;
      if (/aria-hidden\s*=\s*\{\s*true\s*\}/i.test(attrs)) continue;

      // Exemption: inside native interactive ancestor
      if (isInsideInteractiveAncestor(content, index)) continue;
      // Exemption: <summary> inside <details>
      if (isSummaryInDetails(content, index, tag)) continue;

      // Check what's present
      const hasRole = INTERACTIVE_ROLES_RE.test(attrs);
      const hasTabIndex = /tabIndex\s*=\s*\{?\s*(\d+)\s*\}?/i.test(attrs) || /tabindex\s*=\s*["'](\d+)["']/i.test(attrs);
      const hasNegTabIndex = /tabIndex\s*=\s*\{?\s*-1\s*\}?/i.test(attrs) || /tabindex\s*=\s*["']-1["']/i.test(attrs);
      const hasKeyHandler = KEY_HANDLER_RE.test(attrs);

      // Exemption: has role + tabIndex>=0 + key handler → fully accessible
      if (hasRole && hasTabIndex && hasKeyHandler) continue;

      // A3-C1: If ANY required feature is missing → Confirmed
      const missingFeatures: string[] = [];
      if (!hasRole) missingFeatures.push('missing role');
      if (!hasTabIndex && !hasNegTabIndex) missingFeatures.push('missing tabIndex');
      if (hasNegTabIndex) missingFeatures.push('tabIndex={-1}');
      if (!hasKeyHandler) missingFeatures.push('missing onKeyDown');

      if (missingFeatures.length === 0) continue;

      // Extract detected handlers
      const detectedHandlers: string[] = [];
      const handlerMatches = attrs.matchAll(/\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/g);
      for (const hm of handlerMatches) detectedHandlers.push(hm[1]);

      // Label extraction
      const ariaLabelMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const titleMatch = attrs.match(/title\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const testIdMatch = attrs.match(/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/);
      const afterTag = content.slice(index + fullMatch.length, Math.min(content.length, index + fullMatch.length + 300));
      const childTextMatch = afterTag.match(/^([^<]{1,80})/);
      const innerText = childTextMatch?.[1]?.trim();

      const label = ariaLabelMatch?.[1] || ariaLabelMatch?.[2]
        || (innerText && innerText.length > 0 && innerText.length <= 60 ? innerText : null)
        || titleMatch?.[1] || titleMatch?.[2]
        || testIdMatch?.[1] || testIdMatch?.[2] || testIdMatch?.[3]
        || `Clickable ${tag} (${detectedHandlers[0] || 'onClick'})`;

      const lineNumber = content.slice(0, index).split('\n').length;
      const triggerHandler = detectedHandlers[0] || 'onClick';

      const dedupeKey = `${filePath}|${tag}|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      console.log(`A3-C1 CONFIRMED: ${filePath}:${lineNumber} <${tag}> handlers=[${detectedHandlers}] missing=[${missingFeatures}]`);

      findings.push({
        elementLabel: label, elementType: tag, sourceLabel: label, filePath, lineNumber, componentName,
        classificationCode: 'A3-C1', classification: 'confirmed',
        detection: `${triggerHandler} on non-semantic <${tag}> element`,
        evidence: `<${tag} ${triggerHandler}=...> at ${filePath}:${lineNumber} — ${missingFeatures.join(', ')}`,
        explanation: `This <${tag}> has ${detectedHandlers.join(', ')} but ${missingFeatures.join(', ')}. Keyboard users cannot reach or activate it.`,
        confidence: 0.92,
        correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nThis ${tag} uses ${triggerHandler} but is not keyboard operable because it ${missingFeatures.join(', ')}.\n\nRecommended fix:\nReplace it with a <button type="button"> (or <a href> if navigation). If you must keep a ${tag}, add role="button", tabIndex={0}, and an onKeyDown handler for Enter/Space, and ensure :focus-visible styling.`,
        deduplicationKey: dedupeKey,
        detectedHandlers,
        missingFeatures,
      });
    }

    // ── A3-C2: tabIndex={-1} on native interactive elements ──
    const nativeInteractiveTags = extractJsxOpeningTags(content, 'button|a|input|select|textarea');
    for (const { tag, attrs, index } of nativeInteractiveTags) {
      if (!/tabIndex\s*=\s*\{?\s*-1\s*\}?/i.test(attrs) && !/tabindex\s*=\s*["']-1["']/i.test(attrs)) continue;
      // Skip hidden/disabled elements
      if (/aria-hidden\s*=\s*["']?true/i.test(attrs) || /\bhidden\b/.test(attrs)) continue;
      if (/sr-only|visually-hidden|clip-path/i.test(attrs)) continue;
      if (/\bdisabled\b/i.test(attrs) || /aria-disabled\s*=\s*["']?true/i.test(attrs)) continue;
      // Skip pointer-events:none with disabled
      if (/pointer-events\s*:\s*none/i.test(attrs) && (/\bdisabled\b/i.test(attrs) || /aria-disabled/i.test(attrs))) continue;

      const ariaLabel = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = ariaLabel?.[1] || ariaLabel?.[2] || `<${tag}> element`;
      const lineNumber = content.slice(0, index).split('\n').length;
      const dedupeKey = `${filePath}|tabindex-neg|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      console.log(`A3-C2 CONFIRMED: ${filePath}:${lineNumber} <${tag}> tabIndex={-1}`);

      findings.push({
        elementLabel: label, elementType: tag, sourceLabel: label, filePath, lineNumber, componentName,
        classificationCode: 'A3-C2', classification: 'confirmed',
        detection: `tabIndex={-1} on <${tag}>`,
        evidence: `<${tag} tabIndex={-1}> at ${filePath}:${lineNumber} — removed from tab order`,
        explanation: `Primary interactive <${tag}> has tabIndex={-1}, removing it from keyboard tab order.`,
        confidence: 0.90,
        correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nThis ${tag} has tabIndex={-1}, removing it from keyboard tab order. Keyboard users cannot reach it via Tab.\n\nRecommended fix:\nRemove tabIndex={-1} to restore default focusability. If the element must be removed from tab order, provide an alternative keyboard-accessible path.`,
        deduplicationKey: dedupeKey,
        detectedHandlers: [],
        missingFeatures: ['tabIndex={-1}'],
      });
    }

    // ── A3-C3: Focus traps (strict static evidence only → Confirmed; otherwise Potential) ──
    // Look for keydown handlers that intercept Tab + preventDefault
    const keydownBlocks = content.matchAll(/onKeyDown\s*=\s*\{([^}]{10,500})\}/g);
    for (const km of keydownBlocks) {
      const block = km[1];
      if (/Tab/i.test(block) && /preventDefault/i.test(block)) {
        // Check for escape paths
        const hasEscape = /Escape|Esc/i.test(block);
        const lineNumber = content.slice(0, km.index!).split('\n').length;
        const classification = hasEscape ? 'potential' as const : 'confirmed' as const;
        const code = hasEscape ? 'A3-C3' : 'A3-C3';
        const dedupeKey = `${filePath}|focus-trap|${lineNumber}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        console.log(`A3-C3 ${classification.toUpperCase()}: ${filePath}:${lineNumber} focus trap (Tab+preventDefault${hasEscape ? ', has Escape' : ''})`);

        findings.push({
          elementLabel: 'Focus trap', elementType: 'handler', sourceLabel: 'Focus trap', filePath, lineNumber, componentName,
          classificationCode: code, classification,
          detection: `onKeyDown intercepts Tab with preventDefault`,
          evidence: `onKeyDown handler at ${filePath}:${lineNumber} — Tab + preventDefault${hasEscape ? ' (Escape path exists)' : ' (no escape path)'}`,
          explanation: hasEscape
            ? `Tab interception detected but Escape key path may exist. Verify focus can be released.`
            : `Tab interception with preventDefault and no Escape handler. Focus may be permanently trapped.`,
          confidence: hasEscape ? 0.65 : 0.85,
          correctivePrompt: `[Focus trap] — ${fileName}\n\nIssue reason:\nonKeyDown intercepts Tab with preventDefault${hasEscape ? '' : ' and no escape key handler'}. Users may be trapped.\n\nRecommended fix:\nEnsure focus traps have an Escape key exit path. Use a well-tested modal/dialog pattern.`,
          deduplicationKey: dedupeKey,
          detectedHandlers: ['onKeyDown'],
          missingFeatures: hasEscape ? [] : ['no Escape exit path'],
        });
      }
    }

    // ── A3-P1: role="button" with tabIndex but no key handler ──
    const roleButtonTags = extractJsxOpeningTags(content, NON_INTERACTIVE_TAGS);
    for (const { tag, attrs, index } of roleButtonTags) {
      if (!INTERACTIVE_ROLES_RE.test(attrs)) continue;
      if (!/tabIndex\s*=\s*\{?\s*[0-9]/i.test(attrs) && !/tabindex\s*=\s*["'][0-9]/i.test(attrs)) continue;
      if (KEY_HANDLER_RE.test(attrs)) continue;

      const testIdMatch = attrs.match(/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabel = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = testIdMatch?.[1] || testIdMatch?.[2] || ariaLabel?.[1] || ariaLabel?.[2] || `<${tag} role="button">`;
      const lineNumber = content.slice(0, index).split('\n').length;
      const dedupeKey = `${filePath}|role-nokey|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      console.log(`A3-P1 POTENTIAL: ${filePath}:${lineNumber} <${tag}> role="button" + tabIndex, no key handler`);

      findings.push({
        elementLabel: label, elementType: tag, role: 'button', sourceLabel: label, filePath, lineNumber, componentName,
        classificationCode: 'A3-P1', classification: 'potential',
        detection: `role="button" + tabIndex but no key handler`,
        evidence: `<${tag} role="button" tabIndex=0> at ${filePath}:${lineNumber} — missing Enter/Space activation`,
        explanation: `Has role="button" and tabIndex but no onKeyDown/onKeyUp handler. Keyboard users can focus but may not activate.`,
        confidence: 0.72,
        correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nThis ${tag} has role="button" and tabIndex but missing keyboard activation handler (onKeyDown/onKeyUp). Keyboard users can focus but cannot activate it with Enter or Space.\n\nRecommended fix:\nReplace it with a native <button type="button">. If you must keep a ${tag}, add an onKeyDown handler that triggers on Enter and Space.`,
        deduplicationKey: dedupeKey,
        detectedHandlers: [],
        missingFeatures: ['missing onKeyDown'],
      });
    }

    // ── A3-P1: <a> without href used as button ──
    const anchorTags = extractJsxOpeningTags(content, 'a');
    for (const { tag, attrs, index } of anchorTags) {
      if (!POINTER_HANDLER_RE.test(attrs)) continue;
      // Has valid href → skip
      if (/href\s*=\s*(?:"(?!#")(?![^"]*javascript:)[^"]+"|'(?!#')[^']+')/.test(attrs)) continue;
      const hasHref = /href\s*=/.test(attrs);
      if (hasHref && !/href\s*=\s*["']#["']/.test(attrs) && !/href\s*=\s*["']javascript:/i.test(attrs)) continue;

      const testIdMatch = attrs.match(/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabel = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const label = testIdMatch?.[1] || testIdMatch?.[2] || ariaLabel?.[1] || ariaLabel?.[2] || '<a> as button';
      const lineNumber = content.slice(0, index).split('\n').length;
      const dedupeKey = `${filePath}|a-nohref|${label}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      console.log(`A3-P1 POTENTIAL: ${filePath}:${lineNumber} <a> with onClick but no valid href`);

      findings.push({
        elementLabel: label, elementType: 'a', role: 'link', sourceLabel: label, filePath, lineNumber, componentName,
        classificationCode: 'A3-P1', classification: 'potential',
        detection: `<a> with onClick but no valid href`,
        evidence: `<a onClick=...${hasHref ? ' href="#"' : ''}> at ${filePath}:${lineNumber}`,
        explanation: `<a> used as button with onClick${hasHref ? ' and href="#"' : ' but no href'}. Use <button> or add role="button".`,
        confidence: 0.68,
        correctivePrompt: `[${label} (a)] — ${fileName}\n\nIssue reason:\nThis <a> is used as a button with onClick${hasHref ? ' and href="#"' : ' but no href'}. It is not a valid navigation link and may confuse assistive technology.\n\nRecommended fix:\nReplace it with a <button type="button"> if it triggers an action. If it navigates, add a valid href.`,
        deduplicationKey: dedupeKey,
        detectedHandlers: ['onClick'],
        missingFeatures: ['missing href'],
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

// ============================================================
// TWO-LAYER HYBRID ARCHITECTURE — Rule Routing
// ============================================================
// Rules are classified by evaluation method:
//   DETERMINISTIC: A1, A3, A4, A5, A6 — regex/static analysis only, never sent to LLM
//   LLM_ASSISTED:  A2 (code), U4, U6, E2 — always sent to LLM
//   HYBRID:        U1, U2, U3, U5, E1, E3 — deterministic signals first, LLM fallback
//
// For ZIP/GitHub code analysis:
//   - DETERMINISTIC rules are handled by dedicated regex detectors (never in LLM prompt)
//   - LLM_ASSISTED rules are always included in LLM prompt
//   - HYBRID rules: deterministic signals run separately; LLM prompt includes them
//     for fallback analysis, but deterministic results take precedence
// ============================================================

const DETERMINISTIC_CODE_RULES = new Set(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
const LLM_ONLY_RULES = new Set(['U4', 'U6', 'E2']);
const HYBRID_RULES_SET = new Set(['U1', 'U2', 'U3', 'U5', 'E1', 'E3']);
// A2 is now DETERMINISTIC — scans className strings directly from source

function buildCodeAnalysisPrompt(selectedRules: string[]) {
  const selectedRulesSet = new Set(selectedRules);
  // DETERMINISTIC rules (A1, A2, A3-A6) are NEVER sent to LLM — handled by regex detectors
  const accessibilityRulesForLLM = rules.accessibility.filter(r => 
    !DETERMINISTIC_CODE_RULES.has(r.id) && selectedRulesSet.has(r.id)
  );
  
  return `You are an expert UI/UX code auditor performing a comprehensive 3-pass static analysis of source code.
This analysis uses a Two-Layer Hybrid Architecture:
- Accessibility rules A1, A2, A3, A4, A5, A6 are evaluated by the DETERMINISTIC engine (regex/static analysis). Do NOT report findings for these rules.
- Usability and Ethics rules are evaluated by YOU, with some rules having deterministic signals that take precedence.

## PASS 1 — Accessibility (WCAG AA) - LLM-Assisted Rules Only
NOTE: A1 (contrast), A2 (focus visibility), A3 (keyboard), A4 (semantics), A5 (form labels), A6 (accessible names) are handled by the deterministic engine. Do NOT report these rules.

### A2 (Poor focus visibility) — CLASSIFICATION RULES:

**PREREQUISITE — FOCUS SUPPRESSION CHECK:**
ONLY evaluate an element for A2 if it explicitly suppresses the default focus indicator:
- \`outline: none\`, \`outline-none\`, \`focus:outline-none\`, \`focus-visible:outline-none\`
- OR \`ring-0\`, \`focus:ring-0\`, \`focus-visible:ring-0\`
- OR \`:focus { outline: none }\`
If no suppression is detected → SKIP (do not report).

**FOCUSABILITY — STRICT CRITERIA:**
Only evaluate elements that are focusable:
1. Native: \`<button>\`, \`<a href="...">\`, \`<input>\`, \`<select>\`, \`<textarea>\`
2. Explicit tabIndex: \`tabIndex={0}\` or positive
3. Interactive ARIA role with tabIndex: \`role="button"\`, \`role="link"\`, \`role="menuitem"\` + \`tabIndex >= 0\`
Do NOT classify \`<div>\`/\`<span>\` without tabIndex or keyboard handlers as focusable.

**IGNORE:** All hover styles — hover is NOT focus.

**CLASSIFICATION:**

1. **CONFIRMED (Blocking):**
   - Explicit focus suppression detected (outline-none, ring-0, :focus{outline:none})
   - AND **no** valid replacement focus style is present
   - Valid replacements: \`focus:ring-*\`, \`focus-visible:ring-*\`, \`focus:border-*\`, \`focus-visible:border-*\`, \`focus:shadow-*\`, \`focus-visible:shadow-*\`, \`focus:bg-*\`, \`focus-visible:bg-*\`
   - If ANY valid replacement exists → DO NOT mark confirmed
   - Set \`typeBadge: "CONFIRMED"\`, confidence 90-95%

2. **POTENTIAL (Non-blocking):**
   - Focus suppression detected AND a replacement exists but perceptibility cannot be statically verified
   - Examples: ring-1 with muted color, bg-only change, shadow-sm only
   - OR: Interactive elements exist but no explicit focus styles are detected
   - Do NOT assume subtle styling equals invisible — static analysis cannot evaluate visual contrast of focus rings
   - Set \`typeBadge: "POTENTIAL"\`, confidence 60-75%

3. **PASS — SKIP ENTIRELY:**
   - No focus suppression detected (browser defaults preserved)
   - OR strong visible replacement present (\`focus:ring-2\`+, \`focus:border-*\` with distinct color, \`focus:outline-*\` not outline-none, \`focus:shadow-md\`+)
   - Do NOT include in violations array

**ELEMENT IDENTITY (MANDATORY for every A2 finding):**
- "role": HTML tag name or ARIA role
- "accessibleName": Computed accessible name (aria-label, visible text). "" if none.
- "sourceLabel": Human-readable label describing the element
- "selectorHint": data-testid, id, class fragment, or component JSX snippet
- "filePath": Full file path
- "componentName": PascalCase component name

**OUTPUT FORMAT:**
\`\`\`json
{
  "ruleId": "A2",
  "ruleName": "Poor focus visibility",
  "category": "accessibility",
  "typeBadge": "CONFIRMED" or "POTENTIAL",
  "evidence": "focus:outline-none with only focus:bg-accent in Button.tsx",
  "diagnosis": "Button removes focus outline without visible replacement.",
  "contextualHint": "Add visible focus ring or border for keyboard accessibility.",
  "confidence": 0.50,
  "role": "button",
  "accessibleName": "More options",
  "sourceLabel": "More options (kebab menu)",
  "selectorHint": "<Button aria-label=\\"More options\\" className=\\"...outline-none\\">",
  "filePath": "src/components/Header.tsx",
  "componentName": "Header"
}
\`\`\`

**OUTPUT CONSTRAINT:**
- Only report CONFIRMED and POTENTIAL findings
- NEVER include PASS or NOT APPLICABLE in violations
- NEVER speculate — analyze actual code only
- Report only actual accessibility risks with code evidence

Accessibility rules to check (LLM-assisted only — A1, A3-A6 are handled by deterministic engine):
${accessibilityRulesForLLM.map(r => `- ${r.id}: ${r.name}`).join('\n')}

## PASS 2 — Usability (HCI) - Code Pattern Analysis
Analyze code structure for usability patterns:
- Button hierarchy and primary action clarity (U1)
- Navigation structure, routing patterns, and wayfinding (U2) — NOTE: U2 deterministic pre-pass runs separately; you provide contextual enrichment
- Content truncation, overflow handling, and text visibility (U3)
- Recognition vs recall: visible options, labels, contextual cues (U4) — NOTE: U4 has a DEDICATED SECTION below with pre-extracted evidence bundles. Follow the U4 instructions precisely.
- Interaction feedback: loading states, confirmations, error messages (U5)
- Layout grouping, alignment, and visual coherence (U6)

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

### U2 (Incomplete / Unclear Navigation) — CONTEXTUAL ASSESSMENT:
**NOTE:** U2 deterministic sub-checks (U2.D1, U2.D2, U2.D3) run separately via static analysis.
Your role is to provide contextual enrichment for navigation assessment:

**EVALUATE:**
- Wayfinding clarity: Can a user understand where they are and how to move between sections?
- Navigation density: Are there too many or too few navigation options?
- Ambiguity: Are navigation labels clear and distinct?
- Redundant links: Are there duplicate navigation paths that create confusion?
- Inconsistent routing patterns: Do navigation conventions vary across views?
- Missing hierarchy cues: Is the navigation hierarchy clear (primary → secondary)?

**CLASSIFICATION:**
- U2 findings are ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Use evaluationMethod: "hybrid_llm_fallback"
- Confidence: 0.60–0.75
- Ground your assessment in observable code patterns (route definitions, nav components, link structures)

**OUTPUT FOR U2:**
\`\`\`json
{
  "ruleId": "U2",
  "ruleName": "Incomplete / Unclear navigation",
  "category": "usability",
  "status": "potential",
  "diagnosis": "Evidence-based navigation clarity assessment...",
  "evidence": "Specific code patterns observed...",
  "contextualHint": "Short guidance on improving navigation...",
  "confidence": 0.65
}
\`\`\`

### U4 (Recognition-to-Recall Regression) — LLM-ASSISTED EVALUATION:
**NOTE:** U4 uses pre-extracted evidence bundles appended as \`[U4_EVIDENCE_BUNDLE]\`. Use ONLY the provided extracted UI text/evidence to decide if the UI forces recall rather than recognition.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, page titles, variable names, or any "test" wording (e.g., "U4 Recall Test", "RecallPage") as evidence or reasoning.
- Do NOT infer developer intent from naming conventions — a file named "RecallTest.tsx" does NOT mean the UI forces recall.
- The evidence bundle header lines showing component names and file paths are for LOCATION REFERENCE ONLY — they are NOT UI content and MUST NOT be cited as evidence of recall issues.
- Base conclusions ONLY on user-visible UI content extracted in the bundle:
  - CTA labels, headings, form field labels/placeholders, step indicators
  - Presence/absence of summary/review content (use the boolean flags as hints, not proof)
  - Whether CTAs explain what happens next
- If the extracted evidence is insufficient to demonstrate a concrete recall burden, return NO U4 finding — do not guess.

**EVALUATE (using ONLY the evidence bundle content, not file/component names):**
- Missing summaries: Forms or multi-step flows that don't show what the user previously selected
- Missing examples: Input fields without helper text, examples, or format hints
- Generic CTAs without context: Buttons labeled "Continue", "Next", "Submit" without indicating what happens next
- Multi-step flows lacking review: Step indicators without a final review/summary step

**CLASSIFICATION:**
- U4 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence represents strength of observable cues, NOT model probability
- Confidence cap: 0.80 maximum
- Confidence range: 0.60–0.80

**OUTPUT FOR U4 — STRUCTURED u4Elements:**
Return U4 findings using a \`u4Elements\` array so findings can be aggregated per UI region:
\`\`\`json
{
  "ruleId": "U4",
  "ruleName": "Recognition-to-recall regression",
  "category": "usability",
  "status": "potential",
  "isU4Aggregated": true,
  "u4Elements": [
    {
      "elementLabel": "Checkout confirmation step",
      "elementType": "form",
      "location": "src/components/Checkout.tsx",
      "detection": "Multi-step checkout with generic 'Confirm' CTA and no order summary visible",
      "evidence": "CTAs: 'Confirm', 'Back' | Headings: 'Step 3 of 3 — Confirm Order' | No summary of selected items shown",
      "recommendedFix": "Add an order summary showing previously selected items before the final confirmation",
      "confidence": 0.70
    }
  ],
  "diagnosis": "Summary of recognition-to-recall issues...",
  "contextualHint": "Short guidance...",
  "confidence": 0.70
}
\`\`\`
- If NO U4 issues found, do NOT include U4 in the violations array.
- Each u4Element MUST cite evidence from the provided evidence bundle (CTA labels, headings, form fields — NOT file names).

### U6 (Weak Grouping / Layout Coherence) — LLM-ASSISTED EVALUATION:
**NOTE:** U6 uses pre-extracted layout evidence bundles appended as \`[U6_LAYOUT_EVIDENCE_BUNDLE]\`. Use ONLY the provided extracted layout cues to assess grouping/hierarchy.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, page titles, or "test" wording as evidence.
- Do NOT infer developer intent from naming conventions.
- Base conclusions ONLY on the extracted layout evidence: headings, container counts, flex/grid usage, spacing tokens, repeated patterns, flat-stack cues.
- If evidence is insufficient to demonstrate weak grouping, return NO U6 finding — do not guess.

**EVALUATE (using ONLY the layout evidence bundle, not file names):**
- Missing section separation: Related content not grouped into visual containers
- Inconsistent spacing hierarchy: Uneven or missing spacing tokens between groups
- Unclear grouping of related elements: Flat stacks of inputs/buttons without headings or wrappers
- Misalignment patterns: Mixed flex/grid usage suggesting alignment issues
- Clutter: Too many sibling elements at same nesting level without separation

**CLASSIFICATION:**
- U6 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence: 0.60–0.80 (cap at 0.80)

**OUTPUT FOR U6 — STRUCTURED u6Elements:**
\`\`\`json
{
  "ruleId": "U6",
  "ruleName": "Weak grouping / layout coherence",
  "category": "usability",
  "status": "potential",
  "isU6Aggregated": true,
  "u6Elements": [
    {
      "elementLabel": "Main form section",
      "elementType": "section",
      "location": "src/components/Form.tsx",
      "detection": "Long sequence of inputs without heading or visual grouping",
      "evidence": "12 sibling inputs without section headings or fieldset wrappers; no gap/space-y tokens between logical groups",
      "recommendedFix": "Group related fields into fieldsets with legends or add section headings",
      "confidence": 0.70
    }
  ],
  "diagnosis": "Summary of grouping/layout issues...",
  "contextualHint": "Short guidance...",
  "confidence": 0.70
}
\`\`\`
- If NO U6 issues found, do NOT include U6 in the violations array.
- Each u6Element MUST cite evidence from the provided layout evidence bundle (container counts, spacing, headings — NOT file names).

Usability rules to check:
${rules.usability.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name}`).join('\n')}

## PASS 3 — Ethics
Look for patterns that may undermine user autonomy or informed consent:
- Imbalanced choice architecture: visual weight, pre-selection, or ordering that nudges users (E2)
- Obscured user controls: opt-out, cancel, dismiss, or unsubscribe options that are suppressed or harder to access (E3)

### E1 (Insufficient Transparency in High-Impact Actions) — LLM-ASSISTED EVALUATION:
**NOTE:** E1 uses pre-extracted high-impact action evidence bundles appended as \`[E1_EVIDENCE_BUNDLE]\`. Use ONLY the provided extracted UI text/context to assess transparency.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, or test wording as evidence.
- Do NOT infer malicious intent. Use neutral language ("may be unclear", "transparency risk").
- Base conclusions ONLY on the extracted CTA labels, nearby UI text (headings, warnings, pricing), and confirmation dialog presence/absence.
- If evidence is insufficient to demonstrate missing transparency, return NO E1 finding — do not guess.

**EVALUATE (using ONLY the evidence bundle content):**
- Missing consequence disclosure: delete/remove actions without "permanent", "cannot be undone" warnings
- Missing cost disclosure: subscribe/buy/upgrade actions without visible pricing or billing cycle
- Missing data implications: data-sharing actions without consent explanation
- Missing confirmation step: high-impact actions without confirmation dialog/modal

**CLASSIFICATION:**
- E1 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence: 0.60–0.80 (cap at 0.80)

**OUTPUT FOR E1 — STRUCTURED e1Elements:**
\`\`\`json
{
  "ruleId": "E1",
  "ruleName": "Insufficient transparency in high-impact actions",
  "category": "ethics",
  "status": "potential",
  "isE1Aggregated": true,
  "e1Elements": [
    {
      "elementLabel": "\\"Delete Account\\" action",
      "elementType": "button",
      "location": "src/components/Settings.tsx",
      "detection": "Destructive action without consequence disclosure or confirmation step",
      "evidence": "CTA: 'Delete Account' | No nearby warning text ('permanent', 'cannot be undone') | No confirmation dialog detected",
      "recommendedFix": "Add a confirmation dialog that explicitly states the action is irreversible and what data will be lost",
      "confidence": 0.75
    }
  ],
  "diagnosis": "Summary of transparency issues...",
  "contextualHint": "Short guidance...",
  "confidence": 0.75
}
\`\`\`
- If NO E1 issues found, do NOT include E1 in the violations array.
- Each e1Element MUST cite evidence from the provided evidence bundle (CTA labels, nearby text — NOT file names).

### E2 (Imbalanced or Manipulative Choice Architecture) — LLM-ASSISTED EVALUATION:
**NOTE:** E2 uses pre-extracted choice bundle data appended as \`[E2_CHOICE_BUNDLE]\`. Use ONLY the provided extracted CTA labels, style tokens, and nearby microcopy to assess choice balance.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, or test wording as evidence.
- Do NOT infer malicious intent. Use neutral phrasing ("imbalance risk", "may nudge").
- Do NOT flag normal primary/secondary button patterns unless the alternative is materially de-emphasized or obscured.
- Base conclusions ONLY on the extracted labels, style tokens, prominence cues, and nearby microcopy.
- If evidence is insufficient to demonstrate meaningful imbalance, return NO E2 finding — do not guess.

**EVALUATE (using ONLY the choice bundle content):**
- Visual dominance: one option has significantly larger size, bolder color, or higher contrast than alternatives
- Obscured decline: opt-out/cancel/decline option uses muted color, smaller text, or link-style vs button
- Asymmetric wording: accept uses action-oriented language while decline uses passive/negative framing
- Pre-selection bias: default state nudges toward one option

**CLASSIFICATION:**
- E2 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence: 0.60–0.80 (cap at 0.80)

**OUTPUT FOR E2 — STRUCTURED e2Elements:**
\`\`\`json
{
  "ruleId": "E2",
  "ruleName": "Imbalanced or manipulative choice architecture",
  "category": "ethics",
  "status": "potential",
  "isE2Aggregated": true,
  "e2Elements": [
    {
      "elementLabel": "Upgrade dialog choices",
      "elementType": "button-group",
      "location": "src/components/UpgradeModal.tsx",
      "detection": "Primary option visually dominates: bg-blue-600 px-8 vs text-gray-400 text-sm link for decline",
      "evidence": "Accept: 'Upgrade Now' (bg-blue-600, text-white, px-8, py-3, font-bold) | Decline: 'Maybe later' (text-gray-400, text-sm, underline)",
      "recommendedFix": "Balance button prominence: make decline a visible secondary button with adequate contrast and size",
      "confidence": 0.70
    }
  ],
  "diagnosis": "Summary of choice imbalance issues...",
  "contextualHint": "Short guidance...",
  "confidence": 0.70
}
\`\`\`
- If NO E2 issues found, do NOT include E2 in the violations array.
- Each e2Element MUST cite evidence from the provided choice bundle (labels, style tokens — NOT file names).

### E3 (Obscured or Restricted User Control) — HYBRID EVALUATION:
**NOTE:** E3 uses pre-extracted control restriction evidence bundles appended as \`[E3_CONTROL_RESTRICTION_EVIDENCE]\`. Use ONLY the provided structural evidence to validate whether user control is meaningfully restricted or obscured.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, or test wording as evidence.
- Do NOT infer malicious intent. Use neutral language ("control restriction risk", "dismissal mechanism may be missing").
- Base conclusions ONLY on the extracted structural signals (missing close buttons, forced opt-ins, missing back navigation).
- If evidence is insufficient to demonstrate meaningful control restriction, return NO E3 finding — do not guess.

**EVALUATE (using ONLY the evidence bundle content):**
- Missing dismissal: modals/dialogs without close/cancel buttons or escape handlers
- Missing cancel path: forms with submit but no cancel/back/exit option
- Forced opt-in: required checkboxes for marketing/consent with no opt-out alternative
- Missing back navigation: multi-step flows without back/previous controls

**CLASSIFICATION:**
- E3 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence: 0.60–0.85 (cap at 0.85)

**OUTPUT FOR E3 — STRUCTURED e3Elements:**
\`\`\`json
{
  "ruleId": "E3",
  "ruleName": "Obscured or restricted user control",
  "category": "ethics",
  "status": "potential",
  "isE3Aggregated": true,
  "e3Elements": [
    {
      "elementLabel": "Dialog component",
      "elementType": "dialog",
      "location": "src/components/Modal.tsx",
      "subCheck": "E3.D1",
      "detection": "Modal without visible dismissal mechanism",
      "evidence": "<Dialog> found without close button, onClose handler, or escape key handler",
      "recommendedFix": "Add a close/cancel button and ensure the dialog can be dismissed via escape key",
      "confidence": 0.75
    }
  ],
  "diagnosis": "Summary of control restriction issues...",
  "contextualHint": "Short guidance...",
  "confidence": 0.75
}
\`\`\`
- If NO E3 issues found, do NOT include E3 in the violations array.
- Each e3Element MUST cite evidence from the provided structural signals — NOT file names.

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

// ========== U4 EVIDENCE BUNDLE EXTRACTION (Recognition-to-Recall) ==========
// Extracts compact context per file/page for LLM assessment — NOT deterministic triggers
interface U4EvidenceBundle {
  componentName: string;
  filePath: string;
  ctaLabels: string[];       // button text
  headings: string[];        // h1-h6 text near CTAs
  formFields: { label: string; placeholder?: string; helperText?: string }[];
  stepIndicators: string[];  // "Step X", "Next", "Back" patterns
  hasSummaryWords: boolean;
  hasHelperExamples: boolean;
  hasGenericCTA: boolean;
}

function extractU4EvidenceBundle(allFiles: Map<string, string>): U4EvidenceBundle[] {
  const bundles: U4EvidenceBundle[] = [];
  const GENERIC_CTA_RE = /\b(Continue|Next|Submit|Save|Confirm|OK|Done|Proceed|Go)\b/i;
  const STEP_RE = /\b(Step\s+\d+|step\s*[-–—]\s*\d+|Next|Back|Previous)\b/gi;
  const SUMMARY_WORDS = /\b(summary|review|confirm|overview|receipt|total|selected)\b/i;
  const HELPER_EXAMPLE_RE = /\b(e\.g\.|example|format|hint|such as|like\s+\"|must be|at least|pattern)\b/i;

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules')) continue;

    // Component name
    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|html)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];

    // CTA labels (button text)
    const ctaLabels: string[] = [];
    const btnRe = /<(?:Button|button)\b[^>]*>([^<]{1,60})<\/(?:Button|button)>/gi;
    let bm;
    while ((bm = btnRe.exec(content)) !== null) {
      const label = bm[1].replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (label.length >= 2 && label.length <= 50) ctaLabels.push(label);
    }

    // Headings near CTAs
    const headings: string[] = [];
    const hRe = /<h([1-6])\b[^>]*>([^<]{2,80})<\/h\1>/gi;
    let hm;
    while ((hm = hRe.exec(content)) !== null) {
      const text = hm[2].replace(/\{[^}]*\}/g, '').trim();
      if (text.length >= 2) headings.push(text);
    }

    // Form fields
    const formFields: U4EvidenceBundle['formFields'] = [];
    const inputRe = /<(?:Input|input|textarea|Textarea|select|Select)\b([^>]*)(?:\/>|>[^<]*<\/)/gi;
    let im;
    while ((im = inputRe.exec(content)) !== null) {
      const attrs = im[1] || '';
      const labelMatch = attrs.match(/(?:label|aria-label)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/i);
      const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/i);
      const label = labelMatch?.[1] || labelMatch?.[2] || labelMatch?.[3] || '';
      const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2] || placeholderMatch?.[3] || '';
      if (label || placeholder) {
        // Look for nearby helper text
        const afterInput = content.slice(im.index, Math.min(content.length, im.index + 300));
        const helperMatch = afterInput.match(/<(?:p|span|div)\b[^>]*(?:helper|hint|description|muted|text-sm|text-xs)[^>]*>([^<]{3,80})</i);
        formFields.push({
          label: label || placeholder,
          placeholder: placeholder || undefined,
          helperText: helperMatch?.[1]?.trim() || undefined,
        });
      }
    }

    // Step indicators
    const stepIndicators: string[] = [];
    let sm;
    while ((sm = STEP_RE.exec(content)) !== null) {
      stepIndicators.push(sm[1]);
    }

    // Skip files with no relevant content
    if (ctaLabels.length === 0 && formFields.length === 0 && stepIndicators.length === 0 && headings.length === 0) continue;

    const hasGenericCTA = ctaLabels.some(l => GENERIC_CTA_RE.test(l));
    const hasSummaryWords = SUMMARY_WORDS.test(content);
    const hasHelperExamples = HELPER_EXAMPLE_RE.test(content);

    bundles.push({
      componentName,
      filePath,
      ctaLabels: [...new Set(ctaLabels)].slice(0, 8),
      headings: [...new Set(headings)].slice(0, 6),
      formFields: formFields.slice(0, 8),
      stepIndicators: [...new Set(stepIndicators)].slice(0, 6),
      hasSummaryWords,
      hasHelperExamples,
      hasGenericCTA,
    });
  }

  return bundles.slice(0, 15); // Cap at 15 files
}

function formatU4EvidenceBundleForPrompt(bundles: U4EvidenceBundle[]): string {
  if (bundles.length === 0) return '';
  const lines = [
    '[U4_EVIDENCE_BUNDLE]',
    'IMPORTANT: The location references below are for traceability ONLY. Do NOT use file names, component names, or page titles as evidence of recall issues. Evaluate ONLY the extracted UI text (CTAs, headings, form fields, step indicators).',
  ];
  for (const b of bundles) {
    lines.push(`\n--- Location: ${b.filePath} ---`);
    if (b.ctaLabels.length > 0) lines.push(`  CTAs: ${b.ctaLabels.join(', ')}`);
    if (b.headings.length > 0) lines.push(`  Headings: ${b.headings.join(' | ')}`);
    if (b.formFields.length > 0) {
      for (const f of b.formFields) {
        let row = `  Field: ${f.label}`;
        if (f.placeholder) row += ` (placeholder: "${f.placeholder}")`;
        if (f.helperText) row += ` — helper: "${f.helperText}"`;
        lines.push(row);
      }
    }
    if (b.stepIndicators.length > 0) lines.push(`  Steps: ${b.stepIndicators.join(', ')}`);
    lines.push(`  Flags: summary=${b.hasSummaryWords}, helpers=${b.hasHelperExamples}, genericCTA=${b.hasGenericCTA}`);
  }
  lines.push('[/U4_EVIDENCE_BUNDLE]');
  return lines.join('\n');
}

// ========== E1 EVIDENCE BUNDLE EXTRACTION (Insufficient Transparency in High-Impact Actions) ==========
interface E1EvidenceBundle {
  filePath: string;
  ctaLabel: string;
  ctaType: string; // 'destructive' | 'financial' | 'data-sharing'
  nearbyText: string[]; // headings, warnings, pricing, helper text near the CTA
  hasConfirmationDialog: boolean;
  hasWarningText: boolean;
  hasPricingText: boolean;
}

const E1_HIGH_IMPACT_KEYWORDS = /\b(delete|remove|close\s*account|reset|destroy|erase|unsubscribe|terminate|revoke|cancel\s*(?:subscription|membership|plan|account)|subscribe|buy|purchase|pay|upgrade|checkout|confirm\s*(?:order|purchase|payment)|accept|agree)\b/i;
const E1_WARNING_WORDS = /\b(permanent|cannot\s*be\s*undone|irreversible|this\s*action|will\s*be\s*(?:deleted|removed|lost)|are\s*you\s*sure|caution|warning)\b/i;
const E1_PRICING_WORDS = /\b(\$\d|\€\d|\£\d|USD|EUR|per\s*month|\/mo|\/year|billing|subscription\s*(?:fee|cost|price)|free\s*trial|charged)\b/i;
const E1_CONFIRMATION_PATTERNS = /\b(AlertDialog|confirm\s*\(|useConfirm|ConfirmDialog|ConfirmModal|confirmation|modal|Dialog)\b/i;

function extractE1EvidenceBundle(allFiles: Map<string, string>): E1EvidenceBundle[] {
  const bundles: E1EvidenceBundle[] = [];

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    // Find high-impact CTA candidates
    const btnRe = /<(?:Button|button|a)\b([^>]*)>([^<]{1,80})<\/(?:Button|button|a)>/gi;
    let bm;
    while ((bm = btnRe.exec(content)) !== null) {
      const attrs = bm[1] || '';
      const label = bm[2].replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (!label || label.length < 2) continue;
      if (!E1_HIGH_IMPACT_KEYWORDS.test(label) && !E1_HIGH_IMPACT_KEYWORDS.test(attrs)) continue;

      // Classify CTA type
      let ctaType = 'destructive';
      if (/\b(subscribe|buy|purchase|pay|upgrade|checkout)\b/i.test(label)) ctaType = 'financial';
      if (/\b(accept|agree|share|consent)\b/i.test(label)) ctaType = 'data-sharing';

      // Collect nearby text (300 chars before and after the CTA)
      const regionStart = Math.max(0, bm.index - 300);
      const regionEnd = Math.min(content.length, bm.index + bm[0].length + 300);
      const region = content.slice(regionStart, regionEnd);

      const nearbyText: string[] = [];
      // Extract headings
      const hRe = /<h([1-6])\b[^>]*>([^<]{2,80})<\/h\1>/gi;
      let hm;
      while ((hm = hRe.exec(region)) !== null) {
        nearbyText.push(`h${hm[1]}: ${hm[2].replace(/\{[^}]*\}/g, '').trim()}`);
      }
      // Extract paragraph/span text
      const pRe = /<(?:p|span|div)\b[^>]*>([^<]{3,120})<\/(?:p|span|div)>/gi;
      let pm;
      while ((pm = pRe.exec(region)) !== null) {
        const text = pm[1].replace(/\{[^}]*\}/g, '').trim();
        if (text.length >= 3 && text.length <= 120) nearbyText.push(text);
      }

      const hasWarningText = E1_WARNING_WORDS.test(region);
      const hasPricingText = E1_PRICING_WORDS.test(region);
      // Check for confirmation dialog in the same file
      const hasConfirmationDialog = E1_CONFIRMATION_PATTERNS.test(content);

      bundles.push({
        filePath,
        ctaLabel: label,
        ctaType,
        nearbyText: [...new Set(nearbyText)].slice(0, 6),
        hasConfirmationDialog,
        hasWarningText,
        hasPricingText,
      });
    }

    // Also check aria-label/title on icon buttons
    const iconBtnRe = /<(?:Button|button)\b([^>]*(?:aria-label|title)\s*=\s*(?:"([^"]+)"|'([^']+)'))[^>]*(?:\/>|>[^<]*<\/(?:Button|button)>)/gi;
    let ibm;
    while ((ibm = iconBtnRe.exec(content)) !== null) {
      const label = ibm[2] || ibm[3] || '';
      if (!label || !E1_HIGH_IMPACT_KEYWORDS.test(label)) continue;
      // Avoid duplicates
      if (bundles.some(b => b.filePath === filePath && b.ctaLabel === label)) continue;

      let ctaType = 'destructive';
      if (/\b(subscribe|buy|purchase|pay|upgrade|checkout)\b/i.test(label)) ctaType = 'financial';

      const hasConfirmationDialog = E1_CONFIRMATION_PATTERNS.test(content);
      bundles.push({
        filePath,
        ctaLabel: label,
        ctaType,
        nearbyText: [],
        hasConfirmationDialog,
        hasWarningText: false,
        hasPricingText: false,
      });
    }
  }

  return bundles.slice(0, 20);
}

// ========== E2 CHOICE BUNDLE EXTRACTION (Imbalanced Choice Architecture) ==========
interface E2ChoiceBundle {
  filePath: string;
  ctaLabels: { label: string; styleTokens: string; position: number }[];
  nearbyMicrocopy: string[];
}

function extractE2ChoiceBundle(allFiles: Map<string, string>): E2ChoiceBundle[] {
  const bundles: E2ChoiceBundle[] = [];

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    // Find containers with 2+ CTAs (buttons/links)
    const btnRe = /<(?:Button|button|a)\b([^>]*)>([^<]{1,80})<\/(?:Button|button|a)>/gi;
    const ctaMatches: { label: string; attrs: string; index: number }[] = [];
    let bm;
    while ((bm = btnRe.exec(content)) !== null) {
      const label = bm[2].replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (!label || label.length < 2) continue;
      ctaMatches.push({ label, attrs: bm[1] || '', index: bm.index });
    }

    // Group CTAs by proximity (within 500 chars of each other)
    const groups: typeof ctaMatches[] = [];
    let currentGroup: typeof ctaMatches = [];
    for (const cta of ctaMatches) {
      if (currentGroup.length === 0 || cta.index - currentGroup[currentGroup.length - 1].index < 500) {
        currentGroup.push(cta);
      } else {
        if (currentGroup.length >= 2) groups.push([...currentGroup]);
        currentGroup = [cta];
      }
    }
    if (currentGroup.length >= 2) groups.push(currentGroup);

    for (const group of groups) {
      // Extract style tokens from className/variant
      const ctaLabels = group.map((cta, idx) => {
        const classMatch = cta.attrs.match(/className\s*=\s*(?:{`([^`]*)`}|"([^"]*)"|'([^']*)')/);
        const variantMatch = cta.attrs.match(/variant\s*=\s*(?:"([^"]*)"|'([^']*)')/);
        const sizeMatch = cta.attrs.match(/size\s*=\s*(?:"([^"]*)"|'([^']*)')/);
        const tokens: string[] = [];
        if (classMatch) tokens.push(classMatch[1] || classMatch[2] || classMatch[3] || '');
        if (variantMatch) tokens.push(`variant=${variantMatch[1] || variantMatch[2]}`);
        if (sizeMatch) tokens.push(`size=${sizeMatch[1] || sizeMatch[2]}`);
        return { label: cta.label, styleTokens: tokens.join(' ').trim(), position: idx };
      });

      // Extract nearby microcopy
      const regionStart = Math.max(0, group[0].index - 200);
      const regionEnd = Math.min(content.length, group[group.length - 1].index + 300);
      const region = content.slice(regionStart, regionEnd);
      const nearbyMicrocopy: string[] = [];
      const textRe = /<(?:p|span|h[1-6]|div)\b[^>]*>([^<]{3,100})<\/(?:p|span|h[1-6]|div)>/gi;
      let tm;
      while ((tm = textRe.exec(region)) !== null) {
        const text = tm[1].replace(/\{[^}]*\}/g, '').trim();
        if (text.length >= 3) nearbyMicrocopy.push(text);
      }

      bundles.push({ filePath, ctaLabels, nearbyMicrocopy: [...new Set(nearbyMicrocopy)].slice(0, 5) });
    }
  }

  return bundles.slice(0, 20);
}

function formatE2ChoiceBundleForPrompt(bundles: E2ChoiceBundle[]): string {
  if (bundles.length === 0) return '';
  const lines = [
    '[E2_CHOICE_BUNDLE]',
    'IMPORTANT: Location references are for traceability ONLY. Do NOT use file names as evidence. Evaluate ONLY the extracted CTA labels, style tokens, and nearby microcopy.',
  ];
  for (const b of bundles) {
    lines.push(`\n--- Location: ${b.filePath} ---`);
    for (const cta of b.ctaLabels) {
      lines.push(`  CTA #${cta.position + 1}: "${cta.label}" | styles: ${cta.styleTokens || '(none detected)'}`);
    }
    if (b.nearbyMicrocopy.length > 0) lines.push(`  Nearby text: ${b.nearbyMicrocopy.join(' | ')}`);
  }
  lines.push('[/E2_CHOICE_BUNDLE]');
  return lines.join('\n');
}

// ========== E3 DETERMINISTIC DETECTION (Obscured or Restricted User Control) ==========
interface E3Finding {
  filePath: string;
  line: number;
  subCheck: 'E3.D1' | 'E3.D2' | 'E3.D3' | 'E3.D4';
  elementLabel: string;
  elementType: string;
  detection: string;
  evidence: string;
  recommendedFix: string;
  confidence: number;
  deduplicationKey: string;
}

const E3_CLOSE_PATTERNS = /\b(onClose|onDismiss|handleClose|handleDismiss|closeModal|dismissModal|setOpen\(false\)|setIsOpen\(false\)|setShow\(false\)|onOpenChange)\b/i;
const E3_CLOSE_BUTTON_RE = /<(?:Button|button)\b[^>]*>([^<]*(?:close|cancel|dismiss|×|✕|X)[^<]*)<\/(?:Button|button)>/gi;
const E3_ESCAPE_RE = /\b(Escape|escape|onEscapeKeyDown|closeOnEsc|closeOnOverlayClick|closeOnBackdropClick)\b/i;

const E3_CANCEL_LABELS = /\b(cancel|back|close|go\s*back|return|previous|exit|skip|dismiss|decline|no\s*thanks)\b/i;
const E3_MARKETING_LABELS = /\b(marketing|newsletter|promotions?|offers?|updates?|emails?|subscribe|notifications?|tracking|analytics|consent|opt.?in|communications?)\b/i;
const E3_STEP_INDICATORS = /\b(step\s*\d|step\s*\w+\s*of\s*\d|\d\s*of\s*\d|\d\s*\/\s*\d|progress|stepper|wizard|multi.?step|onboarding)\b/i;
const E3_BACK_BUTTON = /<(?:Button|button|a)\b[^>]*>([^<]*(?:back|previous|go\s*back|return|←|⬅|ArrowLeft)[^<]*)<\/(?:Button|button|a)>/gi;

function detectE3ControlRestrictions(allFiles: Map<string, string>): E3Finding[] {
  const findings: E3Finding[] = [];
  const seen = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    const lines = content.split('\n');

    // E3.D1 — Modal/Dialog Without Dismissal
    const dialogRe = /<(?:Dialog|dialog|Modal|AlertDialog|Drawer|Sheet)\b([^>]*)>/gi;
    let dm;
    while ((dm = dialogRe.exec(content)) !== null) {
      const lineNum = content.substring(0, dm.index).split('\n').length;
      // Check surrounding region (800 chars after dialog open)
      const regionEnd = Math.min(content.length, dm.index + 800);
      const region = content.slice(dm.index, regionEnd);

      const hasCloseHandler = E3_CLOSE_PATTERNS.test(region);
      const hasCloseButton = E3_CLOSE_BUTTON_RE.test(region);
      E3_CLOSE_BUTTON_RE.lastIndex = 0;
      const hasEscapeHandler = E3_ESCAPE_RE.test(region);
      // DialogClose is a Radix pattern for close buttons
      const hasDialogClose = /DialogClose|SheetClose|DrawerClose/i.test(region);

      if (!hasCloseHandler && !hasCloseButton && !hasEscapeHandler && !hasDialogClose) {
        const key = `${filePath}|E3|E3.D1|${lineNum}`;
        if (!seen.has(key)) {
          seen.add(key);
          const tagName = dm[0].match(/<(\w+)/)?.[1] || 'Dialog';
          findings.push({
            filePath, line: lineNum, subCheck: 'E3.D1',
            elementLabel: `${tagName} component`,
            elementType: 'dialog',
            detection: `Modal/dialog without visible dismissal mechanism`,
            evidence: `<${tagName}> found without close button, onClose handler, escape key handler, or DialogClose component`,
            recommendedFix: 'Add a close/cancel button and ensure the dialog can be dismissed via escape key or backdrop click',
            confidence: 0.75,
            deduplicationKey: key,
          });
        }
      }
    }

    // E3.D2 — Form Without Cancel / Back Option
    const formRe = /<form\b([^>]*)>/gi;
    let fm;
    while ((fm = formRe.exec(content)) !== null) {
      const lineNum = content.substring(0, fm.index).split('\n').length;
      const regionEnd = Math.min(content.length, fm.index + 1200);
      const region = content.slice(fm.index, regionEnd);

      // Count inputs to detect simple login forms
      const inputCount = (region.match(/<(?:Input|input)\b/gi) || []).length;

      // Check for submit buttons
      const hasSubmit = /<(?:Button|button)\b[^>]*(?:type\s*=\s*["']submit["'])[^>]*>|<(?:Button|button)\b[^>]*>([^<]*(?:submit|continue|confirm|save|send|next|create|sign\s*up|register|log\s*in|sign\s*in)[^<]*)<\/(?:Button|button)>/gi.test(region);

      // Check for cancel/back
      const hasCancelButton = E3_CANCEL_LABELS.test(
        (region.match(/<(?:Button|button|a)\b[^>]*>([^<]{1,40})<\/(?:Button|button|a)>/gi) || [])
          .map(m => m.replace(/<[^>]*>/g, '')).join(' ')
      );

      // Exclude simple login forms (≤2 inputs + submit)
      const isSimpleLogin = inputCount <= 2 && /\b(log\s*in|sign\s*in|login|password)\b/i.test(region);

      if (hasSubmit && !hasCancelButton && !isSimpleLogin && inputCount >= 1) {
        const key = `${filePath}|E3|E3.D2|${lineNum}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push({
            filePath, line: lineNum, subCheck: 'E3.D2',
            elementLabel: 'Form without cancel/back',
            elementType: 'form',
            detection: `Form has submit action but no cancel, back, or close option`,
            evidence: `<form> with ${inputCount} input(s) and submit button but no cancel/back/close CTA in the same region`,
            recommendedFix: 'Add a cancel or back button to allow users to exit the form without submitting',
            confidence: 0.65,
            deduplicationKey: key,
          });
        }
      }
    }

    // E3.D3 — Forced Required Opt-In
    const checkboxRe = /<(?:Input|input|Checkbox)\b([^>]*(?:type\s*=\s*["']checkbox["']|checkbox)[^>]*)(?:\/>|>)/gi;
    let cm;
    while ((cm = checkboxRe.exec(content)) !== null) {
      const attrs = cm[1] || '';
      const isRequired = /\brequired\b/i.test(attrs);
      if (!isRequired) continue;

      const lineNum = content.substring(0, cm.index).split('\n').length;
      // Check nearby label text
      const regionStart = Math.max(0, cm.index - 200);
      const regionEnd = Math.min(content.length, cm.index + 300);
      const region = content.slice(regionStart, regionEnd);

      if (E3_MARKETING_LABELS.test(region)) {
        const key = `${filePath}|E3|E3.D3|${lineNum}`;
        if (!seen.has(key)) {
          seen.add(key);
          // Extract label text
          const labelMatch = region.match(/<(?:Label|label)\b[^>]*>([^<]{3,80})<\/(?:Label|label)>/i);
          const labelText = labelMatch ? labelMatch[1].replace(/\{[^}]*\}/g, '').trim() : 'marketing/consent checkbox';

          findings.push({
            filePath, line: lineNum, subCheck: 'E3.D3',
            elementLabel: `Required opt-in: "${labelText}"`,
            elementType: 'checkbox',
            detection: `Required checkbox for marketing/consent with no opt-out alternative`,
            evidence: `<input type="checkbox" required> with label relating to marketing/consent ("${labelText}") and no visible opt-out path`,
            recommendedFix: 'Make the opt-in optional or provide a visible alternative that does not require consent to proceed',
            confidence: 0.75,
            deduplicationKey: key,
          });
        }
      }
    }

    // E3.D4 — Multi-Step Flow Without Back
    if (E3_STEP_INDICATORS.test(content)) {
      // Find step indicator locations
      const stepRe = new RegExp(E3_STEP_INDICATORS.source, 'gi');
      let sm;
      while ((sm = stepRe.exec(content)) !== null) {
        const lineNum = content.substring(0, sm.index).split('\n').length;
        // Check for back navigation in file
        E3_BACK_BUTTON.lastIndex = 0;
        const hasBackButton = E3_BACK_BUTTON.test(content);
        const hasPrevStep = /\b(prevStep|previousStep|goBack|handleBack|onBack|stepBack|setStep\s*\(\s*(?:step|currentStep)\s*-\s*1\))\b/i.test(content);

        if (!hasBackButton && !hasPrevStep) {
          const key = `${filePath}|E3|E3.D4|${lineNum}`;
          if (!seen.has(key)) {
            seen.add(key);
            findings.push({
              filePath, line: lineNum, subCheck: 'E3.D4',
              elementLabel: 'Multi-step flow without back navigation',
              elementType: 'stepper',
              detection: `Step indicator detected but no back/previous button or navigation control`,
              evidence: `Step indicator pattern ("${sm[0]}") found without back button or previous-step handler in the same file`,
              recommendedFix: 'Add a back/previous button to allow users to navigate to earlier steps',
              confidence: 0.70,
              deduplicationKey: key,
            });
          }
          break; // One finding per file for D4
        }
      }
    }
  }

  return findings.slice(0, 30);
}

function formatE3FindingsForPrompt(findings: E3Finding[]): string {
  if (findings.length === 0) return '';
  const lines = [
    '[E3_CONTROL_RESTRICTION_EVIDENCE]',
    'IMPORTANT: Location references are for traceability ONLY. Do NOT use file names as evidence. Assess ONLY the structural control restriction signals below.',
  ];
  for (const f of findings) {
    lines.push(`\n--- Location: ${f.filePath}:${f.line} (${f.subCheck}) ---`);
    lines.push(`  Element: ${f.elementLabel} (${f.elementType})`);
    lines.push(`  Detection: ${f.detection}`);
    lines.push(`  Evidence: ${f.evidence}`);
  }
  lines.push('[/E3_CONTROL_RESTRICTION_EVIDENCE]');
  return lines.join('\n');
}

function formatE1EvidenceBundleForPrompt(bundles: E1EvidenceBundle[]): string {
  if (bundles.length === 0) return '';
  const lines = [
    '[E1_EVIDENCE_BUNDLE]',
    'IMPORTANT: Location references are for traceability ONLY. Do NOT use file names as evidence. Evaluate ONLY the extracted CTA labels and nearby UI text.',
  ];
  for (const b of bundles) {
    lines.push(`\n--- Location: ${b.filePath} ---`);
    lines.push(`  CTA: "${b.ctaLabel}" (type: ${b.ctaType})`);
    if (b.nearbyText.length > 0) lines.push(`  Nearby text: ${b.nearbyText.join(' | ')}`);
    lines.push(`  Flags: confirmation=${b.hasConfirmationDialog}, warning=${b.hasWarningText}, pricing=${b.hasPricingText}`);
  }
  lines.push('[/E1_EVIDENCE_BUNDLE]');
  return lines.join('\n');
}

// ========== U6 LAYOUT EVIDENCE BUNDLE EXTRACTION (Weak Grouping / Layout Coherence) ==========
interface U6LayoutEvidence {
  filePath: string;
  headings: string[];
  sectionCount: number;
  fieldsetCount: number;
  articleCount: number;
  cardWrapperCount: number;
  maxDivDepth: number;
  flexCount: number;
  gridCount: number;
  spacingTokens: string[];
  repeatedBlockCount: number;
  flatStackCues: string[];
}

function extractU6LayoutEvidence(allFiles: Map<string, string>): U6LayoutEvidence[] {
  const bundles: U6LayoutEvidence[] = [];

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    // 1) Headings and section titles
    const headings: string[] = [];
    const hRe = /<h([1-6])\b[^>]*>([^<]{2,80})<\/h\1>/gi;
    let hm;
    while ((hm = hRe.exec(content)) !== null) {
      const text = hm[2].replace(/\{[^}]*\}/g, '').trim();
      if (text.length >= 2) headings.push(`h${hm[1]}: ${text}`);
    }
    // role=heading
    const roleHeadingRe = /role\s*=\s*["']heading["'][^>]*>([^<]{2,60})</gi;
    let rhm;
    while ((rhm = roleHeadingRe.exec(content)) !== null) {
      headings.push(`role=heading: ${rhm[1].trim()}`);
    }
    // Tailwind large text as pseudo-headings
    const twHeadingRe = /className\s*=\s*["'][^"']*\b(text-(?:xl|2xl|3xl|4xl|5xl|6xl))\b[^"']*font-bold[^"']*["'][^>]*>([^<]{2,60})/gi;
    let thm;
    while ((thm = twHeadingRe.exec(content)) !== null) {
      headings.push(`styled-heading (${thm[1]}): ${thm[2].trim()}`);
    }

    // 2) Container structure
    const sectionCount = (content.match(/<section\b/gi) || []).length;
    const fieldsetCount = (content.match(/<fieldset\b/gi) || []).length;
    const articleCount = (content.match(/<article\b/gi) || []).length;
    const cardWrapperCount = (content.match(/<(?:Card|div)\b[^>]*(?:card|Card)[^>]*>/gi) || []).length;

    // Rough div depth
    let maxDepth = 0, curDepth = 0;
    const divOpenRe = /<div\b/gi;
    const divCloseRe = /<\/div>/gi;
    let pos = 0;
    for (const ch of content) {
      pos++;
    }
    // Simple approach: count max nesting
    const opens = (content.match(/<div\b/gi) || []).length;
    const closes = (content.match(/<\/div>/gi) || []).length;
    maxDepth = Math.min(opens, closes); // rough proxy

    // 3) Layout primitives
    const flexCount = (content.match(/\bflex\b/g) || []).length;
    const gridCount = (content.match(/\bgrid\b/g) || []).length;

    // Spacing tokens
    const spacingTokenSet = new Set<string>();
    const spacingRe = /\b(gap-\d+|space-[xy]-\d+|mb-\d+|mt-\d+|py-\d+|px-\d+|p-\d+|m-\d+)\b/g;
    let sm;
    while ((sm = spacingRe.exec(content)) !== null) {
      spacingTokenSet.add(sm[1]);
    }

    // 4) Repeated blocks (map patterns)
    const mapCount = (content.match(/\.map\s*\(/g) || []).length;

    // 5) Flat stack cues: long sequences of sibling inputs/buttons without headings/wrappers
    const flatStackCues: string[] = [];
    const siblingInputRe = /(<(?:input|Input|textarea|Textarea|select|Select|button|Button)\b[^>]*(?:\/>|>[^<]*<\/(?:input|Input|textarea|Textarea|select|Select|button|Button)>)\s*\n?\s*){3,}/gi;
    if (siblingInputRe.test(content)) {
      flatStackCues.push('3+ sibling form controls without headings/wrappers');
    }
    // Multiple sibling divs without section/fieldset parent
    const flatDivRe = /(?:<div\b[^>]*>[^<]*<\/div>\s*\n?\s*){5,}/gi;
    if (flatDivRe.test(content)) {
      flatStackCues.push('5+ flat sibling divs');
    }

    // Skip files with minimal layout content
    if (headings.length === 0 && sectionCount === 0 && fieldsetCount === 0 && flexCount < 2 && spacingTokenSet.size === 0 && flatStackCues.length === 0) continue;

    bundles.push({
      filePath,
      headings: [...new Set(headings)].slice(0, 8),
      sectionCount,
      fieldsetCount,
      articleCount,
      cardWrapperCount,
      maxDivDepth: maxDepth,
      flexCount,
      gridCount,
      spacingTokens: [...spacingTokenSet].slice(0, 12),
      repeatedBlockCount: mapCount,
      flatStackCues,
    });
  }

  return bundles.slice(0, 15);
}

function formatU6LayoutEvidenceForPrompt(bundles: U6LayoutEvidence[]): string {
  if (bundles.length === 0) return '';
  const lines = [
    '[U6_LAYOUT_EVIDENCE_BUNDLE]',
    'IMPORTANT: Location references below are for traceability ONLY. Do NOT use file names or component names as evidence. Evaluate ONLY the extracted layout cues.',
  ];
  for (const b of bundles) {
    lines.push(`\n--- Location: ${b.filePath} ---`);
    if (b.headings.length > 0) lines.push(`  Headings: ${b.headings.join(' | ')}`);
    lines.push(`  Containers: ${b.sectionCount} <section>, ${b.fieldsetCount} <fieldset>, ${b.articleCount} <article>, ${b.cardWrapperCount} card-like`);
    lines.push(`  Layout: ${b.flexCount} flex, ${b.gridCount} grid, div depth ~${b.maxDivDepth}`);
    if (b.spacingTokens.length > 0) lines.push(`  Spacing tokens: ${b.spacingTokens.join(', ')}`);
    if (b.repeatedBlockCount > 0) lines.push(`  Repeated blocks (map): ${b.repeatedBlockCount}`);
    if (b.flatStackCues.length > 0) lines.push(`  Flat-stack cues: ${b.flatStackCues.join('; ')}`);
  }
  lines.push('[/U6_LAYOUT_EVIDENCE_BUNDLE]');
  return lines.join('\n');
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
  potentialSubtype?: 'borderline' | 'accuracy';
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
  const visualHeadingIssues: A4Finding[] = [];

  const NON_INTERACTIVE_TAGS = 'div|span|p|li|section|article|header|footer|main|aside|nav|figure|figcaption|dd|dt|dl';
  const POINTER_HANDLER_RE = /\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/;
  const HTML_CLICK_HANDLER_RE = /\b(onclick|onmousedown|onmouseup|onkeydown)\s*=/i;
  const INTERACTIVE_ROLES = /\brole\s*=\s*["'](button|link|menuitem|tab|option|checkbox|radio|switch|combobox|listbox|slider|treeitem|gridcell)["']/i;
  const KEY_HANDLER_RE = /\b(onKeyDown|onKeyUp|onKeyPress)\s*=/;
  const TABINDEX_GTE0_RE = /tabIndex\s*=\s*\{?\s*(?:0|[1-9])\s*\}?/i;
  // Visual heading heuristic: large font classes + bold (with responsive prefixes and bracket sizes)
  const LARGE_FONT_RE = /(?:^|\s)(?:(?:sm|md|lg|xl|2xl):)?(?:text-(?:lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)|text-\[\d+(?:px|rem|em)\])\b/;
  const BOLD_RE = /(?:^|\s)(?:(?:sm|md|lg|xl|2xl):)?(?:font-bold|font-semibold|font-extrabold|font-black)\b/;
  // A4.4: list-like intent indicators
  const LIST_INTENT_RE = /^(?:\s*[•\-\*\d]+[\.\)]\s|\s*(?:item|card|entry|row|record)\b)/i;

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

    // A4.1: Heading semantics — scan for h1–h6
    if (/<h1\b/gi.test(content)) hasH1 = true;
    for (let i = 1; i <= 6; i++) {
      if (new RegExp(`<h${i}\\b`, 'i').test(content)) headingLevelsUsed.add(i);
    }

    // A4.1: Visual heading heuristic — div/span/p with large font + bold but no heading role
    const fileHasH1 = /<h1\b/gi.test(content);
    const visualHeadingTags = extractJsxOpeningTags(content, 'div|span|p');
    for (const { tag, attrs, index } of visualHeadingTags) {
      const classMatch = attrs.match(/className\s*=\s*(?:"([^"]+)"|'([^']+)'|\{[`"']([^`"']+)[`"']\})/);
      const cls = classMatch?.[1] || classMatch?.[2] || classMatch?.[3] || '';
      if (!LARGE_FONT_RE.test(cls) || !BOLD_RE.test(cls)) continue;
      // Skip if has heading role
      if (/role\s*=\s*["']heading["']/i.test(attrs)) continue;
      // Check text content length (3–80 chars)
      const afterTag = content.slice(index + attrs.length + tag.length + 2, Math.min(content.length, index + attrs.length + tag.length + 200));
      const textMatch = afterTag.match(/^([^<]{3,80})/);
      if (!textMatch) continue;
      const text = textMatch[1].trim();
      if (text.length < 3 || text.length > 80) continue;

      const lineNumber = content.slice(0, index).split('\n').length;

      // Determine if this is the first heading-like element within the returned JSX block
      // Find the first `return (` or `return(` in the file to locate JSX start
      const returnMatch = content.match(/\breturn\s*\(/);
      const jsxStartIdx = returnMatch ? (returnMatch.index! + returnMatch[0].length) : 0;
      // "Top of page" = first visual heading match that appears after the JSX return
      const isFirstHeadingInJsx = index >= jsxStartIdx && !visualHeadingIssues.some(
        v => v.filePath === filePath && v.detection.includes('visual_heading_no_h1')
      );
      const isTopHeadingCandidate = isFirstHeadingInJsx && !fileHasH1;

      if (isTopHeadingCandidate) {
        // New heuristic: top-of-page visual heading without any <h1> → Potential/borderline
        const dedupeKey = `A4.1|top-visual-heading|${filePath}|${lineNumber}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        visualHeadingIssues.push({
          elementLabel: `Visual heading: "${text.substring(0, 40)}"`, elementType: tag, sourceLabel: text.substring(0, 40),
          filePath, componentName,
          subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
          classification: 'potential',
          detection: `visual_heading_no_h1: Visual heading rendered without semantic heading (<h1> or role="heading" aria-level)`,
          evidence: `<${tag} className="${cls.substring(0, 60)}"> at ${filePath}:${lineNumber}`,
          explanation: `<${tag}> appears to be the page title (large font + bold, near top of component, no <h1> in file) but uses no semantic heading. Screen readers cannot identify it as a heading.`,
          confidence: 0.68,
          correctivePrompt: `Replace <${tag}> with <h1> (or add role="heading" aria-level="1") since it appears to be the primary page heading.`,
          deduplicationKey: dedupeKey,
          potentialSubtype: 'borderline',
        });
      } else {
        // Original heuristic: any visual heading missing semantics → Confirmed
        const dedupeKey = `A4.1|visual-heading|${filePath}|${lineNumber}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        visualHeadingIssues.push({
          elementLabel: `Visual heading: "${text.substring(0, 40)}"`, elementType: tag, sourceLabel: text.substring(0, 40),
          filePath, componentName,
          subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
          classification: 'confirmed',
          detection: `visual_heading_missing_semantics: <${tag}> with ${cls.substring(0, 40)} but no <h1–h6> or role="heading"`,
          evidence: `<${tag} className="${cls.substring(0, 60)}"> at ${filePath}:${lineNumber}`,
          explanation: `<${tag}> element looks like a heading (large font + bold: "${text.substring(0, 40)}") but lacks semantic heading markup. Screen readers cannot identify this as a heading.`,
          confidence: 0.92,
          correctivePrompt: `Replace <${tag}> with an appropriate heading level (<h2>, <h3>, etc.) or add role="heading" aria-level="N".`,
          deduplicationKey: dedupeKey,
        });
      }
    }

    // A4.2: Interactive semantics — using multiline JSX parser
    // Only flag if element has pointer handler + keyboard support EXISTS but ROLE is missing.
    // If keyboard support is also missing → this is A3-C1 territory, suppress A4.2.
    const a4NonInteractiveTags = extractJsxOpeningTags(content, NON_INTERACTIVE_TAGS);
    for (const { tag, attrs, index } of a4NonInteractiveTags) {
      if (!POINTER_HANDLER_RE.test(attrs) && !HTML_CLICK_HANDLER_RE.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      if (/aria-hidden\s*=\s*\{\s*true\s*\}/i.test(attrs)) continue;
      if (INTERACTIVE_ROLES.test(attrs)) continue;

      // Ancestor exemptions (same as A3)
      if (isInsideInteractiveAncestor(content, index)) continue;
      if (isSummaryInDetails(content, index, tag)) continue;

      const hasKeyHandler = KEY_HANDLER_RE.test(attrs);
      const hasTabIndex = TABINDEX_GTE0_RE.test(attrs);

      // If keyboard support is missing (no tabIndex OR no key handler), this is A3-C1 territory.
      // Suppress A4.2 to avoid overlap.
      if (!hasKeyHandler || !hasTabIndex) continue;

      // Has keyboard support but missing semantic role → A4.2 Confirmed
      const lineNumber = content.slice(0, index).split('\n').length;
      const handlerMatch = attrs.match(/\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/) || attrs.match(/\b(onclick|onmousedown|onmouseup|onkeydown)\s*=/i);
      const triggerHandler = handlerMatch?.[1] || 'onClick';

      const afterTag = content.slice(index + attrs.length + tag.length + 2, Math.min(content.length, index + attrs.length + tag.length + 300));
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
        detection: `${triggerHandler} on <${tag}> with keyboard support (tabIndex+keyHandler) but missing semantic role`,
        evidence: `<${tag} ${triggerHandler}=... tabIndex onKeyDown=...> at ${filePath}:${lineNumber} — no role="button"/"link"`,
        explanation: `Clickable <${tag}> has keyboard support but no semantic role (button/link). Screen readers cannot identify this as interactive.`,
        confidence: 0.93,
        correctivePrompt: `Add role="button" or role="link" to <${tag}>, or replace with a native <button>/<a> element.`,
        deduplicationKey: dedupeKey,
      });
    }

    // A4.3: Landmark detection
    if (/<main\b/i.test(content) || /role\s*=\s*["']main["']/i.test(content)) hasMainLandmark = true;
    if (/<nav\b/i.test(content) || /role\s*=\s*["']navigation["']/i.test(content)) hasNavLandmark = true;

    // A4.4: Lists — tightened heuristic (Potential only)
    // Require ≥3 repeated items AND evidence of list-like intent (not just identical Tailwind classes).
    const repeatedClassPattern = /className\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`})/g;
    const classCounts = new Map<string, { count: number; samples: string[] }>();
    let classMatch2;
    while ((classMatch2 = repeatedClassPattern.exec(content)) !== null) {
      const cls = classMatch2[1] || classMatch2[2] || classMatch2[3] || '';
      if (cls.length > 10 && cls.length < 200) {
        const entry = classCounts.get(cls) || { count: 0, samples: [] };
        entry.count++;
        // Grab text after the tag for list-intent checking
        const afterPos = classMatch2.index + classMatch2[0].length;
        const snippet = content.slice(afterPos, Math.min(content.length, afterPos + 200));
        const closingTag = snippet.match(/>\s*([^<]{0,80})/);
        if (closingTag?.[1]) entry.samples.push(closingTag[1].trim());
        classCounts.set(cls, entry);
      }
    }
    for (const [cls, { count, samples }] of classCounts) {
      if (count < 3) continue;
      const hasSemanticList = /<(?:ul|ol)\b/i.test(content) || /role\s*=\s*["']list["']/i.test(content);
      if (hasSemanticList) continue;

      // Check for list-like intent: bullet/number prefixes or "item"/"card"/"entry" wrappers
      const isTailwindOnlyClass = /^[\s\w\-\/\[\]:]+$/.test(cls) && !/\b(?:item|card|entry|row|record|list)\b/i.test(cls);
      const hasListIntent = samples.some(s => LIST_INTENT_RE.test(s)) || /\b(?:item|card|entry|row|record|list)\b/i.test(cls);
      if (isTailwindOnlyClass && !hasListIntent) continue;

      const listDedupeKey = `A4.4|${filePath}|${cls.substring(0, 30)}`;
      if (seenKeys.has(listDedupeKey)) continue;
      seenKeys.add(listDedupeKey);

      listIssues.push({
        elementLabel: `Repeated items (${count}x)`, elementType: 'div', sourceLabel: `Repeated pattern in ${componentName || filePath}`,
        filePath, componentName,
        subCheck: 'A4.4', subCheckLabel: 'List semantics',
        classification: 'potential',
        detection: `${count} sibling elements with identical className and list-like intent, no <ul>/<ol> wrapper`,
        evidence: `Repeated class in ${filePath}: "${cls.substring(0, 60)}..."`,
        explanation: `${count} elements with the same class pattern and list-like content but no semantic list (<ul>/<ol>) structure. Screen readers cannot convey the list relationship.`,
        confidence: 0.82,
        deduplicationKey: listDedupeKey,
      });
    }
  }

  // A4.1: Post-scan heading analysis — missing h1 is Potential (apps may define h1 dynamically)
  if (!hasH1 && headingLevelsUsed.size > 0) {
    headingIssues.push({
      elementLabel: 'Missing <h1>', elementType: 'h1', sourceLabel: 'Page heading',
      filePath: 'global', componentName: undefined,
      subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
      classification: 'potential',
      detection: 'missing_h1: No <h1> found in any source file',
      evidence: `Heading levels used: ${Array.from(headingLevelsUsed).sort().map(l => `h${l}`).join(', ')} — no h1`,
      explanation: 'No <h1> heading found. Pages should generally have one <h1> for the page title, though it may be rendered dynamically.',
      confidence: 0.72,
      correctivePrompt: 'Add exactly one <h1> element for the page title.',
      deduplicationKey: 'A4.1|no-h1',
    });
  }

  // Check for skipped heading levels — Potential
  const sortedLevels = Array.from(headingLevelsUsed).sort();
  for (let i = 1; i < sortedLevels.length; i++) {
    if (sortedLevels[i] - sortedLevels[i - 1] > 1) {
      headingIssues.push({
        elementLabel: `Heading level skip (h${sortedLevels[i - 1]} → h${sortedLevels[i]})`,
        elementType: `h${sortedLevels[i]}`, sourceLabel: 'Heading hierarchy',
        filePath: 'global', componentName: undefined,
        subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
        classification: 'potential',
        detection: `skipped_levels: Heading level skips from h${sortedLevels[i - 1]} to h${sortedLevels[i]}`,
        evidence: `Heading levels used: ${sortedLevels.map(l => `h${l}`).join(', ')}`,
        explanation: `Heading level skips from h${sortedLevels[i - 1]} to h${sortedLevels[i]}. This breaks the logical document outline for screen readers.`,
        confidence: 0.78,
        deduplicationKey: `A4.1|skip-h${sortedLevels[i - 1]}-h${sortedLevels[i]}`,
      });
      break; // Report first skip only
    }
  }

  // Multiple h1s — Potential
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
      detection: `multiple_h1: ${h1Count} <h1> elements found across source files`,
      evidence: `${h1Count} <h1> tags detected`,
      explanation: `Multiple <h1> elements detected. Pages should generally have exactly one <h1> for the page title.`,
      confidence: 0.72,
      deduplicationKey: 'A4.1|multiple-h1',
    });
  }

  // A4.3: Missing landmarks — Potential
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

  findings.push(...headingIssues, ...visualHeadingIssues, ...clickableNonSemantics, ...landmarkIssues, ...listIssues);
  return findings;
}

// ========== A5 DETERMINISTIC DETECTION (Missing Form Labels) ==========
interface A5Finding {
  elementKey: string; // Stable identity: hash of tag + id + name + type + filePath + lineNumber
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
  confidence?: number; // Only for potential findings
  wcagCriteria: string[]; // e.g., ["1.3.1", "3.3.2"]
  correctivePrompt?: string;
  advisoryGuidance?: string;
  deduplicationKey: string;
  potentialSubtype?: 'accuracy' | 'borderline';
}

function makeA5ElementKey(tag: string, id: string, name: string, type: string, filePath: string, lineNumber: number): string {
  return `a5:${tag}|${id}|${name}|${type}|${filePath}|${lineNumber}`;
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
    const ARIA_INPUT_ROLES = /\brole\s*=\s*["'](textbox|combobox|searchbox|spinbutton|listbox)["']/i;
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
              elementKey: makeA5ElementKey(tag, controlId, elementName, inputSubtype || tag, filePath, lineNumber),
              elementLabel: label, elementType: tag, inputSubtype, sourceLabel: label, filePath, componentName,
              subCheck: 'A5.3', subCheckLabel: 'Broken label association',
              classification: 'confirmed',
              detection: `Duplicate id="${controlId}" — ambiguous label association`,
              evidence: `<${tag} id="${controlId}"> at ${filePath}:${lineNumber} — ${idCount} elements share this id`,
              explanation: `Multiple elements share id="${controlId}", creating ambiguous label-control association.`,
              wcagCriteria: ['1.3.1', '3.3.2'],
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
            elementKey: makeA5ElementKey(tag, controlId || '', elementName, inputSubtype || tag, filePath, lineNumber),
            elementLabel: label, elementType: tag, inputSubtype, sourceLabel: label, filePath, componentName,
            subCheck: 'A5.2', subCheckLabel: 'Placeholder used as label',
            classification: 'confirmed',
            detection: `<${tag}> has placeholder="${placeholder}" but no label/aria-label/aria-labelledby`,
            evidence: `<${tag} placeholder="${placeholder}"> at ${filePath}:${lineNumber} — missing label association`,
            explanation: `Placeholder text "${placeholder}" is the only label. Placeholders disappear on input and are not reliably announced by all screen readers.`,
            wcagCriteria: ['1.3.1', '3.3.2'],
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
          elementKey: makeA5ElementKey(tag, controlId || '', elementName, inputSubtype || tag, filePath, lineNumber),
          elementLabel: label, elementType: tag, inputSubtype, sourceLabel: label, filePath, componentName,
          subCheck: 'A5.1', subCheckLabel: 'Missing label association',
          classification: 'confirmed',
          detection: `<${tag}> has no label, aria-label, or aria-labelledby`,
          evidence: `<${tag}> at ${filePath}:${lineNumber} — no programmatic label source found`,
          explanation: `Form control <${tag}> has no accessible name. Screen readers cannot identify what this control is for.`,
          wcagCriteria: ['1.3.1', '3.3.2'],
          correctivePrompt: `[${label} (${tag})] — ${fileName}\n\nIssue reason:\nThis form control has no programmatic label (no <label>, aria-label, or aria-labelledby).\n\nRecommended fix:\nAdd a visible <label> associated with this input using for + id, or provide an accessible name via aria-label or aria-labelledby.`,
          deduplicationKey: dedupeKey,
        });
      }
    }

    // Also detect ARIA input roles on non-form elements
    const ariaInputRegex = new RegExp(`<(div|span|p|section)\\b([^>]*role\\s*=\\s*["'](?:textbox|combobox|searchbox|spinbutton|listbox)["'][^>]*)>`, 'gi');
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
        elementKey: makeA5ElementKey(tag, '', '', role, filePath, lineNumber),
        elementLabel: label, elementType: tag, role, sourceLabel: label, filePath, componentName,
        subCheck: 'A5.1', subCheckLabel: 'Missing label association',
        classification: 'confirmed',
        detection: `<${tag} role="${role}"> has no aria-label or aria-labelledby`,
        evidence: `<${tag} role="${role}"> at ${filePath}:${lineNumber} — no programmatic label`,
        explanation: `Custom input (role="${role}") has no accessible name. Screen readers cannot identify what this control is for.`,
        wcagCriteria: ['1.3.1', '3.3.2', '4.1.2'],
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
        elementKey: makeA5ElementKey(tag, '', '', 'contenteditable', filePath, lineNumber2),
        elementLabel: label2, elementType: tag, role, sourceLabel: label2, filePath, componentName,
        subCheck: 'A5.1', subCheckLabel: 'Missing label association',
        classification: 'confirmed',
        detection: `<${tag} contenteditable="true"> has no aria-label or aria-labelledby`,
        evidence: `<${tag} contenteditable="true"> at ${filePath}:${lineNumber2} — no programmatic label`,
        explanation: `Contenteditable element (role="${role}") has no accessible name.`,
        wcagCriteria: ['1.3.1', '3.3.2', '4.1.2'],
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
            elementKey: makeA5ElementKey('label', forTarget, '', 'label', filePath, 0),
            elementLabel: `label[for="${forTarget}"]`, elementType: 'label', sourceLabel: `Orphan label for="${forTarget}"`, filePath, componentName,
            subCheck: 'A5.3', subCheckLabel: 'Broken label association',
            classification: 'confirmed',
            detection: `<label for="${forTarget}"> references non-existent id`,
            evidence: `label for="${forTarget}" in ${filePath} — no element with id="${forTarget}" found`,
            explanation: `A <label for="${forTarget}"> exists but no form control with id="${forTarget}" was found.`,
            wcagCriteria: ['1.3.1', '3.3.2'],
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
            elementKey: makeA5ElementKey(tag, controlId || '', elementName, tag, filePath, lineNumber),
            elementLabel: accessibleName, elementType: tag, sourceLabel: accessibleName, filePath, componentName,
            subCheck: 'A5.4', subCheckLabel: 'Generic label text',
            classification: 'potential', potentialSubtype: 'borderline',
            detection: `<${tag}> label "${accessibleName}" is generic`,
            evidence: `label text "${accessibleName}" at ${filePath}:${lineNumber}`,
            explanation: `The label "${accessibleName}" is too generic to be meaningful. Users relying on screen readers cannot distinguish this control from others.`,
            confidence: 0.88,
            wcagCriteria: ['1.3.1', '3.3.2'],
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
              elementKey: makeA5ElementKey(tag, controlId || '', elementName, tag, filePath, lineNumber),
              elementLabel: label, elementType: tag, sourceLabel: label, filePath, componentName,
              subCheck: 'A5.6', subCheckLabel: 'Noisy aria-labelledby',
              classification: 'potential', potentialSubtype: 'borderline',
              detection: `<${tag}> aria-labelledby resolves to noisy/long text`,
              evidence: `Resolved text: "${accessibleName.slice(0, 80)}${accessibleName.length > 80 ? '…' : ''}" at ${filePath}:${lineNumber}`,
              explanation: `The aria-labelledby resolves to text that is too long (${accessibleName.length} chars) or contains advisory tokens (optional/required/hint). This creates a confusing experience for screen reader users.`,
              confidence: 0.82,
              wcagCriteria: ['1.3.1', '3.3.2'],
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
        elementKey: makeA5ElementKey(controls[0].tag, '', '', controls[0].tag, controls[0].filePath, controls[0].line),
        elementLabel: controls[0].label, elementType: controls[0].tag, sourceLabel: controls[0].label,
        filePath: controls[0].filePath, componentName: controls[0].componentName,
        subCheck: 'A5.5', subCheckLabel: 'Duplicate label text',
        classification: 'potential', potentialSubtype: 'borderline',
        detection: `${controls.length} controls share label "${controls[0].label}"`,
        evidence: `Duplicate label "${controls[0].label}": ${controlList}`,
        explanation: `Multiple controls share the same accessible name "${controls[0].label}". Screen reader users cannot distinguish between them.`,
        confidence: 0.90,
        wcagCriteria: ['1.3.1', '3.3.2'],
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
  wcagCriteria: string[]; // Always ["4.1.2"]
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
            wcagCriteria: ['4.1.2'],
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
        wcagCriteria: ['4.1.2'],
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

    // Extract U4 evidence bundle (context for LLM, not deterministic triggers)
    const u4EvidenceBundles = selectedRulesSet.has('U4') ? extractU4EvidenceBundle(allFiles) : [];
    const u4BundleText = formatU4EvidenceBundleForPrompt(u4EvidenceBundles);

    // Extract U6 layout evidence bundle (context for LLM layout assessment)
    const u6LayoutBundles = selectedRulesSet.has('U6') ? extractU6LayoutEvidence(allFiles) : [];
    const u6BundleText = formatU6LayoutEvidenceForPrompt(u6LayoutBundles);

    // Extract E1 evidence bundle (high-impact action transparency)
    const e1EvidenceBundles = selectedRulesSet.has('E1') ? extractE1EvidenceBundle(allFiles) : [];
    const e1BundleText = formatE1EvidenceBundleForPrompt(e1EvidenceBundles);

    // Extract E2 choice bundle (choice architecture balance)
    const e2ChoiceBundles = selectedRulesSet.has('E2') ? extractE2ChoiceBundle(allFiles) : [];
    const e2BundleText = formatE2ChoiceBundleForPrompt(e2ChoiceBundles);

    // Extract E3 control restriction evidence (deterministic detection)
    const e3Findings = selectedRulesSet.has('E3') ? detectE3ControlRestrictions(allFiles) : [];
    const e3BundleText = formatE3FindingsForPrompt(e3Findings);
    console.log(`E3 deterministic: ${e3Findings.length} candidate(s) found`);

    // Build analysis prompt
    const systemPrompt = buildCodeAnalysisPrompt(selectedRules);

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Analyze the following source code files from a ${toolUsed} project (detected stack: ${stack}). 
        
Perform the complete 3-pass analysis (Accessibility, Usability, Ethics) based on the code patterns and return findings in the specified JSON format.

${codeContent}${u4BundleText ? '\n\n' + u4BundleText : ''}${u6BundleText ? '\n\n' + u6BundleText : ''}${e1BundleText ? '\n\n' + e1BundleText : ''}${e2BundleText ? '\n\n' + e2BundleText : ''}${e3BundleText ? '\n\n' + e3BundleText : ''}`,
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
    
    // A2 is now fully deterministic — LLM A2 findings are discarded
    const otherViolations: any[] = [];
    
    filteredBySelection.forEach((v: any) => {
      if (v.ruleId === 'A2' || v.ruleId === 'A5') {
        // Discard LLM A2 findings — deterministic engine handles A2
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
    
    // Process non-A2/U1 violations — tag with evaluationMethod
    const filteredOtherViolations = [...nonU1OtherViolations, ...validatedU1Violations]
      .map((v: any) => {
        const rule = allRules.find(r => r.id === v.ruleId);
        // Determine evaluationMethod based on rule classification
        const isHybridRule = HYBRID_RULES_SET.has(v.ruleId);
        const evaluationMethod = isHybridRule ? 'hybrid_llm_fallback' : 'llm_assisted';
        return {
          ...v,
          correctivePrompt: rule?.correctivePrompt || v.correctivePrompt || '',
          evaluationMethod,
        };
      });

    // ========== A2 Focus Visibility — Fully Deterministic ==========
    let aggregatedA2: any = null;
    if (selectedRulesSet.has('A2')) {
      const a2Findings = detectA2FocusVisibility(allFiles);
      if (a2Findings.length > 0) {
        const confirmedFindings = a2Findings.filter(f => f.classification === 'confirmed');
        const potentialFindings = a2Findings.filter(f => f.classification === 'potential');
        const confirmedCount = confirmedFindings.length;
        const heuristicCount = potentialFindings.length;
        const hasConfirmedItems = confirmedCount > 0;
        const overallConfidence = Math.max(...a2Findings.map(f => f.confidence));
        const a2Status = hasConfirmedItems ? 'confirmed' : 'potential';
        
        const a2Elements = a2Findings.map(f => ({
          elementLabel: f.sourceLabel,
          elementType: f.elementType,
          role: f.elementType,
          accessibleName: '',
          sourceLabel: f.sourceLabel,
          selectorHint: `<${f.elementType || 'element'}> in ${f.filePath}`,
          location: f.filePath,
          detection: f.detection,
          detectionMethod: 'deterministic' as const,
          focusClasses: f.focusClasses,
          classification: f.classification,
          potentialSubtype: f.potentialSubtype,
          potentialReason: f.potentialReason,
          explanation: f.explanation,
          confidence: f.confidence,
          correctivePrompt: f.correctivePrompt,
          deduplicationKey: f.deduplicationKey,
          _a2Debug: f._a2Debug,
        }));
        
        const typeBreakdown = [
          confirmedCount > 0 ? `${confirmedCount} confirmed violation(s)` : '',
          heuristicCount > 0 ? `${heuristicCount} borderline risk(s)` : '',
        ].filter(Boolean).join(' and ');
        
        aggregatedA2 = {
          ruleId: 'A2',
          ruleName: 'Poor focus visibility',
          category: 'accessibility',
          status: a2Status,
          potentialSubtype: hasConfirmedItems ? undefined : 'borderline',
          blocksConvergence: a2Status === 'confirmed',
          inputType: 'zip',
          isA2Aggregated: true,
          a2Elements,
          evaluationMethod: 'deterministic',
          diagnosis: `Focus visibility issues detected: ${typeBreakdown}. Elements that remove the default focus outline without a visible focus indicator.`,
          contextualHint: 'Interactive elements remove the default focus outline without a visible replacement indicator.',
          correctivePrompt: 'Add a visible focus indicator (focus ring, border change, shadow, or distinct background change) for interactive elements that remove the default outline.',
          confidence: Math.round(overallConfidence * 100) / 100,
          ...(a2Status === 'potential' ? {
            advisoryGuidance: 'Focus styling exists but may be too subtle. Consider using a clearer focus-visible indicator.',
          } : {}),
        };
        
        console.log(`A2 deterministic: ${a2Findings.length} findings → 1 result (${confirmedCount} confirmed, ${heuristicCount} borderline)`);
      } else {
        console.log('A2 deterministic: No violations found');
      }
    }
    
    let aiViolations = [
      ...filteredOtherViolations,
      ...(aggregatedA2 ? [aggregatedA2] : []),
    ];

    // ========== Deterministic U1 (primary action sub-checks) ==========
    // Split into up to TWO violation objects: one confirmed, one potential
    const aggregatedU1List: any[] = [];
    if (selectedRulesSet.has('U1')) {
      const u1Findings = detectU1PrimaryAction(allFiles);
      if (u1Findings.length > 0) {
        aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'U1');
        const confirmedFindings = u1Findings.filter(f => f.classification === 'confirmed');
        const potentialFindings = u1Findings.filter(f => f.classification === 'potential');

        const mapElements = (list: typeof u1Findings) => list.map(f => ({
          elementLabel: f.elementLabel, elementType: f.elementType,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          explanation: f.explanation, confidence: f.confidence,
          advisoryGuidance: f.advisoryGuidance, deduplicationKey: f.deduplicationKey,
        }));

        if (confirmedFindings.length > 0) {
          aggregatedU1List.push({
            ruleId: 'U1', ruleName: 'Unclear primary action', category: 'usability',
            status: 'confirmed',
            blocksConvergence: false,
            inputType: 'zip', isU1Aggregated: true, u1Elements: mapElements(confirmedFindings), evaluationMethod: 'hybrid_deterministic',
            diagnosis: `Primary action clarity issues: ${confirmedFindings.length} confirmed violation(s).`,
            contextualHint: 'Establish a clear visual hierarchy with one primary action per group.',
            confidence: 1.0,
          });
        }

        if (potentialFindings.length > 0) {
          const potentialConfidence = Math.max(...potentialFindings.map(f => f.confidence));
          aggregatedU1List.push({
            ruleId: 'U1', ruleName: 'Unclear primary action', category: 'usability',
            status: 'potential',
            blocksConvergence: false,
            inputType: 'zip', isU1Aggregated: true, u1Elements: mapElements(potentialFindings), evaluationMethod: 'hybrid_deterministic',
            diagnosis: `Primary action clarity issues: ${potentialFindings.length} potential risk(s).`,
            contextualHint: 'Establish a clear visual hierarchy with one primary action per group.',
            advisoryGuidance: 'Visually distinguish the primary action (stronger color/weight/placement) and use specific labels.',
            confidence: Math.round(potentialConfidence * 100) / 100,
          });
        }

        console.log(`U1 aggregated: ${u1Findings.length} findings → ${aggregatedU1List.length} violation object(s) (${confirmedFindings.length} confirmed, ${potentialFindings.length} potential)`);
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
           evaluationMethod: 'deterministic',
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
          potentialSubtype: f.classification === 'potential' ? (f.potentialSubtype || 'borderline') as 'borderline' | 'accuracy' : undefined,
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
          blocksConvergence: hasConfirmed, inputType: 'zip', isA4Aggregated: true, a4Elements, evaluationMethod: 'deterministic',
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
        const a5Elements = a5Findings.map(f => ({
          elementKey: f.elementKey,
          elementLabel: f.sourceLabel, elementType: f.elementType, inputSubtype: f.inputSubtype,
          role: f.role, sourceLabel: f.sourceLabel,
          location: f.filePath, filePath: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          explanation: f.explanation,
          ...(f.classification === 'potential' ? { confidence: f.confidence } : {}),
          wcagCriteria: f.wcagCriteria,
          correctivePrompt: f.correctivePrompt,
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
          blocksConvergence: hasConfirmed, inputType: 'zip', isA5Aggregated: true, a5Elements, evaluationMethod: 'deterministic',
          diagnosis: `Form label issues detected: ${confirmedFindings.length} confirmed, ${potentialFindings.length} potential (${subCheckBreakdown}). WCAG 1.3.1 and 3.3.2 require form controls to have programmatic labels.`,
          contextualHint: 'Add visible <label> elements or aria-label/aria-labelledby for all form controls.',
          correctivePrompt: hasConfirmed ? 'Add visible <label> elements associated with form controls using for/id, or provide accessible names via aria-label/aria-labelledby. Do not rely on placeholder text as the sole label.' : undefined,
          advisoryGuidance: potentialFindings.length > 0 ? 'Review label quality: avoid generic text, duplicate labels, title-only naming, and noisy aria-labelledby references.' : undefined,
          confidence: hasConfirmed ? 0.97 : 0.88,
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
          location: f.filePath, filePath: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          explanation: f.explanation, wcagCriteria: f.wcagCriteria,
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
          status: 'confirmed', blocksConvergence: true, inputType: 'zip', isA6Aggregated: true, a6Elements, evaluationMethod: 'deterministic',
          diagnosis: `Accessible name issues detected: ${a6Findings.length} confirmed (${breakdown}). WCAG 4.1.2 requires interactive elements to have programmatic accessible names.`,
          contextualHint: 'Add visible text, aria-label, or aria-labelledby to interactive elements.',
          correctivePrompt: 'Add visible text content, aria-label, or aria-labelledby to interactive elements. For icon-only buttons/links, add an aria-label.',
          confidence: 1,
        };
        console.log(`A6 aggregated: ${a6Findings.length} findings (${a61Count} missing names, ${a62Count} broken refs)`);
      } else {
        console.log('A6: No accessible name issues found');
      }
    }

    // Aggregate per-element A1 findings into confirmed + potential cards
    const aggregatedA1Violations: any[] = [];
    if (contrastViolations.length > 0) {
      const confirmedFindings = contrastViolations.filter(v => v.status === 'confirmed');
      const potentialFindings = contrastViolations.filter(v => v.status !== 'confirmed');
      
      const mapToElement = (v: any) => {
        const ratioStr = v.contrastRatio != null ? `${v.contrastRatio.toFixed(1)}:1` : 'unknown';
        const threshStr = `${v.thresholdUsed || 4.5}:1`;
        const sizeLabel = v.sizeStatus === 'large' ? 'large' : 'normal';
        const fgHex = v.foregroundHex || '???';
        const bgHex = v.backgroundHex || '#FFFFFF';
        const prompt = v.status === 'confirmed'
          ? `Issue reason: ${ratioStr} measured vs ${threshStr} required (WCAG AA, ${sizeLabel} text).\n\nRecommended fix: Increase text contrast for this element (currently ${fgHex} on ${bgHex}) by darkening the text color or adjusting the background to reach ≥${threshStr}; keep visual style consistent across similar elements.`
          : undefined;
        return {
          elementLabel: v.elementIdentifier || v.elementDescription || 'Unknown element',
          textSnippet: v.evidence,
          location: v.evidence || '',
          foregroundHex: v.foregroundHex,
          backgroundHex: v.backgroundHex,
          backgroundStatus: (v.backgroundStatus || 'unmeasurable') as 'certain' | 'uncertain' | 'unmeasurable',
          contrastRatio: v.contrastRatio,
          contrastNotMeasurable: v.contrastRatio === undefined,
          thresholdUsed: (v.thresholdUsed || 4.5) as 4.5 | 3.0,
          explanation: v.diagnosis,
          reasonCodes: v.reasonCodes || ['STATIC_ANALYSIS'],
          jsxTag: v.affectedComponents?.[0]?.jsxTag,
          textType: v.sizeStatus === 'large' ? 'large' : 'normal',
          appliedThreshold: v.thresholdUsed || 4.5,
          wcagCriterion: '1.4.3' as const,
          deduplicationKey: `a1|${v.elementIdentifier}|${v.foregroundHex}`,
          correctivePrompt: prompt,
        };
      };
      
      if (confirmedFindings.length > 0) {
        const a1Elements = confirmedFindings.map(mapToElement);
        const avgConf = confirmedFindings.reduce((s, v) => s + v.confidence, 0) / confirmedFindings.length;
        aggregatedA1Violations.push({
          ruleId: 'A1',
          ruleName: 'Insufficient text contrast',
          category: 'accessibility',
          status: 'confirmed',
          isA1Aggregated: true,
          a1Elements,
          diagnosis: `${a1Elements.length} text element${a1Elements.length !== 1 ? 's' : ''} with confirmed contrast violations (WCAG 1.4.3).`,
          correctivePrompt: a1Elements.map(e => e.explanation).join('\n'),
          contextualHint: 'Both foreground and background resolved from Tailwind tokens.',
          confidence: Math.round(avgConf * 100) / 100,
          blocksConvergence: true,
          inputType: 'zip',
          samplingMethod: 'inferred',
          evaluationMethod: 'deterministic',
          evidenceLevel: 'structural_deterministic',
        });
      }
      
      if (potentialFindings.length > 0) {
        const a1Elements = potentialFindings.map(mapToElement);
        const avgConf = potentialFindings.reduce((s, v) => s + v.confidence, 0) / potentialFindings.length;
        aggregatedA1Violations.push({
          ruleId: 'A1',
          ruleName: 'Insufficient text contrast',
          category: 'accessibility',
          status: 'potential',
          isA1Aggregated: true,
          a1Elements,
          diagnosis: `${a1Elements.length} text element${a1Elements.length !== 1 ? 's' : ''} with potential contrast issues (WCAG 1.4.3) — verify at runtime.`,
          correctivePrompt: 'Verify text contrast meets WCAG AA requirements (4.5:1 for normal text, 3:1 for large text) using browser DevTools after rendering.',
          contextualHint: 'Verify contrast with browser DevTools or accessibility testing tools after rendering.',
          confidence: Math.round(avgConf * 100) / 100,
          reasonCodes: ['STATIC_ANALYSIS'],
          potentialRiskReason: 'STATIC_ANALYSIS',
          advisoryGuidance: 'Upload screenshots of the rendered UI for higher-confidence verification.',
          blocksConvergence: false,
          inputType: 'zip',
          samplingMethod: 'inferred',
          evaluationMethod: 'deterministic',
          evidenceLevel: 'structural_estimated',
        });
      }
      
      const confirmed = confirmedFindings.length;
      const potential = potentialFindings.length;
      console.log(`A1 aggregated (ZIP): ${confirmed} confirmed, ${potential} potential → ${aggregatedA1Violations.length} card(s)`);
    }

    // Merge aggregated A1 with AI violations (no raw contrast violations)
    // ========== Deterministic U2 (navigation sub-checks) ==========
    const aggregatedU2List: any[] = [];
    if (selectedRulesSet.has('U2')) {
      const u2Findings = detectU2Navigation(allFiles);
      if (u2Findings.length > 0) {
        // Remove any LLM-generated U2 findings — deterministic takes precedence
        aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'U2');

        const u2Elements = u2Findings.map(f => ({
          elementLabel: f.elementLabel, elementType: f.elementType,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          explanation: f.explanation, confidence: f.confidence,
          advisoryGuidance: f.advisoryGuidance, deduplicationKey: f.deduplicationKey,
        }));

        const overallConfidence = Math.max(...u2Findings.map(f => f.confidence));
        aggregatedU2List.push({
          ruleId: 'U2', ruleName: 'Incomplete / Unclear navigation', category: 'usability',
          status: 'potential',
          blocksConvergence: false,
          inputType: 'zip', isU2Aggregated: true, u2Elements, evaluationMethod: 'hybrid_structural',
          diagnosis: `Navigation clarity issues: ${u2Findings.length} potential risk(s) detected via structural analysis.`,
          contextualHint: 'Ensure clear navigation paths with visible indicators of current location.',
          advisoryGuidance: 'Review navigation structure: ensure <nav> containers, breadcrumbs, and back affordances are present in multi-route applications.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });

        console.log(`U2 aggregated: ${u2Findings.length} findings → 1 potential violation object`);
      } else {
        // If no deterministic signals, keep LLM U2 findings but ensure they are Potential
        aiViolations = aiViolations.map((v: any) => {
          if (v.ruleId === 'U2') {
            return {
              ...v,
              status: 'potential',
              blocksConvergence: false,
              evaluationMethod: 'hybrid_llm_fallback',
              confidence: Math.min(v.confidence || 0.65, 0.75),
            };
          }
          return v;
        });
        console.log('U2: No deterministic signals found, LLM findings (if any) preserved as Potential');
      }
    }

    // ========== Deterministic U3 (content accessibility sub-checks) ==========
    const aggregatedU3List: any[] = [];
    if (selectedRulesSet.has('U3')) {
      const u3Findings = detectU3ContentAccessibility(allFiles);
      if (u3Findings.length > 0) {
        // Remove any LLM-generated U3 findings — deterministic takes precedence
        aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'U3');

        const u3Elements = u3Findings.map(f => ({
          elementLabel: f.elementLabel, elementType: f.elementType,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          textPreview: f.textPreview,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          confidence: f.confidence,
          advisoryGuidance: f.advisoryGuidance, deduplicationKey: f.deduplicationKey,
        }));

        const overallConfidence = Math.max(...u3Findings.map(f => f.confidence));
        aggregatedU3List.push({
          ruleId: 'U3', ruleName: 'Truncated or inaccessible content', category: 'usability',
          status: 'potential',
          blocksConvergence: false,
          inputType: 'zip', isU3Aggregated: true, u3Elements, evaluationMethod: 'deterministic_structural',
          diagnosis: `Content accessibility issues: ${u3Findings.length} potential risk(s) detected via structural analysis.`,
          contextualHint: 'Ensure all meaningful text is fully visible or has an accessible expand mechanism.',
          advisoryGuidance: 'Ensure important content is fully visible or provide an accessible expand mechanism.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });

        console.log(`U3 aggregated: ${u3Findings.length} findings → 1 potential violation object`);
      } else {
        // Ensure any LLM U3 findings are Potential
        aiViolations = aiViolations.map((v: any) => {
          if (v.ruleId === 'U3') {
            return {
              ...v,
              status: 'potential',
              blocksConvergence: false,
              evaluationMethod: 'hybrid_llm_fallback',
              confidence: Math.min(v.confidence || 0.65, 0.75),
            };
          }
          return v;
        });
        console.log('U3: No deterministic signals found, LLM findings (if any) preserved as Potential');
      }
    }

    // ========== U4 POST-PROCESSING (Recognition-to-Recall — LLM-assisted) ==========
    // U4 is fully LLM-assisted. Extract aggregated U4 findings from aiViolations and
    // ensure they are always Potential with confidence capped at 0.80.
    const aggregatedU4List: any[] = [];
    if (selectedRulesSet.has('U4')) {
      const u4FromLLM = aiViolations.filter((v: any) => v.ruleId === 'U4');
      aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'U4');

      if (u4FromLLM.length > 0) {
        // Prefer the structured aggregated form (isU4Aggregated + u4Elements)
        const aggregatedOne = u4FromLLM.find((v: any) => v.isU4Aggregated && v.u4Elements?.length > 0);
        if (aggregatedOne) {
          const u4Elements = (aggregatedOne.u4Elements || []).map((el: any) => ({
            elementLabel: el.elementLabel || 'UI region',
            elementType: el.elementType || 'component',
            location: el.location || el.filePath || 'Unknown',
            detection: el.detection || '',
            evidence: el.evidence || '',
            recommendedFix: el.recommendedFix || '',
            confidence: Math.min(el.confidence || 0.65, 0.80),
            deduplicationKey: el.deduplicationKey || `U4|${el.location || ''}|${el.elementLabel || ''}`,
          }));

          const overallConfidence = Math.min(
            Math.max(...u4Elements.map((e: any) => e.confidence)),
            0.80
          );

          aggregatedU4List.push({
            ruleId: 'U4', ruleName: 'Recognition-to-recall regression', category: 'usability',
            status: 'potential',
            blocksConvergence: false,
            inputType: 'zip', isU4Aggregated: true, u4Elements, evaluationMethod: 'llm_assisted',
            diagnosis: aggregatedOne.diagnosis || `Recognition-to-recall issues: ${u4Elements.length} potential risk(s) detected via AI analysis.`,
            contextualHint: aggregatedOne.contextualHint || 'Make options, labels, and actions visible to reduce reliance on user memory.',
            advisoryGuidance: 'Ensure important choices, actions, and data are visible or easily retrievable. Provide contextual cues, previews, and labels.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
        } else {
          // Fallback: wrap non-aggregated U4 findings into aggregated form
          const u4Elements = u4FromLLM.map((v: any) => ({
            elementLabel: v.evidence?.split('.')[0] || 'UI region',
            elementType: 'component',
            location: v.evidence || 'Unknown',
            detection: v.diagnosis || '',
            evidence: v.evidence || '',
            recommendedFix: v.contextualHint || '',
            confidence: Math.min(v.confidence || 0.65, 0.80),
            deduplicationKey: `U4|${v.evidence || 'unknown'}`,
          }));

          const overallConfidence = Math.min(
            Math.max(...u4FromLLM.map((v: any) => v.confidence || 0.65)),
            0.80
          );

          aggregatedU4List.push({
            ruleId: 'U4', ruleName: 'Recognition-to-recall regression', category: 'usability',
            status: 'potential',
            blocksConvergence: false,
            inputType: 'zip', isU4Aggregated: true, u4Elements, evaluationMethod: 'llm_assisted',
            diagnosis: `Recognition-to-recall issues: ${u4Elements.length} potential risk(s) detected via AI analysis.`,
            contextualHint: 'Make options, labels, and actions visible to reduce reliance on user memory.',
            advisoryGuidance: 'Ensure important choices, actions, and data are visible or easily retrievable. Provide contextual cues, previews, and labels.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
        }
        console.log(`U4 aggregated: ${u4FromLLM.length} LLM finding(s) → ${aggregatedU4List[0]?.u4Elements?.length || 0} element(s)`);
      } else {
        console.log('U4: No LLM findings for recognition-to-recall');
      }
    }

    // ========== Deterministic U5 (Insufficient Interaction Feedback) ==========
    const aggregatedU5List: any[] = [];
    if (selectedRulesSet.has('U5')) {
      const u5Findings = detectU5InteractionFeedback(allFiles);
      if (u5Findings.length > 0) {
        // Remove any LLM-generated U5 findings — deterministic takes precedence
        aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'U5');

        const u5Elements = u5Findings.map(f => ({
          elementLabel: f.elementLabel, elementType: f.elementType,
          location: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck,
          confidence: f.confidence,
          evaluationMethod: 'deterministic_structural' as const,
          deduplicationKey: f.deduplicationKey,
        }));

        const overallConfidence = Math.max(...u5Findings.map(f => f.confidence));
        aggregatedU5List.push({
          ruleId: 'U5', ruleName: 'Insufficient interaction feedback', category: 'usability',
          status: 'potential',
          blocksConvergence: false,
          inputType: 'zip', isU5Aggregated: true, u5Elements, evaluationMethod: 'hybrid_deterministic',
          diagnosis: `Interaction feedback issues: ${u5Findings.length} potential risk(s) detected via structural analysis.`,
          contextualHint: 'Provide loading/progress state, disable controls during async actions, and show success/error confirmation.',
          advisoryGuidance: 'Provide loading/progress state, disable controls during async actions, and show success/error confirmation.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });

        console.log(`U5 aggregated: ${u5Findings.length} findings → 1 potential violation object`);
      } else {
        // Ensure any LLM U5 findings are Potential
        aiViolations = aiViolations.map((v: any) => {
          if (v.ruleId === 'U5') {
            return {
              ...v,
              status: 'potential',
              blocksConvergence: false,
              evaluationMethod: 'hybrid_llm_fallback',
              confidence: Math.min(v.confidence || 0.65, 0.75),
            };
          }
          return v;
        });
        console.log('U5: No deterministic signals found, LLM findings (if any) preserved as Potential');
      }
    }

    // ========== U6 POST-PROCESSING (Weak Grouping / Layout Coherence — LLM-assisted) ==========
    const aggregatedU6List: any[] = [];
    if (selectedRulesSet.has('U6')) {
      const u6FromLLM = aiViolations.filter((v: any) => v.ruleId === 'U6');
      aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'U6');

      if (u6FromLLM.length > 0) {
        const aggregatedOne = u6FromLLM.find((v: any) => v.isU6Aggregated && v.u6Elements?.length > 0);
        if (aggregatedOne) {
          const u6Elements = (aggregatedOne.u6Elements || []).map((el: any) => ({
            elementLabel: el.elementLabel || 'Layout region',
            elementType: el.elementType || 'section',
            location: el.location || el.filePath || 'Unknown',
            detection: el.detection || '',
            evidence: el.evidence || '',
            recommendedFix: el.recommendedFix || '',
            confidence: Math.min(el.confidence || 0.65, 0.80),
            evaluationMethod: 'llm_only_code' as const,
            deduplicationKey: el.deduplicationKey || `U6|${el.location || ''}|${el.elementLabel || ''}`,
          }));

          const overallConfidence = Math.min(Math.max(...u6Elements.map((e: any) => e.confidence)), 0.80);

          aggregatedU6List.push({
            ruleId: 'U6', ruleName: 'Weak grouping / layout coherence', category: 'usability',
            status: 'potential', blocksConvergence: false,
            inputType: 'zip', isU6Aggregated: true, u6Elements, evaluationMethod: 'llm_assisted',
            diagnosis: aggregatedOne.diagnosis || `Layout coherence issues: ${u6Elements.length} potential risk(s) detected via AI analysis.`,
            contextualHint: aggregatedOne.contextualHint || 'Improve grouping, alignment, and spacing to clarify content relationships.',
            advisoryGuidance: 'Use consistent spacing, section headings, and visual containers to group related elements. Establish clear visual hierarchy through alignment, whitespace, and background differentiation.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
        } else {
          // Fallback: wrap non-aggregated U6 findings
          const u6Elements = u6FromLLM.map((v: any) => ({
            elementLabel: v.evidence?.split('.')[0] || 'Layout region',
            elementType: 'section',
            location: v.evidence || 'Unknown',
            detection: v.diagnosis || '',
            evidence: v.evidence || '',
            recommendedFix: v.contextualHint || '',
            confidence: Math.min(v.confidence || 0.65, 0.80),
            evaluationMethod: 'llm_only_code' as const,
            deduplicationKey: `U6|${v.evidence || 'unknown'}`,
          }));

          const overallConfidence = Math.min(Math.max(...u6FromLLM.map((v: any) => v.confidence || 0.65)), 0.80);

          aggregatedU6List.push({
            ruleId: 'U6', ruleName: 'Weak grouping / layout coherence', category: 'usability',
            status: 'potential', blocksConvergence: false,
            inputType: 'zip', isU6Aggregated: true, u6Elements, evaluationMethod: 'llm_assisted',
            diagnosis: `Layout coherence issues: ${u6Elements.length} potential risk(s) detected via AI analysis.`,
            contextualHint: 'Improve grouping, alignment, and spacing to clarify content relationships.',
            advisoryGuidance: 'Use consistent spacing, section headings, and visual containers to group related elements.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
        }
        console.log(`U6 aggregated: ${u6FromLLM.length} LLM finding(s) → ${aggregatedU6List[0]?.u6Elements?.length || 0} element(s)`);
      } else {
        console.log('U6: No LLM findings for layout coherence');
      }
    }

    // ========== E1 POST-PROCESSING (Insufficient Transparency — LLM-assisted) ==========
    const aggregatedE1List: any[] = [];
    if (selectedRulesSet.has('E1')) {
      const e1FromLLM = aiViolations.filter((v: any) => v.ruleId === 'E1');
      aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'E1');

      if (e1FromLLM.length > 0) {
        const aggregatedOne = e1FromLLM.find((v: any) => v.isE1Aggregated && v.e1Elements?.length > 0);
        if (aggregatedOne) {
          const e1Elements = (aggregatedOne.e1Elements || []).map((el: any) => ({
            elementLabel: el.elementLabel || 'High-impact action',
            elementType: el.elementType || 'action',
            location: el.location || el.filePath || 'Unknown',
            detection: el.detection || '',
            evidence: el.evidence || '',
            recommendedFix: el.recommendedFix || '',
            confidence: Math.min(el.confidence || 0.65, 0.80),
            evaluationMethod: 'llm_only_code' as const,
            deduplicationKey: el.deduplicationKey || `E1|${el.location || ''}|${el.elementLabel || ''}`,
          }));

          const overallConfidence = Math.min(Math.max(...e1Elements.map((e: any) => e.confidence)), 0.80);

          aggregatedE1List.push({
            ruleId: 'E1', ruleName: 'Insufficient transparency in high-impact actions', category: 'ethics',
            status: 'potential', blocksConvergence: false,
            inputType: 'zip', isE1Aggregated: true, e1Elements, evaluationMethod: 'llm_assisted',
            diagnosis: aggregatedOne.diagnosis || `Transparency issues: ${e1Elements.length} potential risk(s) detected via AI analysis.`,
            contextualHint: aggregatedOne.contextualHint || 'Ensure high-impact actions disclose consequences, costs, or data implications.',
            advisoryGuidance: 'Add confirmation steps with clear consequence disclosure for irreversible or high-impact actions. Ensure costs, data implications, and irreversibility are visible before the user commits.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
        } else {
          // Fallback: wrap non-aggregated E1 findings
          const e1Elements = e1FromLLM.map((v: any) => ({
            elementLabel: v.evidence?.split('.')[0] || 'High-impact action',
            elementType: 'action',
            location: v.evidence || 'Unknown',
            detection: v.diagnosis || '',
            evidence: v.evidence || '',
            recommendedFix: v.contextualHint || '',
            confidence: Math.min(v.confidence || 0.65, 0.80),
            evaluationMethod: 'llm_only_code' as const,
            deduplicationKey: `E1|${v.evidence || 'unknown'}`,
          }));

          const overallConfidence = Math.min(Math.max(...e1FromLLM.map((v: any) => v.confidence || 0.65)), 0.80);

          aggregatedE1List.push({
            ruleId: 'E1', ruleName: 'Insufficient transparency in high-impact actions', category: 'ethics',
            status: 'potential', blocksConvergence: false,
            inputType: 'zip', isE1Aggregated: true, e1Elements, evaluationMethod: 'llm_assisted',
            diagnosis: `Transparency issues: ${e1Elements.length} potential risk(s) detected via AI analysis.`,
            contextualHint: 'Ensure high-impact actions disclose consequences, costs, or data implications.',
            advisoryGuidance: 'Add confirmation steps with clear consequence disclosure for irreversible or high-impact actions.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
        }
        console.log(`E1 aggregated: ${e1FromLLM.length} LLM finding(s) → ${aggregatedE1List[0]?.e1Elements?.length || 0} element(s)`);
      } else {
        console.log('E1: No LLM findings for transparency');
      }
    }

    // ========== E2 POST-PROCESSING (Imbalanced Choice Architecture — LLM-assisted) ==========
    const aggregatedE2List: any[] = [];
    if (selectedRulesSet.has('E2')) {
      const e2FromLLM = aiViolations.filter((v: any) => v.ruleId === 'E2');
      aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'E2');

      if (e2FromLLM.length > 0) {
        const aggregatedOne = e2FromLLM.find((v: any) => v.isE2Aggregated && v.e2Elements?.length > 0);
        if (aggregatedOne) {
          const e2Elements = (aggregatedOne.e2Elements || []).map((el: any) => ({
            elementLabel: el.elementLabel || 'Choice group',
            elementType: el.elementType || 'button-group',
            location: el.location || el.filePath || 'Unknown',
            detection: el.detection || '',
            evidence: el.evidence || '',
            recommendedFix: el.recommendedFix || '',
            confidence: Math.min(el.confidence || 0.65, 0.80),
            evaluationMethod: 'llm_only_code' as const,
            deduplicationKey: el.deduplicationKey || `E2|${el.location || ''}|${el.elementLabel || ''}`,
          }));

          const overallConfidence = Math.min(Math.max(...e2Elements.map((e: any) => e.confidence)), 0.80);
          aggregatedE2List.push({
            ruleId: 'E2', ruleName: 'Imbalanced or manipulative choice architecture', category: 'ethics',
            status: 'potential', blocksConvergence: false,
            inputType: 'zip', isE2Aggregated: true, e2Elements, evaluationMethod: 'llm_assisted',
            diagnosis: aggregatedOne.diagnosis || `Choice architecture issues: ${e2Elements.length} potential risk(s) detected via AI analysis.`,
            contextualHint: aggregatedOne.contextualHint || 'Present choices with equal visual weight and neutral defaults.',
            advisoryGuidance: 'Present choices with equal visual weight and neutral defaults. Ensure monetized or data-sharing options are not visually dominant over alternatives.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
        } else {
          // Fallback: wrap non-aggregated E2 findings
          const e2Elements = e2FromLLM.map((v: any) => ({
            elementLabel: v.evidence?.split('.')[0] || 'Choice group',
            elementType: 'button-group',
            location: v.evidence || 'Unknown',
            detection: v.diagnosis || '',
            evidence: v.evidence || '',
            recommendedFix: v.contextualHint || '',
            confidence: Math.min(v.confidence || 0.65, 0.80),
            evaluationMethod: 'llm_only_code' as const,
            deduplicationKey: `E2|${v.evidence || 'unknown'}`,
          }));

          const overallConfidence = Math.min(Math.max(...e2FromLLM.map((v: any) => v.confidence || 0.65)), 0.80);
          aggregatedE2List.push({
            ruleId: 'E2', ruleName: 'Imbalanced or manipulative choice architecture', category: 'ethics',
            status: 'potential', blocksConvergence: false,
            inputType: 'zip', isE2Aggregated: true, e2Elements, evaluationMethod: 'llm_assisted',
            diagnosis: `Choice architecture issues: ${e2Elements.length} potential risk(s) detected via AI analysis.`,
            contextualHint: 'Present choices with equal visual weight and neutral defaults.',
            advisoryGuidance: 'Present choices with equal visual weight and neutral defaults. Ensure monetized or data-sharing options are not visually dominant over alternatives.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
        }
        console.log(`E2 aggregated: ${e2FromLLM.length} LLM finding(s) → ${aggregatedE2List[0]?.e2Elements?.length || 0} element(s)`);
      } else {
        console.log('E2: No LLM findings for choice architecture');
      }
    }

    // ========== E3 POST-PROCESSING (Obscured/Restricted User Control — HYBRID) ==========
    const aggregatedE3List: any[] = [];
    if (selectedRulesSet.has('E3')) {
      // Start with deterministic findings
      const deterministicE3 = e3Findings;

      // Check for LLM-validated E3 findings
      const e3FromLLM = aiViolations.filter((v: any) => v.ruleId === 'E3');
      aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'E3');

      // Merge: deterministic findings + LLM validations
      const e3Elements: any[] = [];

      // Add deterministic findings
      for (const f of deterministicE3) {
        let confidence = f.confidence;
        // Check if LLM reinforced this finding
        const llmReinforced = e3FromLLM.some((v: any) =>
          v.e3Elements?.some((el: any) => el.subCheck === f.subCheck && el.location?.includes(f.filePath.split('/').pop() || ''))
        );
        if (llmReinforced) confidence = Math.min(confidence + 0.05, 0.85);

        e3Elements.push({
          elementLabel: f.elementLabel,
          elementType: f.elementType,
          location: f.filePath,
          subCheck: f.subCheck,
          detection: f.detection,
          evidence: f.evidence,
          recommendedFix: f.recommendedFix,
          confidence: Math.min(confidence, 0.85),
          evaluationMethod: llmReinforced ? 'hybrid_structural_llm' as const : 'deterministic_structural' as const,
          deduplicationKey: f.deduplicationKey,
        });
      }

      // Add LLM-only findings that weren't already covered by deterministic
      if (e3FromLLM.length > 0) {
        const aggregatedLLM = e3FromLLM.find((v: any) => v.isE3Aggregated && v.e3Elements?.length > 0);
        if (aggregatedLLM) {
          for (const el of (aggregatedLLM.e3Elements || [])) {
            const alreadyCovered = e3Elements.some(e => e.subCheck === el.subCheck && e.location === el.location);
            if (!alreadyCovered) {
              e3Elements.push({
                elementLabel: el.elementLabel || 'Control restriction',
                elementType: el.elementType || 'unknown',
                location: el.location || 'Unknown',
                subCheck: el.subCheck,
                detection: el.detection || '',
                evidence: el.evidence || '',
                recommendedFix: el.recommendedFix || '',
                confidence: Math.min(el.confidence || 0.65, 0.85),
                evaluationMethod: 'hybrid_structural_llm' as const,
                deduplicationKey: el.deduplicationKey || `E3|${el.location || ''}|${el.elementLabel || ''}`,
              });
            }
          }
        }
      }

      if (e3Elements.length > 0) {
        const overallConfidence = Math.min(Math.max(...e3Elements.map((e: any) => e.confidence)), 0.85);
        aggregatedE3List.push({
          ruleId: 'E3', ruleName: 'Obscured or restricted user control', category: 'ethics',
          status: 'potential', blocksConvergence: false,
          inputType: 'zip', isE3Aggregated: true, e3Elements, evaluationMethod: 'hybrid_deterministic',
          diagnosis: `Control restriction issues: ${e3Elements.length} potential risk(s) detected.`,
          contextualHint: 'Ensure users can easily dismiss, cancel, or opt out of actions.',
          advisoryGuidance: 'Provide clear dismissal, cancellation, or opt-out mechanisms and ensure users can easily reverse or exit actions.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });
        console.log(`E3 aggregated: ${deterministicE3.length} deterministic + ${e3FromLLM.length} LLM → ${e3Elements.length} element(s)`);
      } else {
        console.log('E3: No findings for control restrictions');
      }
    }

    const allViolations = [...aggregatedA1Violations, ...aiViolations, ...aggregatedU1List, ...aggregatedU2List, ...aggregatedU3List, ...aggregatedU4List, ...aggregatedU5List, ...aggregatedU6List, ...aggregatedE1List, ...aggregatedE2List, ...aggregatedE3List, ...(aggregatedA3 ? [aggregatedA3] : []), ...(aggregatedA4 ? [aggregatedA4] : []), ...(aggregatedA5 ? [aggregatedA5] : []), ...(aggregatedA6 ? [aggregatedA6] : [])];

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