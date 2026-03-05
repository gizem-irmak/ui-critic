import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { ZipReader, BlobReader, TextWriter } from "https://deno.land/x/zipjs@v2.7.32/index.js";
import {
  filterPath as pFilterPath,
  shouldIncludePath as pShouldIncludePath,
  normalizePath as pNormalizePath,
  normalizeContent as pNormalizeContent,
  detectCommonRoot as pDetectCommonRoot,
  computeSnapshotHash as pComputeSnapshotHash,
  buildSnapshot as pBuildSnapshot,
  logParityDiagnostics as pLogParityDiagnostics,
  isLfsPointer as pIsLfsPointer,
  hasHighReplacementRatio as pHasHighReplacementRatio,
  PER_FILE_SIZE_CAP,
  TOTAL_SIZE_CAP,
  type ExcludedFile,
} from '../_shared/projectSnapshot.ts';

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

// --- U1 NAV/CHROME EXCLUSION GATE ---
// Returns true if the file is navigation/layout chrome and should be excluded from U1 analysis
function isNavOrChromeFile(filePath: string, content: string): boolean {
  const fp = filePath.toLowerCase();
  // File path signals
  if (/\b(layout|navbar|nav|sidebar|header|menu|navigation|topbar|appbar|toolbar)\b/i.test(fp.split('/').pop() || '')) return true;
  // Content signals: nav landmark or role="navigation"
  if (/<nav\b/i.test(content) || /role\s*=\s*["']navigation["']/i.test(content)) {
    // Check that nav is a dominant structure (not just a small nested nav)
    // If file has <nav> and most buttons use Link/to/href, it's chrome
    const linkCount = (content.match(/<Link\b|<a\b[^>]*href\s*=|to\s*=\s*["']/gi) || []).length;
    const buttonCount = (content.match(/<(?:button|Button)\b/gi) || []).length;
    if (linkCount > 0 && linkCount >= buttonCount) return true;
  }
  // Variable name signals for nav data
  if (/\b(navItems|menuItems|sidebarItems|navigationItems|navLinks|menuLinks)\b/.test(content)) return true;
  return false;
}

// --- U1 PRIMARY-ACTION CONTEXT GATE ---
// Returns true if the file has task-oriented primary-action context (form, dialog, or CTA cluster)
function hasPrimaryActionContext(content: string): boolean {
  // A) Form / submission context
  if (/<form\b/i.test(content)) return true;
  if (/onSubmit\s*=/i.test(content)) return true;
  if (/type\s*=\s*["']submit["']/i.test(content)) return true;
  if (/\b(handleSubmit|handleSave|handleConfirm|handleContinue|handleNextStep)\b/.test(content)) return true;
  // B) Dialog / confirmation context
  if (/<(?:Dialog|Modal|AlertDialog|Confirm|Sheet|Drawer)\b/i.test(content)) return true;
  if (/(?:DialogFooter|ModalFooter|DialogActions)\b/.test(content)) return true;
  // C) Explicit CTA cluster: action-like keywords in button text
  const CTA_KEYWORDS = /\b(save|submit|continue|next|confirm|delete|remove|pay|checkout|create|publish)\b/i;
  const buttonContentMatches = content.match(/<(?:button|Button)\b[^>]*>([^<]*)</gi) || [];
  let ctaCount = 0;
  for (const m of buttonContentMatches) {
    const textMatch = m.match(/>([^<]+)/);
    if (textMatch && CTA_KEYWORDS.test(textMatch[1])) ctaCount++;
  }
  if (ctaCount >= 1) return true;
  return false;
}

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
    // U1 NAV/CHROME GATE: skip nav/layout files for U1.1
    if (isNavOrChromeFile(filePath, content)) continue;

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
    // U1 NAV/CHROME GATE: skip nav/layout files for U1.2/U1.3
    if (isNavOrChromeFile(filePath, content)) {
      console.log(`[U1] nav/chrome gate: skipping ${filePath}`);
      continue;
    }
    // U1 PRIMARY-ACTION CONTEXT GATE: only analyze files with task-oriented context
    if (!hasPrimaryActionContext(content)) {
      console.log(`[U1] context gate: skipping ${filePath} (no form/dialog/CTA context)`);
      continue;
    }

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
    // Context-aware suppression: detect stepper, strong headings, single primary CTA
    const allButtons = extractButtonUsagesFromJsx(content, buttonLocalNames);

    // Pre-compute context signals for U1.3 suppression
    const u13ContextSignals = detectU13ContextSignals(content, allButtons, buttonImpl);

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

        // Context-aware suppression: suppress if labeled stepper or strong heading present
        if (u13ContextSignals.hasLabeledStepper || u13ContextSignals.hasStrongNearbyHeading(btn.offset)) {
          console.log(`[U1.3] context-suppressed: "${btn.label}" in ${filePath} — stepper=${u13ContextSignals.hasLabeledStepper}, heading=${u13ContextSignals.hasStrongNearbyHeading(btn.offset)}`);
          continue;
        }

        // Signal-based confidence for U1.3
        const HIGH_RISK_GENERICS = new Set(['continue', 'next', 'submit', 'save', 'confirm', 'ok']);
        let u13Confidence = 0.40; // lowered base from 0.55
        // +0.10 if label is in high-risk generic set AND no context
        if (HIGH_RISK_GENERICS.has(labelLower)) {
          u13Confidence += 0.10;
        }
        // +0.05 if no contextual heading or nearby descriptive text detected
        const hasNearbyHeading = /<(?:h[1-6]|label|legend)\b[^>]*>/.test(content);
        if (!hasNearbyHeading) {
          u13Confidence += 0.10;
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
        // +0.05 if single primary CTA (no competing buttons → less ambiguity, but still generic)
        if (!u13ContextSignals.isSinglePrimaryCTA) {
          u13Confidence += 0.05;
        }
        u13Confidence = Math.min(u13Confidence, 0.75);

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
  subCheck: 'U3.D1' | 'U3.D2' | 'U3.D3' | 'U3.D4' | 'U3.D5' | 'U3.D6' | 'U3.D7';
  subCheckLabel: string;
  classification: 'potential' | 'confirmed';
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
  // Element metadata for reporting
  truncationType?: string; // truncate, line-clamp, hidden, overflow-clip, nowrap
  textLength?: number | 'dynamic';
  triggerReason?: string; // why it was NOT suppressed
  expandDetected?: boolean;
  elementTag?: string;
  varName?: string; // extracted variable name for cross-subcheck dedup
  lineNumber?: number; // line number for proximity check
  occurrences?: number; // count of merged findings
  // Enhanced metadata (v2)
  startLine?: number;
  endLine?: number;
  contentKind?: 'static_short' | 'static_long' | 'dynamic' | 'list_mapped';
  recoverySignals?: string[];
  truncationTokens?: string[];
}

function extractU3TextPreview(content: string, pos: number): string | undefined {
  const after = content.slice(pos, Math.min(content.length, pos + 800));

  const cap = (s: string): string => s.length > 120 ? s.slice(0, 117) + '…' : s;

  const looksLikeClasses = (s: string): boolean =>
    /^[\w\s\-/[\]:!.#]+$/.test(s) && /\b(text-|bg-|flex|grid|p-|m-|w-|h-|rounded|border|font-|block|inline|hidden|overflow|relative|absolute|max-|min-)/.test(s);

  // 1) Collect visible JSX text nodes: text between > and <
  const textParts: string[] = [];
  const jsxTextRe = />([^<>{]+)</g;
  let tm;
  while ((tm = jsxTextRe.exec(after)) !== null) {
    const raw = tm[1].trim();
    if (raw.length < 3) continue;
    if (looksLikeClasses(raw)) continue;
    if (!/[a-zA-Z]/.test(raw)) continue;
    textParts.push(raw);
  }

  if (textParts.length > 0) {
    const joined = textParts.join(' ').trim();
    if (joined.length > 0) return cap(joined);
  }

  // 2) String literal children
  const childStringRe = />\s*\{\s*[`"']([^`"']{5,})[`"']\s*\}\s*</g;
  let csm;
  while ((csm = childStringRe.exec(after)) !== null) {
    const raw = csm[1].trim();
    if (raw.length > 0 && !looksLikeClasses(raw)) return cap(raw);
  }

  // 3) Dynamic expressions as children
  const dynChildRe = />\s*\{([a-zA-Z_][\w.]*)\}\s*</g;
  let dm;
  const dynNames: string[] = [];
  while ((dm = dynChildRe.exec(after)) !== null) {
    const varName = dm[1];
    if (/^(className|style|key|ref|id|onClick|onChange|onSubmit|disabled|checked|value|type|src|href|alt)$/.test(varName)) continue;
    dynNames.push(varName);
  }
  if (dynNames.length > 0) {
    const meaningful = dynNames.find(n => /^(title|name|label|description|text|content|message|email|url|summary|body|comment|note|caption|heading|subtitle|placeholder|address|bio|detail)$/i.test(n) || n.includes('.'));
    if (meaningful) return `(dynamic text: ${meaningful})`;
    return `(dynamic text: ${dynNames[0]})`;
  }

  // 4) Broader dynamic children
  const dynBroadRe = />\s*\{([^}]{3,40})\}\s*</g;
  let db;
  while ((db = dynBroadRe.exec(after)) !== null) {
    const expr = db[1].trim();
    if (/[a-zA-Z]/.test(expr) && !/className|style|onClick/i.test(expr)) return '(dynamic text)';
  }

  return undefined;
}

/**
 * Extract content preview scoped to the carrier element's own subtree.
 * Finds the carrier element's opening tag, then scans only within its
 * children (up to closing tag) for dynamic expressions or text content.
 * Falls back to extractU3TextPreview if carrier can't be bounded.
 */
function extractU3CarrierContentPreview(content: string, pos: number, carrier: { tag: string; tagStart: number; fullTag: string } | null): string | undefined {
  if (!carrier) return extractU3TextPreview(content, pos);

  const tagEnd = carrier.tagStart + carrier.fullTag.length;

  // Find the closing tag for this carrier element
  // Use a simple scan: track depth for same-name nested tags
  const tag = carrier.tag;
  const closeTag = `</${tag}`;
  const openTagRe = new RegExp(`<${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  let depth = 1;
  let searchPos = tagEnd;
  let closingPos = -1;
  const maxSearch = Math.min(content.length, tagEnd + 2000);

  while (searchPos < maxSearch && depth > 0) {
    const nextOpen = content.indexOf(`<${tag}`, searchPos);
    const nextClose = content.indexOf(closeTag, searchPos);

    if (nextClose < 0) break; // no closing tag found

    if (nextOpen >= 0 && nextOpen < nextClose) {
      // Check it's actually an opening tag (not e.g., <TableCellX)
      const charAfterTag = content[nextOpen + tag.length + 1];
      if (charAfterTag && /[\s>\/]/.test(charAfterTag)) {
        depth++;
      }
      searchPos = nextOpen + tag.length + 1;
    } else {
      depth--;
      if (depth === 0) {
        closingPos = nextClose;
      }
      searchPos = nextClose + closeTag.length;
    }
  }

  // If we found closing tag, extract content from element subtree only
  if (closingPos > 0) {
    const elementContent = content.slice(tagEnd, closingPos);

    const cap = (s: string): string => s.length > 120 ? s.slice(0, 117) + '…' : s;

    // Scan for ALL {expr} in elementContent (we're already past the opening tag,
    // so these are children, not attributes).
    const allDynRe = /\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
    let dm;
    const dynExprs: string[] = [];
    const ATTR_NAMES = /^(className|style|key|ref|id|onClick|onChange|onSubmit|disabled|checked|value|type|src|href|alt|htmlFor|role|aria-\w+)$/;
    while ((dm = allDynRe.exec(elementContent)) !== null) {
      const expr = dm[1].trim();
      if (!expr || expr.length > 120) continue;
      // Skip pure attribute-value expressions (only if they look like a prop assignment)
      if (ATTR_NAMES.test(expr)) continue;
      // Skip className/style helpers
      if (/^cn\(|^clsx\(|^classNames?\(/i.test(expr)) continue;
      // Skip pure callbacks like () => ... or function refs without dot access
      if (/^(?:\(\)\s*=>|function\b)/.test(expr) && !/\.\w+/.test(expr)) continue;
      if (!dynExprs.includes(expr)) dynExprs.push(expr);
    }

    if (dynExprs.length > 0) {
      // Prefer expressions with dot notation (e.g., appt.reason, (appt as any).doctors?.name)
      const meaningful = dynExprs.find(e => /[a-zA-Z_]\w*[\s)]*\.[\w?]/.test(e));
      if (meaningful) {
        // Extract core variable path, supporting cast expressions like (appt as any).doctors?.name
        const castMatch = meaningful.match(/\((\w+)\s+as\s+\w+\)\.\s*([\w?.]+)/);
        if (castMatch) {
          return `(dynamic text: (${castMatch[1]} as any).${castMatch[2]})`;
        }
        const coreVar = meaningful.match(/([a-zA-Z_][\w.?]*)/);
        return `(dynamic text: ${coreVar ? coreVar[1] : meaningful})`;
      }
      return `(dynamic text: ${dynExprs[0]})`;
    }

    // Static text children
    const textParts: string[] = [];
    const jsxTextRe = />([^<>{]+)</g;
    let tm;
    while ((tm = jsxTextRe.exec(elementContent)) !== null) {
      const raw = tm[1].trim();
      if (raw.length < 3) continue;
      if (!/[a-zA-Z]/.test(raw)) continue;
      textParts.push(raw);
    }
    if (textParts.length > 0) {
      return cap(textParts.join(' ').trim());
    }
  }

  // Fallback to original forward scan
  return extractU3TextPreview(content, pos);
}

/** Determine if text preview indicates dynamic content */
function u3IsDynamic(preview: string | undefined): boolean {
  if (!preview) return false;
  return preview.startsWith('(dynamic text');
}

/** Get static text length from preview, or -1 if dynamic/unknown */
function u3StaticTextLength(preview: string | undefined): number {
  if (!preview) return -1;
  if (u3IsDynamic(preview)) return -1;
  return preview.replace(/…$/, '').length;
}

/** Search a wider window (±N lines from position) for expand/toggle/tooltip patterns */
function u3HasExpandMechanism(content: string, pos: number, windowLines: number): boolean {
  const lines = content.split('\n');
  const currentLine = content.slice(0, pos).split('\n').length - 1;
  const startLine = Math.max(0, currentLine - windowLines);
  const endLine = Math.min(lines.length - 1, currentLine + windowLines);
  const window = lines.slice(startLine, endLine + 1).join('\n');
  return /show\s*more|see\s*more|see\s*all|view\s*more|expand|read\s*more|collapse/i.test(window) ||
    /\b(expanded|setExpanded|isOpen|setIsOpen|isExpanded|setOpen|toggleOpen|toggleExpand)\b/.test(window) ||
    /title\s*=|<Tooltip|data-tooltip|aria-describedby/i.test(window);
}

/**
 * Find the carrier element: the closest JSX opening tag whose children contain the text at `pos`.
 * Returns { tag, className, tagStart } or null.
 * Strategy: scan backward from `pos` for `<TagName ... className="...">` that hasn't been closed.
 */
function u3FindCarrierElement(content: string, pos: number): { tag: string; className: string; tagStart: number; fullTag: string } | null {
  const U3_TRUNC_CLASS_RE = /\b(truncate|line-clamp-\d+|text-ellipsis)\b/;
  // IMPORTANT: pos may be INSIDE a tag's className attribute (e.g., the 't' in truncate).
  // Extend the search window 300 chars past pos to capture the full opening tag.
  const searchStart = Math.max(0, pos - 600);
  const searchEnd = Math.min(content.length, pos + 300);
  const searchSlice = content.slice(searchStart, searchEnd);
  const tagRe = /<([a-zA-Z][\w.]*)\s([^>]*)>/g;
  const ancestors: { tag: string; className: string; tagStart: number; fullTag: string }[] = [];
  let tm;
  while ((tm = tagRe.exec(searchSlice)) !== null) {
    const tag = tm[1];
    const attrs = tm[2];
    const absStart = searchStart + tm.index;
    const absEnd = absStart + tm[0].length;
    if (attrs.endsWith('/')) continue;
    // Skip tags that start after pos AND whose className doesn't contain pos
    if (absStart > pos) continue;
    // Tag whose opening < is before pos and closing > is after pos → pos is inside this tag's attributes
    const isContainingTag = absStart <= pos && absEnd > pos;
    if (!isContainingTag) {
      // Normal ancestor: check it's not closed between tagEnd and pos
      const between = content.slice(absEnd, pos);
      const closeRe = new RegExp(`</${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*>`, 'i');
      if (closeRe.test(between)) continue;
    }
    const classMatch = attrs.match(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{[^}]*["']([^"']*)["'][^}]*\})/);
    const className = classMatch ? (classMatch[1] || classMatch[2] || classMatch[3] || '') : '';
    ancestors.push({ tag, className, tagStart: absStart, fullTag: tm[0] });
  }
  if (ancestors.length === 0) return null;
  // Prefer the CLOSEST element that actually has a truncation class in its className
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (U3_TRUNC_CLASS_RE.test(ancestors[i].className)) return ancestors[i];
  }
  // Fallback: closest ancestor (last in list)
  return ancestors[ancestors.length - 1];
}

/**
 * Find the immediate parent wrapper of the carrier element.
 * Returns parent className or null.
 */
function u3FindParentElement(content: string, carrierTagStart: number): { tag: string; className: string } | null {
  const before = content.slice(Math.max(0, carrierTagStart - 500), carrierTagStart);
  const tagRe = /<([a-zA-Z][\w.]*)\s([^>]*)>/g;
  let best: { tag: string; className: string } | null = null;
  let tm;
  while ((tm = tagRe.exec(before)) !== null) {
    const tag = tm[1];
    const attrs = tm[2];
    if (attrs.endsWith('/')) continue;
    const absStart = Math.max(0, carrierTagStart - 500) + tm.index;
    const tagEnd = absStart + tm[0].length;
    const between = content.slice(tagEnd, carrierTagStart);
    const closeRe = new RegExp(`</${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*>`, 'i');
    if (closeRe.test(between)) continue;
    const classMatch = attrs.match(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{[^}]*["']([^"']*)["'][^}]*\})/);
    const className = classMatch ? (classMatch[1] || classMatch[2] || classMatch[3] || '') : '';
    best = { tag, className };
  }
  return best;
}

/**
 * Component-level expand mechanism detection.
 * Checks if the same variable (e.g., msg.subject) is rendered elsewhere in the same
 * component/file WITHOUT truncation classes — implying a detail/expand view exists.
 * Also checks for onClick handlers on ancestor elements that set selected state.
 */
function u3HasComponentExpandForVar(content: string, varName: string, pos: number): { hasExpand: boolean; mechanism?: string } {
  const lastSeg = varName.split('.').pop() || varName;
  const objPrefix = varName.includes('.') ? varName.split('.')[0] : null;

  // 1. Check if same variable rendered elsewhere without truncation
  const varRe = new RegExp(`>\\s*\\{[^}]*\\.${lastSeg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^}]*\\}\\s*<`, 'g');
  let vm;
  let otherOccurrences = 0;
  while ((vm = varRe.exec(content)) !== null) {
    if (Math.abs(vm.index - pos) < 50) continue; // skip self
    // Check if this occurrence is in a truncated context
    const localCtx = content.slice(Math.max(0, vm.index - 150), Math.min(content.length, vm.index + 150));
    if (!/\btruncate\b|\bline-clamp-[1-9]\b|\btext-ellipsis\b/.test(localCtx)) {
      otherOccurrences++;
    }
  }
  if (otherOccurrences > 0) {
    return { hasExpand: true, mechanism: `same variable rendered without truncation elsewhere in component` };
  }

  // 2. Check if the truncated item is inside an onClick row/element that sets selected state
  const nearbyBefore = content.slice(Math.max(0, pos - 800), pos);
  const selectedPatterns = [
    /onClick\s*=\s*\{[^}]*set(?:Selected|Active|Current|Open)\w*\s*\(/i,
    /onClick\s*=\s*\{[^}]*(?:handleSelect|handleClick|openDetail|viewDetail|showDetail)\b/i,
  ];
  for (const sp of selectedPatterns) {
    if (sp.test(nearbyBefore)) {
      // Check if a "selected" detail view exists in the file
      if (objPrefix && new RegExp(`selected\\w*\\.${lastSeg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(content)) {
        return { hasExpand: true, mechanism: `click-to-select detail view (selected*.${lastSeg})` };
      }
      // Generic detail view check
      if (/\bselected\w*\b.*\bsubject\b|\bselected\w*\b.*\bbody\b|\bdetail\b/i.test(content)) {
        return { hasExpand: true, mechanism: 'click-to-select detail view' };
      }
    }
  }

  // 3. Check for Dialog/Drawer/Sheet that shows expanded content
  if (/<(?:Dialog|Drawer|Sheet|Modal)\b/i.test(content)) {
    // Check if the dialog renders the same variable without truncation
    const dialogContent = content.match(/<(?:Dialog|Drawer|Sheet|Modal)(?:Content|Body)?\b[\s\S]{0,2000}/i);
    if (dialogContent) {
      const varInDialog = new RegExp(`\\.${lastSeg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (varInDialog.test(dialogContent[0])) {
        return { hasExpand: true, mechanism: 'Dialog/Drawer/Modal shows full content' };
      }
    }
  }

  return { hasExpand: false };
}

/** Check if element has wide-enough container hints that make truncation unlikely */
function u3HasWideContainer(context: string): boolean {
  // Has w-full or flex-1 without max-w constraint
  if (/\bw-full\b/.test(context) && !/\bmax-w-/.test(context)) return true;
  if (/\bflex-1\b/.test(context) && !/\bmax-w-/.test(context) && !/\bw-\d+\b/.test(context)) return true;
  return false;
}

/** Check if context has explicit width constraint that makes truncation plausible */
function u3HasWidthConstraint(context: string): boolean {
  return /\bw-\d+\b/.test(context) || /\bmax-w-\w+\b/.test(context);
}

// Known table header / UI chrome labels — short static text that should never trigger U3
const U3_HEADER_LABELS = /^(?:name|status|actions?|date|doctor|specialty|location|phone|address|joined|email|time|type|role|id|created|updated|price|amount|category|priority|description|notes|view|edit|delete|details|select|options|settings|sort|filter|search|total|count|#|no\.?)$/i;

// Typical header styling classes
const U3_HEADER_STYLE_RE = /\b(?:uppercase|tracking-wide|tracking-wider|text-xs|font-medium|font-semibold|font-bold|text-muted-foreground)\b/;

// Icon component names — skip these as carrier/report elements
const U3_ICON_COMPONENT_RE = /^(?:Icon|[A-Z][a-zA-Z]*Icon|Lucide[A-Z]|ChevronRight|ChevronLeft|ChevronDown|ChevronUp|ArrowLeft|ArrowRight|Check|X|Plus|Minus|Search|Loader2?|Spinner|Eye|EyeOff|Mail|Phone|Calendar|Clock|User|Users|Star|Heart|Bell|Settings|Menu|MoreHorizontal|MoreVertical|Trash|Edit|Copy|Download|Upload|ExternalLink|Link|Info|AlertCircle|AlertTriangle|HelpCircle|Filter|SortAsc|SortDesc|Grip|GripVertical|Dot|Circle|Square|Badge|Shield|Lock|Unlock|Globe|Map|MapPin|Home|Building|Briefcase|Book|FileText|File|Folder|Image|Camera|Video|Mic|Volume|Play|Pause|SkipForward|SkipBack|RefreshCw|RotateCw|ZoomIn|ZoomOut|Maximize|Minimize|Sun|Moon|Cloud|Zap|Activity|TrendingUp|TrendingDown|BarChart|PieChart|Hash|AtSign|Paperclip|Send|MessageSquare|MessageCircle|Inbox|Archive|Bookmark|Flag|Tag|Terminal|Code|Database|Server|Wifi|Bluetooth|Monitor|Smartphone|Tablet|Watch|Cpu|HardDrive|Package|Box|Gift|ShoppingCart|ShoppingBag|CreditCard|DollarSign|Percent|Award|Trophy|Target|Crosshair|Navigation|Compass|Layers|Layout|Grid|List|Columns|Rows|Sidebar|PanelLeft|PanelRight|SplitSquare)$/;

// Tags that render text — only these are eligible for U3 (case-insensitive HTML, case-sensitive React)
const U3_TEXT_TAG_RE = /^(?:p|span|td|th|a|button|label|h[1-6]|li|div|section|article|main|header|footer|aside|figcaption|blockquote|pre|code|em|strong|small|dt|dd|summary|caption|TableCell|TableHead|CardTitle|CardDescription|Badge|Text|Paragraph|Title|Description|Heading|Label)$/;
// Tags that NEVER render text — always ineligible
const U3_NON_TEXT_TAG_RE = /^(?:svg|path|circle|rect|line|polyline|polygon|ellipse|g|defs|clipPath|mask|use|symbol|img|video|audio|source|track|canvas|iframe|br|hr|input|meta|link)$/i;

/** Check if a carrier tag is a text-rendering element eligible for U3 */
function u3IsTextElement(tag: string): boolean {
  if (U3_NON_TEXT_TAG_RE.test(tag)) return false;
  if (U3_ICON_COMPONENT_RE.test(tag)) return false;
  if (U3_TEXT_TAG_RE.test(tag)) return true;
  // Unknown React component — allow if not an icon (might render text)
  return /^[A-Z]/.test(tag);
}

/** Check if a carrier has a strong truncation signal in its OWN className */
function u3CarrierHasTruncSignal(carrierClasses: string): boolean {
  return /\btruncate\b|\bline-clamp-\d+\b|\btext-ellipsis\b/.test(carrierClasses)
    || (/\boverflow-hidden\b/.test(carrierClasses) && /\bwhitespace-nowrap\b/.test(carrierClasses));
}

/** Check if content preview is empty/whitespace — ineligible for U3 */
function u3IsEmptyContent(textPreview: string | undefined): boolean {
  if (!textPreview) return true;
  const stripped = textPreview.replace(/\(dynamic text:.*?\)/g, '').trim();
  // If there's a dynamic text marker, it's not empty
  if (/\(dynamic text:/.test(textPreview)) return false;
  return stripped.length === 0;
}

/** Gate 1: Content risk assessment — does this content have meaningful truncation risk? */
function u3ContentRiskGate(content: string, pos: number, textPreview: string | undefined, context: string): {
  pass: boolean;
  contentKind: 'static_short' | 'static_long' | 'dynamic' | 'list_mapped';
  fieldLabel?: string;
} {
  const isDynamic = u3IsDynamic(textPreview);
  const staticLen = u3StaticTextLength(textPreview);

  // Check if inside a .map() rendering context
  const before500 = content.slice(Math.max(0, pos - 500), pos);
  const isInMapContext = /\.map\s*\(\s*\(?[a-zA-Z_][\w,\s{}:]*\)?\s*=>/s.test(before500);

  if (isDynamic && isInMapContext) {
    const dynVarMatch = textPreview?.match(/\(dynamic text: ([^)]+)\)/);
    const fieldName = dynVarMatch ? dynVarMatch[1].split('.').pop() || '' : '';
    return { pass: true, contentKind: 'list_mapped', fieldLabel: fieldName };
  }
  if (isDynamic) {
    const dynVarMatch = textPreview?.match(/\(dynamic text: ([^)]+)\)/);
    const fieldName = dynVarMatch ? dynVarMatch[1].split('.').pop() || '' : '';
    return { pass: true, contentKind: 'dynamic', fieldLabel: fieldName };
  }

  // Static text evaluation
  if (staticLen >= 0) {
    // Short static text — check if it's a variable-length field label
    const staticText = (textPreview || '').replace(/…$/, '').trim();
    const tokens = staticText.split(/\s+/);
    if (staticLen >= 28 || tokens.length >= 5) {
      return { pass: true, contentKind: 'static_long' };
    }
    // Short static UI chrome — suppress
    return { pass: false, contentKind: 'static_short' };
  }

  // Unknown — conservative: suppress
  return { pass: false, contentKind: 'static_short' };
}

// Multi-token header label list for robust detection (lowercase)
const U3_HEADER_LABEL_TOKENS = new Set([
  'patient','doctor','reason','status','date','actions','action','name','specialty',
  'location','time','phone','address','joined','email','type','role','id','created',
  'updated','price','amount','category','priority','description','notes','view',
  'edit','delete','details','select','options','settings','sort','filter','search',
  'total','count','#','no.','appointment','schedule','duration','provider','service',
]);

/** Gate 2: Table header / label row suppression */
function u3IsHeaderRow(content: string, pos: number, context: string, textPreview: string | undefined): boolean {
  // Inside <thead>, <th>, <TableHead>, or <TableHeader>
  const before300 = content.slice(Math.max(0, pos - 300), pos);
  if (/<thead\b/i.test(before300) && !/<\/thead\b/i.test(before300)) return true;
  if (/<TableHeader\b/.test(before300) && !/<\/TableHeader\b/.test(before300)) return true;
  // Check unclosed <th> or <TableHead>
  for (const tag of ['<th', '<TableHead']) {
    const lastIdx = before300.lastIndexOf(tag);
    if (lastIdx >= 0) {
      const closeTag = tag === '<th' ? '</th' : '</TableHead';
      if (before300.indexOf(closeTag, lastIdx) < 0) return true;
    }
  }

  // role="columnheader"
  if (/role\s*=\s*["']columnheader["']/i.test(context)) return true;

  if (textPreview && !u3IsDynamic(textPreview)) {
    const staticText = textPreview.replace(/…$/, '').trim();

    // Multi-token header detection: if text contains >= 3 known header labels, suppress
    // This catches concatenated header strings like "Patient Doctor Reason Status Date Actions"
    const words = staticText.toLowerCase().split(/\s+/);
    const headerHits = words.filter(w => U3_HEADER_LABEL_TOKENS.has(w)).length;
    if (headerHits >= 3) return true;

    // Single short label checks
    if (staticText.length <= 20 && U3_HEADER_LABELS.test(staticText)) return true;
    if (staticText.length <= 20 && U3_HEADER_STYLE_RE.test(context)) return true;
    // Pure short static label with no dynamic content — not a data cell
    if (staticText.length <= 20 && !/\{/.test(context.slice(context.indexOf(staticText)))) return true;

    // Header styling on any-length static text without dynamic content
    if (U3_HEADER_STYLE_RE.test(context) && !/\{/.test(context)) return true;
  }

  return false;
}

/** Gate 3: Recovery mechanism detection — returns list of signals found */
function u3DetectRecoverySignals(content: string, pos: number, context: string): string[] {
  const signals: string[] = [];

  // title attribute on element
  if (/title\s*=\s*(?:\{|["'])/i.test(context)) signals.push('title_attr');

  // Tooltip/Popover/HoverCard/Dialog wrappers nearby
  const window600 = content.slice(Math.max(0, pos - 300), Math.min(content.length, pos + 300));
  if (/<Tooltip\b/i.test(window600)) signals.push('tooltip_component');
  if (/<Popover\b/i.test(window600)) signals.push('popover_component');
  if (/<HoverCard\b/i.test(window600)) signals.push('hover_card_component');
  if (/<Dialog\b/i.test(window600)) signals.push('dialog_component');

  // overflow-auto / overflow-scroll on same or parent element
  if (/overflow-(?:auto|scroll|y-auto|x-auto|y-scroll)\b/.test(context)) signals.push('overflow_scroll');

  // aria-label / aria-describedby
  if (/aria-(?:label|describedby)\s*=\s*\{/i.test(context)) signals.push('aria_description');

  // "Show more" / "Expand" / "View" / "Details" links/buttons nearby
  const window800 = content.slice(Math.max(0, pos - 400), Math.min(content.length, pos + 400));
  if (/(?:show\s*more|see\s*more|view\s*more|expand|read\s*more|see\s*all|view\s*details|view\s*full)/i.test(window800)) signals.push('expand_link');

  // onClick handler with detail/modal opening pattern
  if (/onClick\s*=\s*\{[^}]*(?:set(?:Selected|Active|Open|Current)|handleSelect|openDetail|viewDetail|showDetail)\b/i.test(window800)) signals.push('click_to_detail');

  // Expand/toggle state
  if (/\b(?:expanded|setExpanded|isOpen|setIsOpen|isExpanded|setOpen|toggleOpen|toggleExpand)\b/.test(window800)) signals.push('expand_state');

  return signals;
}

/** Extract truncation-related class tokens from a class string (deduped) */
function u3ExtractTruncationTokens(classStr: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  const add = (t: string) => { if (!seen.has(t)) { seen.add(t); tokens.push(t); } };
  const tokenPatterns = [
    /\btruncate\b/, /\bline-clamp-\d+\b/, /\btext-ellipsis\b/,
    /\bwhitespace-nowrap\b/, /\boverflow-hidden\b/, /\boverflow-clip\b/,
    /\bh-\d+\b/, /\bmax-h-\d+\b/,
    /\bmin-h-\d+\b/, /\bmin-w-\d+\b/, /\bmin-w-0\b/,
    /\bmax-w-\S+/,
    /\bbasis-\S+/,
  ];
  for (const p of tokenPatterns) {
    const m = classStr.match(p);
    if (m) add(m[0]);
  }
  // Match w-N but NOT inside min-w-N or max-w-N
  const wMatches = classStr.match(/\bw-\d+\b/g);
  if (wMatches) {
    for (const wm of wMatches) {
      const idx = classStr.indexOf(wm);
      const before = idx > 0 ? classStr.slice(Math.max(0, idx - 4), idx) : '';
      if (/min-$/.test(before) || /max-$/.test(before)) continue;
      add(wm);
      break;
    }
  }
  // Match w-[...] bracket notation
  const wBracketMatch = classStr.match(/\bw-\[[^\]]+\]/);
  if (wBracketMatch) add(wBracketMatch[0]);
  // Match max-w-[...] bracket notation
  const maxWBracketMatch = classStr.match(/\bmax-w-\[[^\]]+\]/);
  if (maxWBracketMatch) add(maxWBracketMatch[0]);
  return tokens;
}

/** Find the nearest column header label for a table cell position */
function u3FindColumnLabel(content: string, pos: number): string | undefined {
  // Strategy: find the table structure, count which column this cell is in,
  // then read the corresponding <th>/<TableHead> header text.
  const before = content.slice(Math.max(0, pos - 3000), pos);
  
  // Find <thead>...</thead> or <TableHeader>...</TableHeader> block
  const theadMatch = before.match(/<(?:thead|TableHeader)\b[\s\S]*?<\/(?:thead|TableHeader)>/i);
  if (!theadMatch) return undefined;
  
  // Extract header texts from <th> or <TableHead>
  const headerTexts: string[] = [];
  const thRe = /<(?:th|TableHead)\b[^>]*>([\s\S]*?)<\/(?:th|TableHead)>/gi;
  let thm;
  while ((thm = thRe.exec(theadMatch[0])) !== null) {
    // Strip inner tags to get text
    const text = thm[1].replace(/<[^>]*>/g, '').trim();
    if (text) headerTexts.push(text);
  }
  if (headerTexts.length === 0) return undefined;
  
  // Count which <td>/<TableCell> this position is in within its row
  // Find the start of the current row
  const trIdx = before.lastIndexOf('<tr');
  const tableRowIdx = before.lastIndexOf('<TableRow');
  const rowStart = Math.max(trIdx, tableRowIdx);
  if (rowStart < 0) return undefined;
  const rowSlice = before.slice(rowStart, before.length);
  const cellCount = (rowSlice.match(/<(?:td|TableCell)\b/gi) || []).length;
  
  // cellCount is 1-indexed (current cell), map to 0-indexed header
  const colIdx = Math.max(0, cellCount - 1);
  return colIdx < headerTexts.length ? headerTexts[colIdx] : undefined;
}

/** Compute U3 confidence using the revised scoring model.
 * For confirmed (explicit truncate/line-clamp without recovery): 0.80–0.90
 * For potential (implicit clipping signals): 0.55–0.75 */
function u3ComputeConfidence(opts: {
  contentKind: string;
  hasTruncationUtility: boolean;
  hasExplicitTruncation?: boolean; // truncate / line-clamp-* (deterministic)
  fieldLabel?: string;
  isHeaderSuspected: boolean;
}): number {
  // Confirmed path: explicit truncation tokens
  if (opts.hasExplicitTruncation) {
    let conf = 0.82;
    if ((opts.contentKind === 'dynamic' || opts.contentKind === 'list_mapped')) conf += 0.05;
    if (opts.fieldLabel && /\b(?:address|reason|notes|description|message|bio|comment|details|body|content|summary)\b/i.test(opts.fieldLabel)) conf += 0.03;
    if (opts.isHeaderSuspected) conf -= 0.15;
    return Math.max(0.80, Math.min(0.90, Math.round(conf * 100) / 100));
  }
  // Potential path: implicit clipping signals
  let conf = 0.55;
  if ((opts.contentKind === 'dynamic' || opts.contentKind === 'list_mapped') && opts.hasTruncationUtility) conf += 0.15;
  else if (opts.contentKind === 'dynamic' || opts.contentKind === 'list_mapped') conf += 0.10;
  if (opts.hasTruncationUtility) conf += 0.05;
  if (opts.fieldLabel && /\b(?:address|reason|notes|description|message|bio|comment|details|body|content|summary)\b/i.test(opts.fieldLabel)) conf += 0.05;
  if (opts.isHeaderSuspected) conf -= 0.20;
  return Math.max(0.40, Math.min(0.75, Math.round(conf * 100) / 100));
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
      { re: /\bline-clamp-[1-6]\b/g, label: 'line-clamp' },
      { re: /\btruncate\b/g, label: 'truncate' },
      { re: /\btext-ellipsis\b/g, label: 'text-ellipsis' },
    ];

    for (const { re, label } of truncationPatterns) {
      let m;
      while ((m = re.exec(content)) !== null) {
        const pos = m.index;
        const lineNumber = content.slice(0, pos).split('\n').length;
        const context = content.slice(Math.max(0, pos - 200), Math.min(content.length, pos + 300));

        const carrier = u3FindCarrierElement(content, pos);

        // ── TEXT-ELEMENT GATE: carrier must be a text-rendering element ──
        if (carrier && !u3IsTextElement(carrier.tag)) continue;

        // ── SAME-NODE GATE: truncation signal must be on the carrier's OWN className ──
        if (carrier && !carrier.className.includes(m[0])) continue;

        const textPreview = extractU3CarrierContentPreview(content, pos, carrier);

        // ── EMPTY CONTENT GATE ──
        if (u3IsEmptyContent(textPreview)) continue;

        // ── GATE 2 (first): Header/label row suppression ──
        if (u3IsHeaderRow(content, pos, context, textPreview)) continue;

        // ── GATE 1: Content risk — require dynamic text binding ──
        const contentGate = u3ContentRiskGate(content, pos, textPreview, context);
        if (!contentGate.pass) continue;
        // Strict: only dynamic/list_mapped content triggers U3 (static_long suppressed everywhere)
        if (contentGate.contentKind !== 'dynamic' && contentGate.contentKind !== 'list_mapped') continue;

        // ── GATE 3: Recovery mechanism — full suppress if ANY recovery exists ──
        const recoverySignals = u3DetectRecoverySignals(content, pos, context);
        if (recoverySignals.length > 0) continue;

        // Component-level expand for dynamic text — full suppress
        let expandDetected = false;
        if (textPreview) {
          const dynVarMatch = textPreview.match(/\(dynamic text: ([^)]+)\)/);
          if (dynVarMatch) {
            const expandCheck = u3HasComponentExpandForVar(content, dynVarMatch[1], pos);
            if (expandCheck.hasExpand) { expandDetected = true; continue; }
          }
        }
        if (u3HasExpandMechanism(content, pos, 20)) continue;

        // Extract tokens ONLY from carrier className — never from context
        const carrierClasses = carrier ? carrier.className : '';
        const truncationTokens = u3ExtractTruncationTokens(carrierClasses);
        if (truncationTokens.length === 0) truncationTokens.push(m[0]);

        // Explicit truncation tokens (truncate, line-clamp-*, text-ellipsis) → Confirmed
        const isExplicitTruncation = /\b(truncate|line-clamp-\d+|text-ellipsis)\b/.test(m[0]);
        const confidence = u3ComputeConfidence({
          contentKind: contentGate.contentKind,
          hasTruncationUtility: true,
          hasExplicitTruncation: isExplicitTruncation,
          fieldLabel: contentGate.fieldLabel,
          isHeaderSuspected: false,
        });
        if (confidence < 0.40) continue;

        const columnLabel = u3FindColumnLabel(content, pos);
        const dedupeKey = `U3.D1|${filePath}|${lineNumber}|${columnLabel || ''}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        const elementTag = carrier?.tag && !U3_ICON_COMPONENT_RE.test(carrier.tag) ? carrier.tag : (() => {
          const tagRe2 = /<([a-zA-Z][\w.]*)\s/g;
          let best: string | undefined;
          let tm2;
          const slice = context.slice(0, 300);
          while ((tm2 = tagRe2.exec(slice)) !== null) {
            if (!U3_ICON_COMPONENT_RE.test(tm2[1])) best = tm2[1];
          }
          return best;
        })();

        const d1VarMatch = textPreview && textPreview.startsWith('(dynamic text: ') ? textPreview.match(/\(dynamic text: ([^)]+)\)/) : null;
        const d1VarName = d1VarMatch ? d1VarMatch[1].split('.').pop() : undefined;

        const isDynamic = contentGate.contentKind === 'dynamic' || contentGate.contentKind === 'list_mapped';
        const staticLen = u3StaticTextLength(textPreview);
        const triggerReason = isDynamic
          ? `Dynamic content (${contentGate.contentKind}) with ${label}`
          : `Static text (${staticLen} chars) with ${label}`;

        const contentPreview = isDynamic && d1VarMatch ? `{${d1VarMatch[1]}}` : textPreview;
        const evidenceStr = columnLabel
          ? `Column "${columnLabel}" cell (${elementTag || 'element'}) uses \`${label}\` on ${contentPreview || 'dynamic content'} with no tooltip/expand`
          : `${label} on ${contentPreview || 'content'} at ${fileName}:${lineNumber}`;

        const classification: 'confirmed' | 'potential' = isExplicitTruncation ? 'confirmed' : 'potential';
        const advisoryText = isExplicitTruncation
          ? 'Content is truncated by CSS and no accessible recovery is provided.'
          : 'Static analysis suggests possible clipping; verify in rendered UI.';

        findings.push({
          subCheck: 'U3.D1',
          subCheckLabel: 'Line clamp / ellipsis truncation',
          classification,
          elementLabel: columnLabel ? `Truncated "${columnLabel}" cell (${label})` : `Truncated text (${label})`,
          elementType: 'text',
          filePath,
          detection: `${label}${recoverySignals.length > 0 ? ` (recovery: ${recoverySignals.join(', ')})` : ''}`,
          evidence: evidenceStr,
          explanation: `Text is truncated using ${label} without a visible mechanism to reveal full content.`,
          confidence,
          textPreview,
          advisoryGuidance: advisoryText,
          deduplicationKey: dedupeKey,
          truncationType: label,
          textLength: isDynamic ? 'dynamic' : (staticLen >= 0 ? staticLen : undefined),
          triggerReason,
          expandDetected,
          elementTag,
          varName: d1VarName,
          lineNumber,
          startLine: lineNumber,
          endLine: lineNumber,
          contentKind: contentGate.contentKind,
          recoverySignals: recoverySignals.length > 0 ? recoverySignals : undefined,
          truncationTokens,
          columnLabel: columnLabel || undefined,
          contentPreview: contentPreview || undefined,
        });
      }
    }

    // Also detect whitespace-nowrap + overflow-hidden combo
    const nowrapRe = /\bwhitespace-nowrap\b/g;
    let nwm;
    while ((nwm = nowrapRe.exec(content)) !== null) {
      const pos = nwm.index;
      const context = content.slice(Math.max(0, pos - 200), Math.min(content.length, pos + 300));

      const nwCarrier = u3FindCarrierElement(content, pos);

      // ── TEXT-ELEMENT GATE ──
      if (nwCarrier && !u3IsTextElement(nwCarrier.tag)) continue;

      // ── SAME-NODE GATE: both whitespace-nowrap AND overflow-hidden must be on the carrier's OWN className ──
      const nwCarrierClasses = nwCarrier ? nwCarrier.className : '';
      if (!(/\bwhitespace-nowrap\b/.test(nwCarrierClasses) && /\boverflow-hidden\b/.test(nwCarrierClasses))) continue;
      // Also require width constraint on the SAME node
      if (!/\bw-\d+\b|\bmax-w-\S+\b/.test(nwCarrierClasses)) continue;

      const textPreview = extractU3CarrierContentPreview(content, pos, nwCarrier);

      // ── EMPTY CONTENT GATE ──
      if (u3IsEmptyContent(textPreview)) continue;

      // ── GATE 2 (first): Header suppression ──
      if (u3IsHeaderRow(content, pos, context, textPreview)) continue;

      // ── GATE 1: Content risk — require dynamic text binding ──
      const contentGate = u3ContentRiskGate(content, pos, textPreview, context);
      if (!contentGate.pass) continue;
      if (contentGate.contentKind !== 'dynamic' && contentGate.contentKind !== 'list_mapped') continue;

      // ── GATE 3: Full suppress if ANY recovery exists ──
      const recoverySignals = u3DetectRecoverySignals(content, pos, context);
      if (recoverySignals.length > 0) continue;

      if (textPreview) {
        const dynVarMatch = textPreview.match(/\(dynamic text: ([^)]+)\)/);
        if (dynVarMatch) {
          const expandCheck = u3HasComponentExpandForVar(content, dynVarMatch[1], pos);
          if (expandCheck.hasExpand) continue;
        }
      }
      if (u3HasExpandMechanism(content, pos, 20)) continue;

      const lineNumber = content.slice(0, pos).split('\n').length;
      const nwColumnLabel = u3FindColumnLabel(content, pos);
      const dedupeKey = `U3.D1|${filePath}|${lineNumber}|${nwColumnLabel || ''}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      // Extract tokens ONLY from carrier className
      const truncationTokens = u3ExtractTruncationTokens(nwCarrierClasses);
      if (truncationTokens.length === 0) truncationTokens.push('whitespace-nowrap', 'overflow-hidden');

      const confidence = u3ComputeConfidence({
        contentKind: contentGate.contentKind,
        hasTruncationUtility: true,
        fieldLabel: contentGate.fieldLabel,
        isHeaderSuspected: false,
      });
      if (confidence < 0.40) continue;

      const isDynamic = contentGate.contentKind === 'dynamic' || contentGate.contentKind === 'list_mapped';
      const staticLen = u3StaticTextLength(textPreview);
      const nwVarMatch = textPreview && textPreview.startsWith('(dynamic text: ') ? textPreview.match(/\(dynamic text: ([^)]+)\)/) : null;
      const nwVarName = nwVarMatch ? nwVarMatch[1].split('.').pop() : undefined;

      // nwColumnLabel already resolved above for dedup
      const nwContentPreview = isDynamic && nwVarMatch ? `{${nwVarMatch[1]}}` : textPreview;
      const nwEvidenceStr = nwColumnLabel
        ? `Column "${nwColumnLabel}" cell uses nowrap + overflow-hidden on ${nwContentPreview || 'dynamic content'} with no tooltip/expand`
        : `whitespace-nowrap + overflow-hidden at ${fileName}:${lineNumber}`;

      findings.push({
        subCheck: 'U3.D1',
        subCheckLabel: 'Line clamp / ellipsis truncation',
        classification: 'potential',
        elementLabel: nwColumnLabel ? `Truncated "${nwColumnLabel}" cell (nowrap)` : 'Truncated text (nowrap + overflow)',
        elementType: 'text',
        filePath,
        detection: `whitespace-nowrap + overflow-hidden${recoverySignals.length > 0 ? ` (recovery: ${recoverySignals.join(', ')})` : ''}`,
        evidence: nwEvidenceStr,
        explanation: 'Text is forced to a single line with overflow hidden, potentially clipping important content.',
        confidence,
        textPreview,
        advisoryGuidance: 'Add a title attribute or tooltip to reveal full content on hover.',
        deduplicationKey: dedupeKey,
        truncationType: 'nowrap',
        textLength: isDynamic ? 'dynamic' : (staticLen >= 0 ? staticLen : undefined),
        triggerReason: isDynamic ? 'Dynamic content with nowrap + overflow-hidden' : `Text (${staticLen} chars) with nowrap + overflow-hidden`,
        expandDetected: false,
        varName: nwVarName,
        lineNumber,
        startLine: lineNumber,
        endLine: lineNumber,
        contentKind: contentGate.contentKind,
        recoverySignals: recoverySignals.length > 0 ? recoverySignals : undefined,
        truncationTokens,
        columnLabel: nwColumnLabel || undefined,
        contentPreview: nwContentPreview || undefined,
      });
    }

    // --- U3.D1b: overflow-hidden + width constraint (max-w-* / w-*) in table/list cells ---
    const widthConstraintRe = /\b(?:max-w-\S+|w-\d+)\b/g;
    let wcm;
    while ((wcm = widthConstraintRe.exec(content)) !== null) {
      const pos = wcm.index;
      const context = content.slice(Math.max(0, pos - 200), Math.min(content.length, pos + 300));

      const wcCarrier = u3FindCarrierElement(content, pos);

      // ── TEXT-ELEMENT GATE ──
      if (wcCarrier && !u3IsTextElement(wcCarrier.tag)) continue;

      // ── SAME-NODE GATE: width constraint AND overflow-hidden must be on carrier's OWN className ──
      const wcCarrierClasses = wcCarrier ? wcCarrier.className : '';
      if (!wcCarrierClasses.includes(wcm[0])) continue;
      if (!/\boverflow-hidden\b/.test(wcCarrierClasses)) continue;
      // Skip if already has truncate/line-clamp (handled by D1 main)
      if (/\btruncate\b|\bline-clamp-\d+\b|\btext-ellipsis\b/.test(wcCarrierClasses)) continue;

      const textPreview = extractU3CarrierContentPreview(content, pos, wcCarrier);

      // ── EMPTY CONTENT GATE ──
      if (u3IsEmptyContent(textPreview)) continue;

      // ── GATE 2 (first): Header suppression ──
      if (u3IsHeaderRow(content, pos, context, textPreview)) continue;

      // ── GATE 1: Content risk — require dynamic text binding ──
      const contentGate = u3ContentRiskGate(content, pos, textPreview, context);
      if (!contentGate.pass) continue;
      if (contentGate.contentKind !== 'dynamic' && contentGate.contentKind !== 'list_mapped') continue;

      // ── GATE 3: Full suppress if ANY recovery exists ──
      const recoverySignals = u3DetectRecoverySignals(content, pos, context);
      if (recoverySignals.length > 0) continue;
      if (u3HasExpandMechanism(content, pos, 20)) continue;
      if (textPreview) {
        const dynVarMatch = textPreview.match(/\(dynamic text: ([^)]+)\)/);
        if (dynVarMatch) {
          const expandCheck = u3HasComponentExpandForVar(content, dynVarMatch[1], pos);
          if (expandCheck.hasExpand) continue;
        }
      }

      const lineNumber = content.slice(0, pos).split('\n').length;
      const columnLabel = u3FindColumnLabel(content, pos);
      const dedupeKey = `U3.D1|${filePath}|${lineNumber}|${columnLabel || ''}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      // Extract tokens ONLY from carrier className
      const truncationTokens = u3ExtractTruncationTokens(wcCarrierClasses);
      if (truncationTokens.length === 0) truncationTokens.push(wcm[0], 'overflow-hidden');

      const confidence = u3ComputeConfidence({
        contentKind: contentGate.contentKind,
        hasTruncationUtility: true,
        fieldLabel: contentGate.fieldLabel,
        isHeaderSuspected: false,
      });
      if (confidence < 0.40) continue;

      // columnLabel already resolved above for dedup
      const isDynamic = contentGate.contentKind === 'dynamic' || contentGate.contentKind === 'list_mapped';
      const wcVarMatch = textPreview && textPreview.startsWith('(dynamic text: ') ? textPreview.match(/\(dynamic text: ([^)]+)\)/) : null;
      const wcVarName = wcVarMatch ? wcVarMatch[1].split('.').pop() : undefined;

      const wcContentPreview = isDynamic && wcVarMatch ? `{${wcVarMatch[1]}}` : textPreview;
      const wcEvidenceStr = columnLabel
        ? `Column "${columnLabel}" cell uses ${wcm[0]} + overflow-hidden on ${wcContentPreview || 'dynamic content'} with no tooltip/expand`
        : `${wcm[0]} with overflow-hidden at ${fileName}:${lineNumber}`;

      findings.push({
        subCheck: 'U3.D1',
        subCheckLabel: 'Width-constrained overflow clipping',
        classification: 'potential',
        elementLabel: columnLabel ? `Clipped "${columnLabel}" cell (width constraint)` : 'Width-constrained overflow',
        elementType: 'text',
        filePath,
        detection: `${wcm[0]} + overflow-hidden${recoverySignals.length > 0 ? ` (recovery: ${recoverySignals.join(', ')})` : ''}`,
        evidence: wcEvidenceStr,
        explanation: `Content is constrained by ${wcm[0]} with overflow-hidden, potentially clipping dynamic text.`,
        confidence,
        textPreview,
        advisoryGuidance: 'Add a title attribute or tooltip to reveal full content on hover.',
        deduplicationKey: dedupeKey,
        truncationType: 'width-constraint',
        textLength: isDynamic ? 'dynamic' : undefined,
        triggerReason: `${contentGate.contentKind} content with ${wcm[0]} + overflow-hidden`,
        expandDetected: false,
        varName: wcVarName,
        lineNumber,
        startLine: lineNumber,
        endLine: lineNumber,
        contentKind: contentGate.contentKind,
        recoverySignals: recoverySignals.length > 0 ? recoverySignals : undefined,
        truncationTokens,
        columnLabel: columnLabel || undefined,
        contentPreview: wcContentPreview || undefined,
      });
    }

    // --- U3.D6: Column-constrained cell clipping (no explicit truncate) ---
    // High-precision path: detects cells where width constraints + nowrap may clip dynamic content
    // even without explicit `truncate` or `text-ellipsis` classes.
    {
      // Scan for width constraints in table/list contexts
      const d6WidthRe = /\b(?:max-w-\S+|w-\d+|min-w-0|basis-\S+)\b/g;
      let d6m;
      while ((d6m = d6WidthRe.exec(content)) !== null) {
        const pos = d6m.index;
        const context = content.slice(Math.max(0, pos - 300), Math.min(content.length, pos + 400));

        // A) Table-like context required
        const before600 = content.slice(Math.max(0, pos - 600), pos);
        const isTableContext = /<(?:table|tr|td|th|Table|TableHeader|TableBody|TableRow|TableCell|TableHead)\b/i.test(before600);
        const isMapContext = /\.map\s*\(\s*\(?[a-zA-Z_][\w,\s{}:]*\)?\s*=>/s.test(before600);
        if (!isTableContext && !isMapContext) continue;

        const d6Carrier = u3FindCarrierElement(content, pos);

        // ── TEXT-ELEMENT GATE ──
        if (d6Carrier && !u3IsTextElement(d6Carrier.tag)) continue;

        // ── SAME-NODE GATE: width constraint must be on carrier's OWN className ──
        const d6CarrierClasses = d6Carrier ? d6Carrier.className : '';
        if (!d6CarrierClasses.includes(d6m[0])) continue;

        // Skip if already handled by D1 (has explicit truncate/line-clamp/text-ellipsis on same node)
        if (/\btruncate\b|\bline-clamp-\d+\b|\btext-ellipsis\b/.test(d6CarrierClasses)) continue;

        // B) Must have overflow-hidden or overflow-clip ON THE SAME NODE (or table-fixed on parent)
        const hasOverflowClip = /\boverflow-hidden\b|\boverflow-clip\b/.test(d6CarrierClasses);
        const hasTableFixed = /\btable-fixed\b/.test(content.slice(Math.max(0, pos - 1000), pos));
        if (!hasOverflowClip && !hasTableFixed) continue;

        // C) Text overflow symptom: no explicit wrapping allowed
        const hasWrap = /\bwhitespace-normal\b|\bbreak-words\b|\bbreak-all\b|\bword-break\b/.test(d6CarrierClasses);
        if (hasWrap) continue;
        const hasNowrap = /\bwhitespace-nowrap\b/.test(d6CarrierClasses);
        if (!hasNowrap && !hasTableFixed && !hasOverflowClip) continue;

        const textPreview = extractU3CarrierContentPreview(content, pos, d6Carrier);

        // ── EMPTY CONTENT GATE ──
        if (u3IsEmptyContent(textPreview)) continue;

        // Gate 2: Header suppression (first)
        if (u3IsHeaderRow(content, pos, context, textPreview)) continue;

        // D) Content risk: must be dynamic/list_mapped
        const contentGate = u3ContentRiskGate(content, pos, textPreview, context);
        if (!contentGate.pass) continue;
        if (contentGate.contentKind !== 'dynamic' && contentGate.contentKind !== 'list_mapped') continue;

        // E) Gate 3: Recovery — full suppress if ANY recovery exists
        const recoverySignals = u3DetectRecoverySignals(content, pos, context);
        if (recoverySignals.length > 0) continue;
        if ((contentGate.contentKind === 'dynamic' || contentGate.contentKind === 'list_mapped') && textPreview) {
          const dynVarMatch = textPreview.match(/\(dynamic text: ([^)]+)\)/);
          if (dynVarMatch) {
            const expandCheck = u3HasComponentExpandForVar(content, dynVarMatch[1], pos);
            if (expandCheck.hasExpand) continue;
          }
        }
        if (u3HasExpandMechanism(content, pos, 20)) continue;

        const lineNumber = content.slice(0, pos).split('\n').length;
        const columnLabel = u3FindColumnLabel(content, pos);
        const dedupeKey = `U3.D6|${filePath}|${lineNumber}|${columnLabel || ''}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        // Extract tokens ONLY from carrier className
        const truncationTokens = u3ExtractTruncationTokens(d6CarrierClasses);
        if (truncationTokens.length === 0) truncationTokens.push(d6m[0]);
        if (hasOverflowClip && !truncationTokens.includes('overflow-hidden')) truncationTokens.push('overflow-hidden');
        if (hasNowrap && !truncationTokens.includes('whitespace-nowrap')) truncationTokens.push('whitespace-nowrap');

        const confidence = u3ComputeConfidence({
          contentKind: contentGate.contentKind,
          hasTruncationUtility: false,
          fieldLabel: contentGate.fieldLabel,
          isHeaderSuspected: false,
        });
        if (confidence < 0.40) continue;

        const d6VarMatch = textPreview && textPreview.startsWith('(dynamic text: ') ? textPreview.match(/\(dynamic text: ([^)]+)\)/) : null;
        const d6VarName = d6VarMatch ? d6VarMatch[1].split('.').pop() : undefined;
        const d6ContentPreview = d6VarMatch ? `{${d6VarMatch[1]}}` : textPreview;

        const elementTag = d6Carrier?.tag && !U3_ICON_COMPONENT_RE.test(d6Carrier.tag) ? d6Carrier.tag : undefined;

        const d6EvidenceStr = columnLabel
          ? `Column "${columnLabel}" cell (${elementTag || 'element'}) constrained by ${d6m[0]}${hasNowrap ? ' + nowrap' : ''} (no tooltip/expand) on ${d6ContentPreview || 'dynamic content'}`
          : `Cell (${elementTag || 'element'}) constrained by ${d6m[0]}${hasOverflowClip ? ' + overflow-hidden' : ''} at ${fileName}:${lineNumber}`;

        findings.push({
          subCheck: 'U3.D6',
          subCheckLabel: 'Column-constrained cell clipping',
          classification: 'potential',
          elementLabel: columnLabel ? `Constrained "${columnLabel}" cell` : 'Column-constrained cell',
          elementType: 'text',
          filePath,
          detection: `${d6m[0]}${hasOverflowClip ? ' + overflow-hidden' : ''}${hasNowrap ? ' + nowrap' : ''}${recoverySignals.length > 0 ? ` (recovery: ${recoverySignals.join(', ')})` : ''}`,
          evidence: d6EvidenceStr,
          explanation: 'Cell has a width constraint that may clip dynamic content without wrapping or a tooltip to reveal full text.',
          confidence,
          textPreview,
          advisoryGuidance: 'Add a title attribute, tooltip, or allow text wrapping to ensure content is accessible.',
          deduplicationKey: dedupeKey,
          truncationType: 'column-constraint',
          textLength: 'dynamic',
          triggerReason: 'Column constrained cell may clip dynamic content without wrap/tooltip',
          expandDetected: false,
          elementTag,
          varName: d6VarName,
          lineNumber,
          startLine: lineNumber,
          endLine: lineNumber,
          contentKind: contentGate.contentKind,
          recoverySignals: recoverySignals.length > 0 ? recoverySignals : undefined,
          truncationTokens,
          columnLabel: columnLabel || undefined,
          contentPreview: d6ContentPreview || undefined,
        });
      }
    }

    // --- U3.D7: Programmatic truncation with ellipsis ---
    // Detects .slice(0,N)/.substring(0,N)/.substr(0,N) + "..." in JSX text nodes
    {
      const progTruncRe = /\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\.(?:slice|substring|substr)\s*\(\s*0\s*,\s*(\d+)\s*\)([^{}]*)\}/g;
      let ptm;
      while ((ptm = progTruncRe.exec(content)) !== null) {
        const fullExpr = ptm[0];
        const varPart = ptm[1].trim();
        const sliceLen = parseInt(ptm[2], 10);
        const afterSlice = ptm[3];
        const pos = ptm.index;

        // Must have ellipsis adjacent: inside the expression or immediately after the closing }
        const hasEllipsisInExpr = /["'`]\.\.\.|["'`]…|\.\.\.["'`]|…["'`]|\+\s*["'`]\.\.\.["'`]|\+\s*["'`]…["'`]/.test(afterSlice);
        const afterBrace = content.slice(pos + fullExpr.length, pos + fullExpr.length + 10);
        const hasEllipsisAfter = /^\.\.\./.test(afterBrace) || /^…/.test(afterBrace);
        if (!hasEllipsisInExpr && !hasEllipsisAfter) continue;

        // Must be inside JSX (not in a comment or non-rendering context)
        const before100 = content.slice(Math.max(0, pos - 100), pos);
        if (/\/\/[^\n]*$/.test(before100)) continue;
        if (/\/\*/.test(before100) && !/\*\//.test(before100)) continue;

        const lineNumber = content.slice(0, pos).split('\n').length;
        const context = content.slice(Math.max(0, pos - 300), Math.min(content.length, pos + 400));

        // Header suppression
        if (u3IsHeaderRow(content, pos, context, undefined)) continue;

        // Build content preview from the exact expression
        const cleanVar = varPart.replace(/^\(/, '').replace(/\)$/, '');
        const contentPreview = `{${ptm[0].slice(1, -1)}${hasEllipsisAfter ? '...' : ''}}`;

        // Recovery detection
        const recoverySignals = u3DetectRecoverySignals(content, pos, context);
        if (u3HasExpandMechanism(content, pos, 20)) continue;
        if (recoverySignals.some(s => ['title_attr', 'tooltip_component', 'hover_card_component', 'popover_component'].includes(s))) continue;

        // ID/token sensitivity detection
        const varLower = cleanVar.toLowerCase();
        const isIdField = /(?:_id|\.id|uuid|token|hash|key)$/i.test(varLower) || /\bid\b/.test((varLower.split('.').pop() || ''));

        // Confidence scoring
        let confidence = 0.45;
        const before600 = content.slice(Math.max(0, pos - 600), pos);
        if (/\.map\s*\(\s*\(?[a-zA-Z_][\w,\s{}:]*\)?\s*=>/s.test(before600)) confidence += 0.15;
        if (hasEllipsisInExpr || hasEllipsisAfter) confidence += 0.10;
        if (isIdField) confidence -= 0.20;
        if (recoverySignals.length > 0) confidence -= 0.20;
        confidence = Math.round(Math.max(0.15, Math.min(0.90, confidence)) * 100) / 100;

        const columnLabel = u3FindColumnLabel(content, pos);
        const dedupeKey = `U3.D7|${filePath}|${lineNumber}|${columnLabel || ''}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        const carrier = u3FindCarrierElement(content, pos);
        const elementTag = carrier?.tag && !U3_ICON_COMPONENT_RE.test(carrier.tag) ? carrier.tag : undefined;

        const idNote = isIdField ? ' (intentional ID shortening — verify user can access full value where needed)' : '';
        const evidenceStr = columnLabel
          ? `Column "${columnLabel}" cell uses .slice(0, ${sliceLen}) + ellipsis on ${cleanVar}${idNote}`
          : `.slice(0, ${sliceLen}) + ellipsis on ${cleanVar} at ${fileName}:${lineNumber}${idNote}`;

        findings.push({
          subCheck: 'U3.D7',
          subCheckLabel: 'Programmatic truncation with ellipsis',
          classification: 'potential',
          elementLabel: columnLabel ? `Truncated "${columnLabel}" cell (slice)` : 'Programmatic text truncation',
          elementType: 'text',
          filePath,
          detection: `.slice(0, ${sliceLen}) + "..."${recoverySignals.length > 0 ? ` (recovery: ${recoverySignals.join(', ')})` : ''}`,
          evidence: evidenceStr,
          explanation: `Dynamic text is programmatically truncated to ${sliceLen} characters with ellipsis, but no mechanism to reveal the full value was detected.`,
          confidence,
          textPreview: `(dynamic text: ${cleanVar})`,
          advisoryGuidance: 'Add a title attribute, tooltip, copy-to-clipboard, or link to a detail view to reveal the full value.',
          deduplicationKey: dedupeKey,
          truncationKind: 'programmatic',
          truncationType: 'slice',
          sliceLength: sliceLen,
          textLength: 'dynamic',
          triggerReason: `Programmatic .slice(0, ${sliceLen}) + ellipsis on ${cleanVar}`,
          expandDetected: false,
          elementTag,
          varName: cleanVar.split('.').pop(),
          lineNumber,
          startLine: lineNumber,
          endLine: lineNumber,
          contentKind: 'dynamic',
          recoverySignals: recoverySignals.length > 0 ? recoverySignals : undefined,
          truncationTokens: [`.slice(0, ${sliceLen})`, '...'],
          columnLabel: columnLabel || undefined,
          contentPreview: contentPreview,
        });
      }
    }

    // Only match heights that are realistically large enough to clip content (h-12+, max-h-*)
    // Small heights like h-4, h-5, h-6, h-8, h-10 are icon/label sizing, not content containers
    const heightPatterns = /\b(?:max-h-\d+|h-(?:1[2-9]|[2-9]\d|\d{3,}))\b/g;
    let hm;
    while ((hm = heightPatterns.exec(content)) !== null) {
      const pos = hm.index;
      const lineNumber = content.slice(0, pos).split('\n').length;
      const context = content.slice(Math.max(0, pos - 200), Math.min(content.length, pos + 300));
      if (!/overflow-hidden\b|overflow-y-hidden\b/.test(context)) continue;
      if (/overflow-(?:auto|scroll|y-auto|y-scroll)\b/.test(context)) continue;

      const textPreview = extractU3TextPreview(content, pos);

      // ── GATE 2 (first): Header suppression ──
      if (u3IsHeaderRow(content, pos, context, textPreview)) continue;

      // ── GATE 1: Content risk — require dynamic text binding ──
      const contentGate = u3ContentRiskGate(content, pos, textPreview, context);
      if (!contentGate.pass) continue;
      if (contentGate.contentKind !== 'dynamic' && contentGate.contentKind !== 'list_mapped') continue;

      // ── GATE 3: Full suppress if ANY recovery exists ──
      const recoverySignals = u3DetectRecoverySignals(content, pos, context);
      if (recoverySignals.length > 0) continue;
      if (u3HasExpandMechanism(content, pos, 20)) continue;

      const truncationTokens = u3ExtractTruncationTokens(context);
      if (truncationTokens.length === 0) truncationTokens.push(hm[0], 'overflow-hidden');

      const confidence = u3ComputeConfidence({
        contentKind: contentGate.contentKind,
        hasTruncationUtility: false,
        fieldLabel: contentGate.fieldLabel,
        isHeaderSuspected: false,
      });
      if (confidence < 0.40) continue;

      const columnLabel = u3FindColumnLabel(content, pos);
      const dedupeKey = `U3.D2|${filePath}|${lineNumber}|${columnLabel || ''}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      findings.push({
        subCheck: 'U3.D2',
        subCheckLabel: 'Overflow clipping',
        classification: 'potential',
        elementLabel: columnLabel ? `Clipped content (column "${columnLabel}")` : 'Fixed-height overflow container',
        elementType: 'container',
        filePath,
        detection: `${hm[0]} + overflow-hidden${recoverySignals.length > 0 ? ` (recovery: ${recoverySignals.join(', ')})` : ''}`,
        evidence: columnLabel
          ? `Column "${columnLabel}" container uses ${hm[0]} + overflow-hidden, may clip content`
          : `${hm[0]} with overflow-hidden at ${fileName}:${lineNumber}`,
        explanation: `Container has a fixed height (${hm[0]}) with overflow-hidden, which may clip text content.`,
        confidence,
        textPreview,
        advisoryGuidance: 'Use overflow-auto for scrollable containers, or add an expand mechanism.',
        deduplicationKey: dedupeKey,
        truncationType: 'overflow-clip',
        triggerReason: `Fixed height (${hm[0]}) + overflow-hidden on ${contentGate.contentKind} content`,
        expandDetected: false,
        startLine: lineNumber,
        endLine: lineNumber,
        contentKind: contentGate.contentKind,
        recoverySignals: recoverySignals.length > 0 ? recoverySignals : undefined,
        truncationTokens,
        columnLabel: columnLabel || undefined,
      });
    }

    // --- U3.D3: Scroll trap risk ---
    const scrollRe = /\boverflow-y-(?:scroll|auto)\b/g;
    let sm;
    while ((sm = scrollRe.exec(content)) !== null) {
      const pos = sm.index;
      const context = content.slice(Math.max(0, pos - 300), Math.min(content.length, pos + 300));
      const scrollMatches = context.match(/overflow-y-(?:scroll|auto)/g);
      if (!scrollMatches || scrollMatches.length < 2) continue;
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
        truncationType: 'scroll-trap',
        triggerReason: 'Nested scroll containers within fixed-height parent',
        expandDetected: false,
      });
    }

    // --- U3.D4: Hidden content without control ---
    // ONLY flag HTML hidden attribute or Tailwind hidden class — NOT aria-hidden (decorative/intentional)
    const hiddenRe = /\bhidden\b/g;
    let hm2;
    while ((hm2 = hiddenRe.exec(content)) !== null) {
      const pos = hm2.index;
      const lineNumber = content.slice(0, pos).split('\n').length;
      const context = content.slice(Math.max(0, pos - 150), Math.min(content.length, pos + 500));
      const localOffset = Math.min(pos, 150);

      // Skip if this is `hidden={false}` or `hidden="false"`
      const afterMatch = content.slice(pos + 6, pos + 30);
      if (/^\s*=\s*["']?false/.test(afterMatch)) continue;
      if (/^\s*=\s*\{false\}/.test(afterMatch)) continue;

      // SUPPRESS: responsive hidden variants (sm:hidden, md:hidden, etc.)
      const lineStart = content.lastIndexOf('\n', pos) + 1;
      const lineEnd = content.indexOf('\n', pos);
      const currentLineText = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
      if (/\b(?:sm|md|lg|xl|2xl):hidden\b/.test(currentLineText)) continue;
      // Also suppress if nearby lines show responsive visibility pairing (hidden md:block, block md:hidden)
      const nearbyLines = content.slice(Math.max(0, pos - 300), Math.min(content.length, pos + 300));
      if (/hidden\s+(?:sm|md|lg|xl|2xl):(?:block|flex|inline|grid)\b/.test(nearbyLines)) continue;
      if (/(?:block|flex|inline|grid)\s+(?:sm|md|lg|xl|2xl):hidden\b/.test(nearbyLines)) continue;

      // SUPPRESS: aria-hidden="true" (intentional/decorative)
      if (/aria-hidden\s*=\s*["']true["']/.test(context.slice(Math.max(0, localOffset - 30), localOffset + 40))) continue;

      // Skip decorative elements
      if (/\bsvg\b|icon|separator|divider|decorat/i.test(context.slice(0, 200))) continue;
      // Skip sr-only / visually-hidden
      if (/sr-only|visually-hidden/i.test(context)) continue;

      // Must contain meaningful content (text ≥20 chars or dynamic)
      const contentAfter = context.slice(localOffset);
      const hasMeaningfulText = /<(?:p|h[1-6]|span|div|li)\b[^>]*>[^<]{20,}/i.test(contentAfter);
      const hasDynamic = />\s*\{[a-zA-Z_][\w.]*\}\s*</.test(contentAfter);
      const hasDescriptiveContent = /\b(?:description|message|content|paragraph|body|summary|bio|detail)\b/i.test(contentAfter);
      if (!hasMeaningfulText && !hasDynamic && !hasDescriptiveContent) continue;

      // SUPPRESS: toggle/control detected in ±25 lines
      if (u3HasExpandMechanism(content, pos, 25)) continue;

      // Additional toggle check: Menu/Open/Close/Show/Hide/Toggle buttons or aria-controls/aria-expanded
      const widerWindow = content.slice(Math.max(0, pos - 500), Math.min(content.length, pos + 500));
      if (/aria-controls|aria-expanded/i.test(widerWindow)) continue;
      if (/<(?:button|a)\b[^>]*>[^<]*(?:Menu|Open|Close|Show|Hide|Toggle)[^<]*/i.test(widerWindow)) continue;

      const dedupeKey = `U3.D4|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      const textPreview = extractU3TextPreview(content, pos);

      findings.push({
        subCheck: 'U3.D4',
        subCheckLabel: 'Hidden content without control',
        classification: 'potential',
        elementLabel: 'Hidden content (hidden attribute)',
        elementType: 'content',
        filePath,
        detection: 'hidden attribute on content element without visible toggle',
        evidence: `hidden at ${fileName}:${lineNumber} — meaningful content hidden without an associated toggle or control`,
        explanation: 'Content is hidden using the hidden attribute without a visible mechanism to reveal it. Users cannot access the hidden information.',
        confidence: 0.68,
        textPreview,
        advisoryGuidance: 'If the hidden content is meaningful, provide a visible toggle or control to reveal it.',
        deduplicationKey: dedupeKey,
        truncationType: 'hidden',
        triggerReason: hasDynamic ? 'Dynamic content hidden without toggle' : 'Meaningful text (≥20 chars) hidden without toggle',
        expandDetected: false,
      });
    }

    // --- U3.D5: Unbroken text overflow risk (refined gating) ---
    const U3_WRAP_SAFE = /\bbreak-words\b|\bbreak-all\b|\bwhitespace-normal\b|\boverflow-wrap[:\s]*anywhere\b|\boverflowWrap\s*:\s*["']?anywhere|\bword-break\s*:\s*break-word/;
    const U3_SCROLL_SAFE = /\boverflow-x-auto\b|\boverflow-auto\b/;
    const U3_STRONG_CONSTRAINT = /\btruncate\b|\bwhitespace-nowrap\b|\boverflow-hidden\b|\btext-ellipsis\b|\bline-clamp-[1-9]\b/;
    const U3_TRUNCATE_OR_NOWRAP = /\btruncate\b|\bwhitespace-nowrap\b/;
    const U3_FIXED_WIDTH = /\bw-\d|\bmax-w-/;
    const U3_WIDE_CONTAINER = /\bw-full\b|\bflex-1\b/;

    // Semantic risk tiers
    const U3_HIGH_RISK = /\b(?:reason|notes|bio|description|message|subject|comment|details|address|diagnosis|complaint|feedback|body|content|summary|remarks)\b/i;
    const U3_MEDIUM_RISK = /\b(?:specialty|title|label)\b/i;
    const U3_LOW_RISK = /\b(?:location|status|date|time|id|num|type)\b/i;
    const U3_LOW_RISK_NEVER = /\b(?:firstName|lastName|name|startTime|endTime|role|search|selectedDoctor|doctor|slot|count|email|phone|price|amount|code|key|slug|url|href|icon|avatar|image|src|alt|index|idx|length|size|width|height|color|variant|className|style|ref|onClick|onChange|onSubmit|disabled|checked|value|placeholder|control|register|errors|watch|reset|handleSubmit|trigger|formState|setValue|getValues)\b/i;
    const U3_SKIP_VAR = /^(?:i|j|k|e|_|el|ev|cb|fn|err|res|req|ctx|ref|key|idx|index|item|row|col|acc|cur|prev|next|len|num|val|tmp|obj|arr|map|set|get|put|del|add|sub|mod|div|max|min|sum|avg)$/;

    const U3_TEXT_VAR = />\s*\{([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)\}\s*</g;
    const U3_TEXT_VAR2 = />\s*[^<]*\{([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)\}/g;

    const d5SeenVars = new Map<string, number>();
    const d5Findings: U3Finding[] = [];

    for (const varRegex of [U3_TEXT_VAR, U3_TEXT_VAR2]) {
      varRegex.lastIndex = 0;
      let dxm;
      while ((dxm = varRegex.exec(content)) !== null) {
        const varName = dxm[1];
        const pos = dxm.index;

        if (U3_SKIP_VAR.test(varName)) continue;
        const segments = varName.split('.');
        if (segments[0] === 'form' || segments[0] === 'controller') continue;
        if (segments.length === 1 && segments[0].length <= 2) continue;

        const lastSeg = segments[segments.length - 1];
        if (U3_LOW_RISK_NEVER.test(lastSeg)) continue;

        let riskTier: 'High' | 'Medium' | 'Low' | 'None';
        if (U3_HIGH_RISK.test(lastSeg)) riskTier = 'High';
        else if (U3_MEDIUM_RISK.test(lastSeg)) riskTier = 'Medium';
        else if (U3_LOW_RISK.test(lastSeg)) riskTier = 'Low';
        else riskTier = 'None';

        if (riskTier === 'None') continue;

        // ── STRICT EVIDENCE BINDING: use carrier element + immediate parent only ──
        const carrier = u3FindCarrierElement(content, pos);
        const carrierClasses = carrier ? carrier.className : '';
        const parent = carrier ? u3FindParentElement(content, carrier.tagStart) : null;
        const parentClasses = parent ? parent.className : '';
        // Combined classes = carrier + immediate parent only (NOT wide context)
        const boundClasses = carrierClasses + ' ' + parentClasses;

        // HARD GATE: Must have strong constraint on carrier or immediate parent
        const hasStrongConstraint = U3_STRONG_CONSTRAINT.test(boundClasses);
        const hasFixedWidthWithOverflow = U3_FIXED_WIDTH.test(boundClasses) && /\boverflow-hidden\b/.test(boundClasses);
        const carrierTag = carrier?.tag || parent?.tag || '';
        const isTableCell = /^(td|th|TableCell)$/i.test(carrierTag) || /^(td|th|TableCell)$/i.test(parent?.tag || '');
        const isTableCellConstrained = isTableCell && (U3_STRONG_CONSTRAINT.test(boundClasses) || U3_FIXED_WIDTH.test(boundClasses));
        const isGridConstrained = /\bgrid\b/.test(boundClasses) && /\bcol(?:s|-span)/.test(boundClasses) && (/\bmax-w-/.test(boundClasses) || /\boverflow-hidden\b/.test(boundClasses));

        if (!hasStrongConstraint && !hasFixedWidthWithOverflow && !isTableCellConstrained && !isGridConstrained) continue;

        // Medium-risk: require truncate or whitespace-nowrap on carrier/parent
        if (riskTier === 'Medium' && !U3_TRUNCATE_OR_NOWRAP.test(boundClasses)) continue;

        // Low-risk: require BOTH truncate AND overflow-hidden on carrier/parent
        if (riskTier === 'Low') {
          if (!(/\btruncate\b/.test(boundClasses) && /\boverflow-hidden\b/.test(boundClasses))) continue;
        }

        // Suppress if wrap-safe classes on carrier/parent
        if (U3_WRAP_SAFE.test(boundClasses)) continue;
        if (U3_SCROLL_SAFE.test(boundClasses)) continue;
        if (/\bfont-mono\b|\bmonospace\b/i.test(boundClasses)) continue;

        // Per-file per-variable dedup
        const varKey = `${filePath}|${lastSeg}`;
        const prevCount = d5SeenVars.get(varKey) || 0;
        if (prevCount >= 1) continue;
        d5SeenVars.set(varKey, prevCount + 1);

        const lineNumber = content.slice(0, pos).split('\n').length;
        const dedupeKey = `U3.D5|${filePath}|${lineNumber}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        // ── GATE 2: Header row suppression for D5 ──
        const d5Context = content.slice(Math.max(0, pos - 200), Math.min(content.length, pos + 300));
        if (u3IsHeaderRow(content, pos, d5Context, `(dynamic text: ${varName})`)) continue;

        // ── GATE 3: Recovery / expand — full suppress if ANY recovery exists ──
        const recoverySignals = u3DetectRecoverySignals(content, pos, d5Context);
        if (recoverySignals.length > 0) continue;
        const expandCheck = u3HasComponentExpandForVar(content, varName, pos);
        const hasLocalExpand = u3HasExpandMechanism(content, pos, 20);

        if (expandCheck.hasExpand || hasLocalExpand) continue;

        // Check if inside .map() context
        const before500 = content.slice(Math.max(0, pos - 500), pos);
        const isInMapContext = /\.map\s*\(\s*\(?[a-zA-Z_][\w,\s{}:]*\)?\s*=>/s.test(before500);
        const contentKind: 'dynamic' | 'list_mapped' = isInMapContext ? 'list_mapped' : 'dynamic';

        // Confidence using revised model
        const hasTruncUtility = /\btruncate\b|\bline-clamp-[1-9]\b|\btext-ellipsis\b/.test(boundClasses);
        const confidence = u3ComputeConfidence({
          contentKind,
          hasTruncationUtility: hasTruncUtility,
          fieldLabel: lastSeg,
          isHeaderSuspected: false,
        });
        if (confidence < 0.40) continue;

        // Collect matched classes from carrier/parent only
        const truncationTokens = u3ExtractTruncationTokens(boundClasses);

        // Element attribution
        const rawTag = U3_STRONG_CONSTRAINT.test(carrierClasses) ? (carrier?.tag || undefined) :
                          U3_STRONG_CONSTRAINT.test(parentClasses) ? (parent?.tag || undefined) :
                          (carrier?.tag || undefined);
        const reportTag = rawTag && U3_ICON_COMPONENT_RE.test(rawTag) ? (parent?.tag || carrier?.tag || undefined) : rawTag;

        d5Findings.push({
          subCheck: 'U3.D5',
          subCheckLabel: 'Unbroken text overflow risk',
          classification: 'potential',
          elementLabel: `Unbroken text overflow (${varName})`,
          elementType: 'text',
          filePath,
          detection: `Long unbroken text may overflow (no wrap protection)${recoverySignals.length > 0 ? ` (recovery: ${recoverySignals.join(', ')})` : ''}`,
          evidence: `{${varName}} [${riskTier}] at ${fileName}:${lineNumber} — carrier <${reportTag || '?'}> — no wrap protection`,
          explanation: 'User-generated text without spaces can overflow the container when word-break protection is missing.',
          confidence,
          textPreview: `(dynamic text: ${varName})`,
          advisoryGuidance: 'Add break-words / overflow-wrap:anywhere and allow multi-line display, or clamp with "Show more".',
          deduplicationKey: dedupeKey,
          truncationType: 'unbroken-overflow',
          textLength: 'dynamic',
          triggerReason: `{${varName}} [${riskTier}-risk] in <${reportTag || '?'}> with ${truncationTokens.join(' + ')} but no wrap protection`,
          expandDetected: false,
          elementTag: reportTag,
          varName: lastSeg,
          lineNumber,
          startLine: lineNumber,
          endLine: lineNumber,
          contentKind,
          recoverySignals: recoverySignals.length > 0 ? recoverySignals : undefined,
          truncationTokens: truncationTokens.length > 0 ? truncationTokens : undefined,
        });
      }
    }
    // Cap U3.D5 to max 3 per file
    const d5ByFile = new Map<string, U3Finding[]>();
    for (const f of d5Findings) { const ex = d5ByFile.get(f.filePath) || []; ex.push(f); d5ByFile.set(f.filePath, ex); }
    for (const [, ff] of d5ByFile) {
      ff.sort((a, b) => b.confidence - a.confidence);
      findings.push(...ff.slice(0, 3));
    }
  }

  // ── Cross-subcheck deduplication ──
  // When D1 (truncate) and D5 (overflow) fire on the same file+variable within ±10 lines,
  // merge into a single finding with the higher-priority type and combined evidence.
  const TRUNC_PRIORITY: Record<string, number> = { 'line-clamp': 3, truncate: 2, nowrap: 1, 'unbroken-overflow': 0, 'text-ellipsis': 2 };
  const mergedFindings: U3Finding[] = [];
  const mergeMap = new Map<string, U3Finding>(); // key: file|varName

  for (const f of findings) {
    if (!f.varName || !f.lineNumber) {
      mergedFindings.push(f); // D2/D3/D4 pass through unchanged
      continue;
    }
    const mergeKey = `${f.filePath}|${f.varName}`;
    const existing = mergeMap.get(mergeKey);
    if (existing && existing.lineNumber && Math.abs(existing.lineNumber - f.lineNumber) <= 10) {
      // Merge: keep higher-priority truncation type, combine evidence
      const existingPrio = TRUNC_PRIORITY[existing.truncationType || ''] ?? -1;
      const newPrio = TRUNC_PRIORITY[f.truncationType || ''] ?? -1;
      existing.occurrences = (existing.occurrences || 1) + 1;
      if (newPrio > existingPrio) {
        existing.truncationType = f.truncationType;
        existing.subCheck = f.subCheck;
        existing.subCheckLabel = f.subCheckLabel;
        existing.elementLabel = `Content may be cut off (${existing.truncationType}${f.truncationType !== existing.truncationType ? ' + overflow risk' : ''})`;
        existing.detection = `${f.detection} (merged with ${existing.detection})`;
      } else {
        existing.elementLabel = `Content may be cut off (${existing.truncationType}${f.truncationType !== existing.truncationType ? ' + overflow risk' : ''})`;
      }
      existing.confidence = Math.max(existing.confidence, f.confidence);
      existing.evidence = `${existing.evidence} | also: ${f.evidence}`;
    } else if (!existing) {
      f.occurrences = 1;
      mergeMap.set(mergeKey, f);
    } else {
      // Same var but far apart — keep both
      f.occurrences = 1;
      mergedFindings.push(f);
    }
  }
  mergedFindings.push(...mergeMap.values());

  // Aggregate: cap per file (max 5 findings per file after merge)
  const byFile = new Map<string, U3Finding[]>();
  for (const f of mergedFindings) {
    const existing = byFile.get(f.filePath) || [];
    existing.push(f);
    byFile.set(f.filePath, existing);
  }
  const capped: U3Finding[] = [];
  for (const [, fileFindgs] of byFile) {
    fileFindgs.sort((a, b) => b.confidence - a.confidence);
    capped.push(...fileFindgs.slice(0, 5));
  }

  // Confidence adjustment: base + 0.03 per additional sub-check, cap 0.90 for confirmed, 0.75 for potential
  const subChecks = new Set(capped.map(f => f.subCheck));
  const bonus = Math.min((subChecks.size - 1) * 0.03, 0.09);
  for (const f of capped) {
    const cap = f.classification === 'confirmed' ? 0.90 : 0.75;
    f.confidence = Math.min(f.confidence + bonus, cap);
  }

  console.log(`[U3] Detection: ${findings.length} raw → ${mergedFindings.length} after merge → ${capped.length} after capping (${subChecks.size} sub-checks)`);

  return capped;
}

// =====================
// U1.3 Context-Aware Suppression Signals
// =====================
// Detects labeled steppers, strong headings near CTAs, and single-primary-CTA patterns
// to suppress generic CTA labels when context makes the action clear.

interface U13ContextResult {
  hasLabeledStepper: boolean;
  hasStrongNearbyHeading: (btnOffset: number) => boolean;
  isSinglePrimaryCTA: boolean;
  contextSignals: string[];
}

function detectU13ContextSignals(
  content: string,
  allButtons: ButtonUsage[],
  buttonImpl: { filePath: string; config: CvaVariantConfig } | null,
): U13ContextResult {
  const contextSignals: string[] = [];

  // (A) Labeled stepper detection
  // Look for 3+ step items with visible text labels and an active step indicator
  let hasLabeledStepper = false;

  // Pattern 1: Step/Stepper components with labeled items
  const stepItemRe = /<(?:Step|StepItem|StepTrigger|StepperItem|StepLabel)\b[^>]*>([^<]{2,})<\//gi;
  const stepItemMatches = content.match(stepItemRe);
  if (stepItemMatches && stepItemMatches.length >= 3) {
    // Check for active step indicator
    const hasActiveStep = /(?:aria-current\s*=\s*["']step["']|data-state\s*=\s*["']active["']|isActive|currentStep|activeStep|step\s*===?\s*\d|className\s*=\s*[^>]*(?:active|current|selected))/i.test(content);
    if (hasActiveStep) {
      hasLabeledStepper = true;
      contextSignals.push('stepper_labels');
      contextSignals.push('active_step_indicator');
    }
  }

  // Pattern 2: Steps defined as array with label/title properties
  const stepsArrayRe = /(?:const|let)\s+\w*[Ss]teps\w*\s*=\s*\[([^\]]{20,})\]/s;
  const stepsArrayMatch = content.match(stepsArrayRe);
  if (stepsArrayMatch) {
    const arrayContent = stepsArrayMatch[1];
    const labelEntries = arrayContent.match(/(?:label|title|name)\s*:\s*["'][^"']+["']/gi);
    if (labelEntries && labelEntries.length >= 3) {
      const hasStepTracking = /(?:currentStep|activeStep|step\s*===?\s*\d|setStep|useState.*step)/i.test(content);
      if (hasStepTracking) {
        hasLabeledStepper = true;
        contextSignals.push('stepper_array_labels');
        contextSignals.push('step_state_tracking');
      }
    }
  }

  // Pattern 3: Stepper/Progress component usage with step count
  const stepperComponentRe = /<(?:Stepper|Steps|ProgressSteps|StepWizard)\b[^>]*>/i;
  if (stepperComponentRe.test(content)) {
    const stepChildRe = /<(?:Step|StepItem)\b/gi;
    const stepChildren = content.match(stepChildRe);
    if (stepChildren && stepChildren.length >= 3) {
      hasLabeledStepper = true;
      contextSignals.push('stepper_component');
    }
  }

  // (B) Strong nearby heading detection
  // Find all heading positions in the content
  const headingPositions: Array<{ offset: number; text: string }> = [];
  // Semantic headings
  const headingRe = /<(?:h[1-3])\b[^>]*>([^<]+)</gi;
  let hMatch;
  while ((hMatch = headingRe.exec(content)) !== null) {
    const text = hMatch[1].trim();
    if (text.length >= 5) { // meaningful heading text
      headingPositions.push({ offset: hMatch.index, text });
    }
  }
  // Heading-like typography (text-2xl+ with font-bold/semibold)
  const typoHeadingRe = /<(?:p|span|div)\b[^>]*className\s*=\s*["'][^"']*\b(?:text-(?:2xl|3xl|4xl|5xl))\b[^"']*\b(?:font-(?:bold|semibold))\b[^"']*["'][^>]*>([^<]+)</gi;
  while ((hMatch = typoHeadingRe.exec(content)) !== null) {
    const text = hMatch[1].trim();
    if (text.length >= 5) {
      headingPositions.push({ offset: hMatch.index, text });
    }
  }
  // Also match reversed order (font-bold before text-2xl)
  const typoHeadingRe2 = /<(?:p|span|div)\b[^>]*className\s*=\s*["'][^"']*\b(?:font-(?:bold|semibold))\b[^"']*\b(?:text-(?:2xl|3xl|4xl|5xl))\b[^"']*["'][^>]*>([^<]+)</gi;
  while ((hMatch = typoHeadingRe2.exec(content)) !== null) {
    const text = hMatch[1].trim();
    if (text.length >= 5 && !headingPositions.some(h => h.offset === hMatch!.index)) {
      headingPositions.push({ offset: hMatch.index, text });
    }
  }

  const HEADING_PROXIMITY_CHARS = 2000; // ~25 lines
  const hasStrongNearbyHeading = (btnOffset: number): boolean => {
    return headingPositions.some(h => {
      const dist = btnOffset - h.offset;
      return dist >= 0 && dist <= HEADING_PROXIMITY_CHARS;
    });
  };
  if (headingPositions.length > 0) contextSignals.push('nearby_heading');

  // (C) Single primary CTA detection
  let highEmphasisCount = 0;
  for (const btn of allButtons) {
    const emph = buttonImpl && (btn.variant || buttonImpl.config.defaultVariant)
      ? classifyButtonEmphasis({
          resolvedVariant: btn.variant || buttonImpl.config.defaultVariant || 'default',
          variantConfig: buttonImpl.config,
          instanceClassName: btn.className,
        }).emphasis
      : classifyTailwindEmphasis(btn.className);
    if (emph === 'high') highEmphasisCount++;
  }
  const isSinglePrimaryCTA = highEmphasisCount <= 1;
  if (isSinglePrimaryCTA) contextSignals.push('single_primary_cta');

  return { hasLabeledStepper, hasStrongNearbyHeading, isSinglePrimaryCTA, contextSignals };
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
// U2 Navigation Detection — Web/Desktop Wayfinding Clarity Only (v4)
// Sub-checks: U2.D1 (missing nav landmark), U2.D2 (deep pages without "you are here" cues), U2.D3 (breadcrumb depth risk — evidence-gated)
// Scope: Can users know where they are, where they can go, and how to go back?
// U2 must NOT evaluate: layout grouping (U6), truncation (U3), step indicators (U4), exit/cancel absence (E3), landmark semantics (A-rules)
// =====================

// =====================
// U2.D3 — Breadcrumb Depth Risk Detector (project-agnostic, evidence-gated)
// Only emits when BOTH:
//   (1) Breadcrumb implementation shows cap-depth pattern (returns ≤2 levels, maps shallow segments only)
//   (2) Multi-channel evidence of deeper route hierarchy (≥3 segments) exists in the project
// Evidence channels: A (router defs), B (deep links), C (file system heuristics — weak alone)
// =====================

function detectBreadcrumbCapDepth(allFiles: Map<string, string>, breadcrumbLogicFilesArg: string[]): { capped: boolean; file: string; functionName: string } | null {
  const breadcrumbFilePatterns = /breadcrumb|crumbs|navtrail/i;

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;

    const isBreadcrumbFile = breadcrumbFilePatterns.test(filePath) || breadcrumbLogicFilesArg.includes(filePath);
    const hasBreadcrumbTokens = /getBreadcrumbs|buildBreadcrumbs|makeCrumbs|breadcrumbs?\s*[:=]\s*\[/i.test(content);
    if (!isBreadcrumbFile && !hasBreadcrumbTokens) continue;

    const fnNameMatch = content.match(/(?:function|const)\s+(getBreadcrumbs|buildBreadcrumbs|makeCrumbs|createBreadcrumbs?|useBreadcrumbs?)\b/i);
    const functionName = fnNameMatch ? fnNameMatch[1] : 'breadcrumb logic';

    // Cap-depth heuristic 1: returns fixed list with ≤2 entries
    if (/(?:return|=)\s*\[\s*\{[^}]+\}\s*,\s*\{[^}]+\}\s*\]/i.test(content) &&
        !/(?:return|=)\s*\[\s*\{[^}]+\}\s*,\s*\{[^}]+\}\s*,\s*\{/i.test(content)) {
      return { capped: true, file: filePath, functionName };
    }

    // Cap-depth heuristic 2: split("/") then only accesses index 0 or 1
    if (/\.split\s*\(\s*["']\/?["']\s*\)/.test(content)) {
      const usesShallowIndex = /segments?\[0\]|segments?\[1\]|parts?\[0\]|parts?\[1\]/i.test(content);
      const usesDeepIndex = /segments?\[[2-9]\]|parts?\[[2-9]\]|\.slice\(\s*0\s*,\s*[3-9]/i.test(content);
      if (usesShallowIndex && !usesDeepIndex) {
        return { capped: true, file: filePath, functionName };
      }
    }

    // Cap-depth heuristic 3: switch/case with only shallow path cases
    if (/switch\s*\(/i.test(content)) {
      const cases = content.match(/case\s*["']\/[^"']*["']/gi) || [];
      if (cases.length >= 1) {
        const maxCaseDepth = Math.max(...cases.map(c => {
          const p = c.replace(/case\s*["']/i, '').replace(/["']$/, '');
          return p.split('/').filter(Boolean).length;
        }), 0);
        if (maxCaseDepth <= 2) {
          return { capped: true, file: filePath, functionName };
        }
      }
    }

    // Cap-depth heuristic 4: .slice(0, 2) on segments
    if (/\.slice\s*\(\s*0\s*,\s*2\s*\)|\.slice\s*\(\s*-2\s*\)/i.test(content) &&
        /segment|crumb|path|part/i.test(content)) {
      return { capped: true, file: filePath, functionName };
    }
  }

  return null;
}

function collectDeepRouteEvidence(allFiles: Map<string, string>): { maxDepth: number; exampleRoute: string; channels: string[] } {
  let maxDepth = 0;
  let exampleRoute = '';
  const channelsUsed = new Set<string>();

  function measureDepth(pathStr: string): number {
    const normalized = pathStr.replace(/:[^/]+|\[[^\]]+\]|\$[^/]+/g, '_dyn');
    return normalized.split('/').filter(Boolean).length;
  }

  function updateMax(path: string, depth: number, channel: string) {
    if (depth > maxDepth) { maxDepth = depth; exampleRoute = path; }
    if (depth >= 3) channelsUsed.add(channel);
  }

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (filePath.includes('node_modules/')) continue;

    if (/\.(tsx|jsx|ts|js)$/.test(filePath)) {
      // Channel A — Router/route definitions
      const routePaths = content.match(/path\s*[:=]\s*["'](\/?[^"']+)["']/gi) || [];
      for (const m of routePaths) {
        const p = m.replace(/path\s*[:=]\s*["']/i, '').replace(/["']$/, '');
        updateMax(p, measureDepth(p), 'A');
      }

      // Channel B — Deep links (Link to="...", href="...", navigate("..."))
      const linkMatches = content.match(/(?:to|href|navigate)\s*(?:=\s*|[(])\s*["'](\/[^"']{4,})["']/gi) || [];
      for (const m of linkMatches) {
        const p = m.replace(/(?:to|href|navigate)\s*(?:=\s*|[(])\s*["']/i, '').replace(/["']$/, '');
        updateMax(p, measureDepth(p), 'B');
      }
      // Template literal deep links
      const templateLinks = content.match(/(?:to|href|navigate)\s*(?:=\s*|[(])\s*`(\/[^`]{4,})`/gi) || [];
      for (const m of templateLinks) {
        const p = m.replace(/(?:to|href|navigate)\s*(?:=\s*|[(])\s*`/i, '').replace(/`$/, '');
        const normalized = p.replace(/\$\{[^}]+\}/g, '_dyn');
        updateMax(normalized, measureDepth(normalized), 'B');
      }
    }

    // Channel C — File system route evidence (framework-agnostic, weak alone)
    if (/\/(pages|app|routes|views)\//.test(filePath)) {
      const routePart = filePath.replace(/^.*?\/(pages|app|routes|views)\//, '/');
      const cleanedRoute = routePart
        .replace(/\.(tsx|jsx|ts|js|mdx?)$/, '')
        .replace(/\/index$/, '')
        .replace(/\/page$/, '');
      const depth = measureDepth(cleanedRoute);
      if (depth >= 3) updateMax(cleanedRoute, depth, 'C');
    }
  }

  return { maxDepth, exampleRoute, channels: [...channelsUsed] };
}

function detectBreadcrumbDepthRisk(
  allFiles: Map<string, string>,
  breadcrumbLogicFilesArg: string[],
  hasBreadcrumbLogicDefined: boolean,
  _hasBreadcrumbComponentInDesignSystem: boolean,
  hasBreadcrumbRendered: boolean,
  hasActiveNavHighlight: boolean,
  hasPageHeadingInLayout: boolean,
): Omit<U2Finding, 'deduplicationKey'> | null {
  // Step 1: Detect cap-depth breadcrumb implementation
  const capDepth = detectBreadcrumbCapDepth(allFiles, breadcrumbLogicFilesArg);
  if (!capDepth) return null; // No cap-depth signal → no finding

  // Step 2: Collect multi-channel evidence of deeper hierarchy
  const evidence = collectDeepRouteEvidence(allFiles);

  // Gate: require maxDepth ≥ 3 from router (A) or link (B) channels — C alone is insufficient
  const hasStrongEvidence = evidence.maxDepth >= 3 && (evidence.channels.includes('A') || evidence.channels.includes('B'));
  if (!hasStrongEvidence) return null;

  // Mitigation: suppress if breadcrumb IS rendered AND strong alternative wayfinding exists
  if (hasBreadcrumbRendered && hasActiveNavHighlight && hasPageHeadingInLayout) return null;

  // Step 3: Compute confidence
  let confidence = 0.60;
  if (evidence.channels.includes('A')) confidence += 0.10;
  if (evidence.channels.includes('B')) confidence += 0.10;
  if (evidence.channels.includes('A') && evidence.channels.includes('B')) confidence += 0.05;
  confidence = Math.min(confidence, 0.85);

  return {
    subCheck: 'U2.D3',
    subCheckLabel: 'Breadcrumb depth may not cover deep routes',
    classification: 'potential',
    elementLabel: capDepth.functionName,
    elementType: 'navigation',
    filePath: capDepth.file,
    detection: 'Breadcrumb implementation appears limited to 1–2 levels',
    evidence: `${capDepth.functionName} in ${capDepth.file} appears capped at ≤2 levels. App includes deeper routes (e.g., "${evidence.exampleRoute}", depth ${evidence.maxDepth}). Evidence channels: ${evidence.channels.join(', ')}.`,
    explanation: `Breadcrumb logic appears limited to 1–2 levels, but the app includes deeper routes such as "${evidence.exampleRoute}", which may reduce wayfinding cues.`,
    confidence,
    advisoryGuidance: 'Review breadcrumb logic to ensure it covers the full route depth, or provide alternative wayfinding cues for deep views.',
  };
}


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

// Navigation UI component names that indicate visible nav exists
const NAV_COMPONENT_NAMES = /\b(Sidebar|Navbar|Header|Topbar|Menu|Tabs|Breadcrumb|NavigationMenu|Drawer|Sheet|Stepper|AppSidebar|TopNav|BottomNav|NavBar|MainNav|SideNav)\b/;

function detectU2Navigation(allFiles: Map<string, string>): U2Finding[] {
  const findings: U2Finding[] = [];
  const seenKeys = new Set<string>();

  // --- Collect global signals ---
  let routeCount = 0;
  const routeFiles: string[] = [];
  const deepRouteFiles: string[] = [];
  let hasNavComponentRendered = false;
  let hasNavItemsMapping = false;
  let hasBreadcrumbLogicDefined = false;
  let hasBreadcrumbComponentInDesignSystem = false;
  let hasBreadcrumbRendered = false;
  const breadcrumbLogicFiles: string[] = [];
  let hasBackControl = false;
  let hasParentRouteLink = false;
  let hasLayoutWithNav = false;
  let hasTabsAsPrimaryIA = false;
  let hasDrawerWithMenu = false;
  let navPrimitiveCount = 0;
  const navPrimitivesFound = new Set<string>();
  let hasVisiblePageTitle = false;
  let hasMobileOnlyNavToggle = false;
  let hasDesktopNavHidden = false;
  let maxRouteDepth = 0;
  // D2: active link styling signals
  let hasActiveNavHighlight = false;
  // D2: page heading in layout files only (not route pages)
  let hasPageHeadingInLayout = false;
  // D2 NEW: page heading found in route pages rendered under layouts
  let hasPageHeadingInRoutePages = false;
  // Track route page file paths for post-scan heading verification
  const routePageFiles: string[] = [];

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    // --- Count user-facing routes ---
    const routePatterns = [/<Route\b/gi, /path\s*[:=]\s*["']\//gi, /createBrowserRouter/gi, /useRoutes/gi];
    let fileRouteCount = 0;
    for (const pat of routePatterns) {
      const matches = content.match(pat);
      if (matches) fileRouteCount += matches.length;
    }
    if (fileRouteCount > 0) { routeCount += fileRouteCount; routeFiles.push(filePath); }

    // --- Detect deep routes (depth ≥2 with detail/edit patterns) ---
    const deepPathPatterns = content.match(/path\s*[:=]\s*["'](\/?[^"']+)["']/gi) || [];
    for (const match of deepPathPatterns) {
      const pathValue = match.replace(/path\s*[:=]\s*["']/i, '').replace(/["']$/, '');
      const segments = pathValue.split('/').filter(Boolean);
      if (segments.length >= 2) {
        const hasDetailPattern = /(:id|\[id\]|\/edit|\/new|\/create|\/details)/i.test(pathValue);
        if (hasDetailPattern) {
          deepRouteFiles.push(filePath);
        }
      }
    }

    // --- Detect rendered nav components ---
    if (NAV_COMPONENT_NAMES.test(content)) {
      const navCompMatch = content.match(NAV_COMPONENT_NAMES);
      if (navCompMatch) {
        const compName = navCompMatch[1];
        if (new RegExp(`<${compName}\\b`, 'i').test(content)) {
          hasNavComponentRendered = true;
        }
      }
    }

    // --- Detect navItems/routes array mapped in JSX ---
    if (/(?:navItems|menuItems|routes|links|navigationItems|sidebarItems)\s*\.map\s*\(/i.test(content)) {
      hasNavItemsMapping = true;
    }

    // --- Detect layout wrapper providing nav ---
    if (/layout|sidebar|navbar|header|navigation|menu/i.test(filePath)) {
      if (/<(?:Link|NavLink|a)\b[^>]*(?:href|to)\s*=/i.test(content)) {
        hasLayoutWithNav = true;
      }
      if (NAV_COMPONENT_NAMES.test(content)) {
        hasLayoutWithNav = true;
      }
    }

  // --- Breadcrumb signals (D3) ---
    if (/getBreadcrumbs\s*\(|buildBreadcrumbs\s*\(|makeCrumbs\s*\(|breadcrumbs?\s*[:=]\s*\[/i.test(content) ||
        /breadcrumb|crumbs|navtrail/i.test(filePath)) {
      hasBreadcrumbLogicDefined = true;
      breadcrumbLogicFiles.push(filePath);
    }
    if (/(?:export\s+(?:function|const)\s+Breadcrumb|Breadcrumb\s*=\s*React\.forwardRef|const\s+Breadcrumb\b)/i.test(content)) {
      hasBreadcrumbComponentInDesignSystem = true;
    }
    if (/<Breadcrumb\b/i.test(content) || /role\s*=\s*["']breadcrumb["']/i.test(content)) {
      hasBreadcrumbRendered = true;
    }

    // --- Back/up control (D2) ---
    if (/<(?:Button|button|a|Link)\b[^>]*>(?:[^<]*(?:Back|Go back|Return|← Back|Previous|Cancel)[^<]*)<\//i.test(content)) {
      hasBackControl = true;
    }
    if (/navigate\s*\(\s*-1\s*\)|history\.back|router\.back/i.test(content)) {
      if (/<(?:Button|button|a|Link)\b/i.test(content)) {
        hasBackControl = true;
      }
    }
    if (/<(?:Link|a)\b[^>]*(?:href|to)\s*=\s*["']\/[^"'/]*["']/i.test(content) &&
        /header|breadcrumb|page-title|back/i.test(content)) {
      hasParentRouteLink = true;
    }

    // --- D2 NEW: Active link highlight detection ---
    // aria-current="page", NavLink (react-router gives isActive), data-state=active,
    // className containing "active" or "selected" in nav/sidebar/menu context
    if (/aria-current\s*=\s*["']page["']/i.test(content)) hasActiveNavHighlight = true;
    if (/<NavLink\b/i.test(content)) hasActiveNavHighlight = true; // NavLink provides isActive by default
    if (/isActive|data-state\s*=\s*["']active["']/i.test(content) &&
        /nav|sidebar|menu|header|tab/i.test(content)) hasActiveNavHighlight = true;
    if (/className\s*=.*(?:active|selected|current)/i.test(content) &&
        /nav|sidebar|menu|header|tab/i.test(filePath + content.slice(0, 200))) hasActiveNavHighlight = true;

    // --- D2: Page heading in layout files only ---
    if (/<h1\b/i.test(content) || /<h2\b/i.test(content)) {
      if (/layout/i.test(filePath)) {
        hasPageHeadingInLayout = true;
      }
    }

    // --- Collect route page files (pages/views/screens rendered under layouts) ---
    if (/page|view|screen|dashboard|detail|appointments|messages|patients|settings/i.test(filePath) &&
        !/layout|component|ui\//i.test(filePath) &&
        /\.(tsx|jsx)$/.test(filePath)) {
      routePageFiles.push(filePath);
    }

    // h1 anywhere counts as visible page title
    if (/<h1\b/i.test(content)) hasVisiblePageTitle = true;

    // --- Suppression signals ---
    if (/<Tabs\b/i.test(content) && /<TabsList\b/i.test(content)) {
      hasTabsAsPrimaryIA = true;
      navPrimitivesFound.add('Tabs');
    }
    if (/<(?:Drawer|Sheet)\b/i.test(content) && /(?:Menu|menu|hamburger|☰)/i.test(content)) {
      hasDrawerWithMenu = true;
      navPrimitivesFound.add('Drawer/Sheet');
    }
    if (/<Sidebar\b/i.test(content)) navPrimitivesFound.add('Sidebar');
    if (/<Breadcrumb\b/i.test(content)) navPrimitivesFound.add('Breadcrumb');
    if (/<Navbar\b|<NavBar\b|<Header\b.*(?:nav|link|menu)/i.test(content)) navPrimitivesFound.add('Navbar');
    if (/<NavigationMenu\b/i.test(content)) navPrimitivesFound.add('NavigationMenu');

    // --- Desktop-scope: detect mobile-only nav patterns ---
    if (/mobileOpen|isMobileMenuOpen|mobileMenuOpen|menuOpen.*mobile/i.test(content)) {
      hasMobileOnlyNavToggle = true;
    }
    if (/(?:sm:|md:)(?:hidden|block|flex|inline-flex)\b/i.test(content) &&
        /(?:nav|sidebar|menu|header)/i.test(content)) {
      if (/(?:lg:|xl:)hidden\b/i.test(content)) {
        hasDesktopNavHidden = true;
      } else {
        hasMobileOnlyNavToggle = true;
      }
    }

    // --- Track max route depth ---
    const pathMatches = content.match(/path\s*[:=]\s*["'](\/?[^"']+)["']/gi) || [];
    for (const match of pathMatches) {
      const pathValue = match.replace(/path\s*[:=]\s*["']/i, '').replace(/["']$/, '');
      const depth = pathValue.split('/').filter(Boolean).length;
      if (depth > maxRouteDepth) maxRouteDepth = depth;
    }
  }

  navPrimitiveCount = navPrimitivesFound.size;

  // ===== POST-SCAN: Route-page heading verification (deterministic) =====
  // Scan route page files for <h1> or role="heading" aria-level="1"
  for (const rpFile of routePageFiles) {
    const rpContent = allFiles.get(rpFile);
    if (!rpContent) continue;
    if (/<h1\b/i.test(rpContent) || /role\s*=\s*["']heading["'][^>]*aria-level\s*=\s*["']1["']/i.test(rpContent)) {
      hasPageHeadingInRoutePages = true;
      break;
    }
  }

  // ===== GLOBAL SUPPRESSION =====
  // 1. Simple app (≤2 routes) — no nav complexity
  if (routeCount <= 2) {
    console.log('[U2] Suppressed: simple app (≤2 routes)');
    return [];
  }
  // 2. ≥2 navigation primitives present (strong wayfinding)
  if (navPrimitiveCount >= 2) {
    console.log(`[U2] Suppressed: ≥2 nav primitives (${[...navPrimitivesFound].join(', ')})`);
    return [];
  }
  // 3. Layout provides navigation with rendered nav component
  if (hasLayoutWithNav && hasNavComponentRendered) {
    console.log('[U2] Suppressed: layout wrapper provides navigation with rendered nav component');
    return [];
  }
  // 4. Tabs used as primary IA in small apps
  if (hasTabsAsPrimaryIA && routeCount <= 5) {
    console.log('[U2] Suppressed: Tabs used as primary IA');
    return [];
  }
  // 5. Drawer/Sheet with Menu button
  if (hasDrawerWithMenu) {
    console.log('[U2] Suppressed: Drawer/Sheet with menu button');
    return [];
  }
  // 6. Active nav highlight + visible page heading (layout OR route pages) = strong wayfinding
  if (hasActiveNavHighlight && (hasVisiblePageTitle || hasPageHeadingInRoutePages)) {
    console.log('[U2] Suppressed: active nav highlight + visible page heading');
    return [];
  }
  // 7. Breadcrumb rendered + page title = strong wayfinding
  if (hasBreadcrumbRendered && hasVisiblePageTitle) {
    console.log('[U2] Suppressed: breadcrumb + page title');
    return [];
  }
  // 8. Desktop-scope: mobile-only nav toggle without desktop hiding
  if (hasMobileOnlyNavToggle && !hasDesktopNavHidden) {
    console.log('[U2] Suppressed: mobile-only nav toggle (desktop nav assumed visible)');
    return [];
  }
  // 9. NEW: Active nav highlight + route pages contain <h1> titles → suppress
  if (hasActiveNavHighlight && hasPageHeadingInRoutePages) {
    console.log('[U2] Suppressed: active nav highlight + route pages have <h1> headings');
    return [];
  }

  // ===== U2.D1 — Missing navigation landmark for multi-page apps =====
  // Trigger: ≥3 routes AND no <nav>/role="navigation" AND no nav component rendered AND no navItems mapping
  if (routeCount >= 3 && !hasNavComponentRendered && !hasNavItemsMapping && !hasLayoutWithNav) {
    // D1 mitigation: a reusable layout with route links (even without <nav> wrapper)
    // Already checked via hasLayoutWithNav above, so if we reach here, it's genuinely missing
    const dedupeKey = 'U2.D1|global';
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      const conf = Math.min(0.65 + (routeCount > 5 ? 0.05 : 0) + (routeCount > 8 ? 0.05 : 0), 0.75);
      findings.push({
        subCheck: 'U2.D1',
        subCheckLabel: 'Missing navigation landmark',
        classification: 'potential',
        elementLabel: 'Application routing',
        elementType: 'navigation',
        filePath: routeFiles[0] || 'Unknown',
        detection: `${routeCount} routes without visible navigation UI`,
        evidence: `Routes in: ${routeFiles.slice(0, 3).join(', ')}${routeFiles.length > 3 ? ` (+${routeFiles.length - 3} more)` : ''}. No rendered nav components (Sidebar, Navbar, Header, Tabs) or navItems mapping found.`,
        explanation: `The app defines ${routeCount} routes but no visible navigation UI was detected. Users may lack a way to discover available sections.`,
        confidence: conf,
        advisoryGuidance: 'Add a visible navigation component (sidebar, navbar, tabs, or menu) that exposes the main routes.',
        deduplicationKey: dedupeKey,
      });
    }
  }

  // ===== U2.D2 — Deep/nested pages without persistent "you are here" cues =====
  // Trigger: deep routes exist AND missing ALL wayfinding cues (including route-page headings)
  if (deepRouteFiles.length > 0) {
    const hasAnyCue = hasActiveNavHighlight || hasPageHeadingInLayout || hasPageHeadingInRoutePages || hasBreadcrumbRendered || hasBackControl || hasParentRouteLink;
    if (!hasAnyCue) {
      const dedupeKey = 'U2.D2|global';
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        const missingCues: string[] = [];
        if (!hasActiveNavHighlight) missingCues.push('no active nav highlight (aria-current/NavLink/isActive)');
        if (!hasPageHeadingInLayout && !hasPageHeadingInRoutePages) missingCues.push('no page heading (<h1>) in layout or route pages');
        if (!hasBreadcrumbRendered) missingCues.push('no breadcrumb');
        if (!hasBackControl) missingCues.push('no back button');
        // If route pages have headings but layout doesn't, reduce confidence significantly
        let conf: number;
        if (hasPageHeadingInRoutePages && !hasPageHeadingInLayout) {
          // Route pages provide headings — layout-only concern, very low confidence
          conf = 0.55;
        } else {
          conf = Math.min(0.65 + (missingCues.length > 3 ? 0.10 : 0.05), 0.80);
        }
        // Layout-scoped detection text — never claim "no page title" without verification
        const layoutFile = deepRouteFiles.find(f => /layout/i.test(f)) || deepRouteFiles[0];
        const isLayoutTriggered = /layout/i.test(layoutFile);
        const detectionText = isLayoutTriggered
          ? `Layout does not include breadcrumb structure or a persistent location indicator. Page-level headings were evaluated separately in route pages.`
          : `Detail/nested views lack persistent wayfinding cues in the layout layer`;
        const explanationText = isLayoutTriggered
          ? `The layout component does not provide persistent wayfinding cues (breadcrumb, active highlight). ${hasPageHeadingInRoutePages ? 'Route pages include <h1> headings, but the layout itself lacks location indicators.' : 'Route pages were scanned but no <h1> headings were found.'}`
          : 'Deep/nested pages exist but lack persistent wayfinding cues (active highlight, heading, breadcrumb) in the layout. Users may not know where they are.';
        findings.push({
          subCheck: 'U2.D2',
          subCheckLabel: 'Deep pages without "you are here" cues',
          classification: 'potential',
          elementLabel: 'Deep route navigation',
          elementType: 'navigation',
          filePath: layoutFile,
          detection: detectionText,
          evidence: `Deep routes: ${deepRouteFiles.slice(0, 3).join(', ')}. Missing: ${missingCues.join('; ')}.${hasPageHeadingInRoutePages ? ' Note: route pages DO contain <h1> headings.' : ''}`,
          explanation: explanationText,
          confidence: conf,
          advisoryGuidance: hasPageHeadingInRoutePages
            ? 'Optional: add breadcrumbs for deep navigation, but current pages already expose headings.'
            : 'Add at least one persistent "you are here" cue: active nav highlight, page heading matching context, or breadcrumb trail.',
          deduplicationKey: dedupeKey,
        });
      }
    }
  }

  // ===== U2.D3 — Breadcrumb depth risk (evidence-gated, project-agnostic) =====
  // Only emits when BOTH: (1) breadcrumb cap-depth pattern detected, AND (2) multi-channel evidence of deeper hierarchy (≥3 segments)
  {
    const d3Result = detectBreadcrumbDepthRisk(allFiles, breadcrumbLogicFiles, hasBreadcrumbLogicDefined, hasBreadcrumbComponentInDesignSystem, hasBreadcrumbRendered, hasActiveNavHighlight, hasPageHeadingInLayout);
    if (d3Result) {
      const dedupeKey = 'U2.D3|global';
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        findings.push({ ...d3Result, deduplicationKey: dedupeKey });
      }
    }
  }

  console.log(`[U2] Detection: routes=${routeCount}, navComp=${hasNavComponentRendered}, navMapping=${hasNavItemsMapping}, layoutNav=${hasLayoutWithNav}, breadcrumb=${hasBreadcrumbRendered}, back=${hasBackControl}, deep=${deepRouteFiles.length}, maxDepth=${maxRouteDepth}, navPrimitives=${navPrimitiveCount}(${[...navPrimitivesFound].join(',')}), activeHighlight=${hasActiveNavHighlight}, pageHeadingLayout=${hasPageHeadingInLayout}, pageHeadingRoutes=${hasPageHeadingInRoutePages}, mobileOnly=${hasMobileOnlyNavToggle}, desktopHidden=${hasDesktopNavHidden}, findings=${findings.length}`);

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

function isValidHexColor(hex: string | null | undefined): hex is string {
  return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex);
}

// Alpha-composite a foreground color over a background color
function alphaComposite(fgHex: string, bgHex: string, alpha: number): string | null {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) return null;
  const r = Math.round(fg.r * alpha + bg.r * (1 - alpha));
  const g = Math.round(fg.g * alpha + bg.g * (1 - alpha));
  const b = Math.round(fg.b * alpha + bg.b * (1 - alpha));
  return '#' + [r, g, b].map(c => Math.min(255, c).toString(16).padStart(2, '0')).join('');
}

// Known Tailwind variant prefixes (state/responsive/pseudo)
const VARIANT_PREFIXES = new Set([
  'hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited',
  'disabled', 'dark', 'group-hover', 'group-focus', 'peer-hover', 'peer-focus',
  'first', 'last', 'odd', 'even', 'placeholder', 'selection', 'marker',
  'before', 'after', 'sm', 'md', 'lg', 'xl', '2xl',
]);

// ========== A1 TAILWIND-TOKEN + INLINE-STYLE CONTRAST COMPUTATION ==========
// Extracts text-*/bg-* Tailwind tokens AND inline style colors, traverses
// parent elements for background resolution, computes actual WCAG contrast
// ratio when both fg and bg are resolvable. Epistemic flags track source reliability.

type A1FgSource = 'tailwind_token' | 'inline_style';
type A1BgSource = 'tailwind_token' | 'inline_style' | 'unresolved';
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
  fgHex: string | null;
  fgClass: string;
  fgSource: A1FgSource;
  bgHex: string | null;
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
  variant?: string; // 'hover', 'focus', 'active', 'dark', etc. — undefined = base state
  variantName?: string; // CVA variant branch, e.g. default/destructive
  alpha?: number; // 0-1 opacity from Tailwind /N syntax
  lineNumber?: number; // approximate line number
  startLine?: number | null;
  endLine?: number | null;
  extractedClasses?: string;
  fgResolved: boolean;
  bgResolved: boolean;
  bgUnresolvedReason?: string;
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

function extractTextColorTokens(code: string): Array<{ colorClass: string; colorName: string; context: string; matchIndex: number; jsxTag?: string; variant?: string; alpha?: number }> {
  const results: Array<{ colorClass: string; colorName: string; context: string; matchIndex: number; jsxTag?: string; variant?: string; alpha?: number }> = [];
  // Match text-color tokens with optional alpha suffix (/80)
  const textColorRegex = new RegExp(`text-(${TW_COLOR_FAMILIES})-?(\\d{2,3})?(?:/(\\d{1,3}))?`, 'g');
  
  let match;
  while ((match = textColorRegex.exec(code)) !== null) {
    const colorClass = match[0];
    const colorName = match[1] + (match[2] ? `-${match[2]}` : '');
    const alphaRaw = match[3] ? parseInt(match[3]) : undefined;
    const alpha = alphaRaw !== undefined ? alphaRaw / 100 : undefined;
    
    // Detect variant prefix: check if preceded by ":"
    let variant: string | undefined;
    if (match.index > 0 && code[match.index - 1] === ':') {
      let vEnd = match.index - 1;
      let vStart = vEnd - 1;
      while (vStart >= 0 && /[\w-]/.test(code[vStart])) vStart--;
      vStart++;
      const variantName = code.slice(vStart, vEnd);
      if (variantName && VARIANT_PREFIXES.has(variantName)) {
        variant = variantName;
      }
    }
    
    const start = Math.max(0, match.index - 100);
    const end = Math.min(code.length, match.index + colorClass.length + 100);
    const context = code.slice(start, end).replace(/\n/g, ' ').trim();
    const jsxTag = extractJsxTag(code, match.index);
    results.push({ colorClass, colorName, context, matchIndex: match.index, jsxTag, variant, alpha });
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

// Extract bg-* from a className string (base state only — skips variant-prefixed tokens)
function extractBgFromClasses(classes: string): { bgClass: string; bgName: string } | null {
  const bgRegex = new RegExp(`^bg-(${TW_COLOR_FAMILIES})-?(\\d{2,3})?(?:/(\\d{1,3}))?$`);
  const tokens = classes.split(/\s+/);
  for (const token of tokens) {
    // Skip variant-prefixed tokens (e.g., hover:bg-blue-500, dark:bg-gray-900)
    if (token.includes(':')) continue;
    const m = token.match(bgRegex);
    if (m) return { bgClass: m[0], bgName: m[1] + (m[2] ? `-${m[2]}` : '') };
  }
  return null;
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

// Resolve background for a text element: self → ancestor → unresolved
// Also checks inline style colors on self and ancestors.
function resolveBackground(code: string, textMatchIndex: number): { bgClass: string | null; bgName: string | null; bgSourceType: 'self' | 'ancestor' | 'unresolved'; inlineBgHex?: string } {
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

  // Critical: unresolved stays unresolved (never assume white)
  return { bgClass: null, bgName: null, bgSourceType: 'unresolved' };
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
  foreground?: { value: string | null; resolved: boolean };
  background?: { value: string | null; resolved: boolean; reason?: string };
  note?: string;
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
  variant?: string; // interaction state (hover/focus/active/dark)
  variantName?: string; // branch/variant id (default/destructive/...)
  lineNumber?: number;
  startLine?: number | null;
  endLine?: number | null;
  extractedClasses?: string;
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

    const lucideIcons = extractLucideImports(content);

    // Pre-compute line offsets for approximate line number reporting
    const lineOffsets: number[] = [0];
    for (let ci = 0; ci < content.length; ci++) {
      if (content[ci] === '\n') lineOffsets.push(ci + 1);
    }
    const getLineNumber = (idx: number): number => {
      let lo = 0;
      let hi = lineOffsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineOffsets[mid] <= idx) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    };

    // ============================================================
    // CVA / variant-driven design-system components (suppression-safe)
    // ============================================================
    const isDesignSystemComponent = /src\/components\/ui\/.+\.(tsx|jsx)$/i.test(filepath);
    const cvaConfig = isDesignSystemComponent ? extractCvaVariantConfigRegex(content) : null;

    if (isDesignSystemComponent && cvaConfig) {
      let hasResolvedVariantPair = false;

      for (const [variantName, variantClasses] of Object.entries(cvaConfig.variantClassMap)) {
        const textTokens = extractTextColorTokens(variantClasses).filter(t => !t.variant);
        const fgToken = textTokens[0];
        const bgToken = extractBgFromClasses(variantClasses);

        const fgHex = fgToken ? (TAILWIND_COLORS[fgToken.colorName] || null) : null;
        const bgHex = bgToken ? (TAILWIND_COLORS[bgToken.bgName] || null) : null;

        const fgResolved = isValidHexColor(fgHex);
        const bgResolved = isValidHexColor(bgHex);

        if (!fgResolved || !bgResolved) {
          continue;
        }

        hasResolvedVariantPair = true;

        const sizeStatus = inferTextSize(variantClasses);
        const textType: 'normal' | 'large' = sizeStatus === 'large' ? 'large' : 'normal';
        const threshold: 4.5 | 3.0 = textType === 'large' ? 3.0 : 4.5;
        const ratio = getContrastRatio(fgHex, bgHex);

        if (ratio === null || ratio >= threshold) {
          continue;
        }

        const variantIdx = content.indexOf(variantClasses);
        const line = variantIdx >= 0 ? getLineNumber(variantIdx) : undefined;

        a1Findings.push({
          fgHex,
          fgClass: fgToken?.colorClass || 'text-*',
          fgSource: 'tailwind_token',
          bgHex,
          bgClass: bgToken?.bgClass || null,
          bgSource: 'tailwind_token',
          ratio,
          threshold,
          sizeStatus,
          evidenceLevel: 'structural_deterministic',
          filePath: filepath,
          componentName: componentName || undefined,
          elementContext: inferElementContext(variantClasses) || undefined,
          context: variantClasses,
          occurrence_count: 1,
          textType,
          appliedThreshold: threshold,
          wcagCriterion: '1.4.3',
          variantName,
          lineNumber: line,
          startLine: line ?? null,
          endLine: line ?? null,
          extractedClasses: variantClasses,
          fgResolved: true,
          bgResolved: true,
        });
      }

      if (!hasResolvedVariantPair) {
        console.log(`[A1] suppressed: unresolved component styles (${filepath})`);
      }

      // Important: for CVA-driven primitives, avoid generic token-level heuristics.
      // We only trust resolved per-variant fg+bg pairs.
      continue;
    }

    const pushFinding = (finding: A1TokenFinding) => {
      a1Findings.push(finding);
    };

    const textTokens = extractTextColorTokens(content);

    // ===== BASE STATE PASS =====
    for (const { colorClass, colorName, context, matchIndex, jsxTag, variant, alpha } of textTokens) {
      if (variant) continue;

      const fgHexRaw = TAILWIND_COLORS[colorName] || null;
      if (!fgHexRaw) continue;
      if (!isTextElement(jsxTag, lucideIcons)) continue;

      // --- Ternary-context detection ---
      // If the text token is inside a ternary expression (? "..." : "..."),
      // bg resolution from self/ancestor is unreliable (cross-branch contamination).
      const ternaryWindow = content.slice(Math.max(0, matchIndex - 200), Math.min(content.length, matchIndex + 200));
      const isInsideTernary = /\?\s*["'`][^"'`]*$/.test(content.slice(Math.max(0, matchIndex - 200), matchIndex)) ||
        /\?\s*["'`]/.test(ternaryWindow) && /:\s*["'`]/.test(ternaryWindow);

      let bgHex: string | null = null;
      let bgClass: string | null = null;
      let bgSource: A1BgSource = 'unresolved';

      if (!isInsideTernary) {
        const resolved = resolveBackground(content, matchIndex);
        if (resolved.inlineBgHex) {
          bgHex = resolved.inlineBgHex;
          bgSource = 'inline_style';
        } else if (resolved.bgName && TAILWIND_COLORS[resolved.bgName]) {
          bgHex = TAILWIND_COLORS[resolved.bgName];
          bgClass = resolved.bgClass;
          bgSource = 'tailwind_token';
        }
      } else {
        console.log(`[A1] ternary-context detected for ${colorClass} at index ${matchIndex} in ${filepath} — bg resolution skipped`);
      }

      const sizeStatus = inferTextSize(context);
      const textType: 'normal' | 'large' = sizeStatus === 'large' ? 'large' : 'normal';
      const threshold: 4.5 | 3.0 = textType === 'large' ? 3.0 : 4.5;

      let effectiveFgHex: string | null = fgHexRaw;
      if (alpha !== undefined && alpha < 1 && isValidHexColor(fgHexRaw) && isValidHexColor(bgHex)) {
        const composited = alphaComposite(fgHexRaw, bgHex, alpha);
        effectiveFgHex = composited ?? null;
      }

      const fgResolved = isValidHexColor(effectiveFgHex);
      const bgResolved = isValidHexColor(bgHex) && bgSource !== 'unresolved';
      const ratio = (fgResolved && bgResolved)
        ? getContrastRatio(effectiveFgHex, bgHex)
        : null;

      // --- Same-color guard ---
      // If fg and bg resolve to the exact same hex (e.g., #ffffff vs #ffffff → 1.0:1),
      // this is almost certainly a cross-branch resolution error, not a real violation.
      if (ratio !== null && effectiveFgHex && bgHex &&
          effectiveFgHex.toLowerCase() === bgHex.toLowerCase()) {
        console.log(`[A1] same-color guard: skipping ${colorClass} (${effectiveFgHex}) === bg (${bgHex}) in ${filepath}`);
        continue;
      }

      if (ratio !== null && ratio >= threshold) continue;

      const containingTag = findContainingTagClasses(content, matchIndex);
      const extractedClasses = containingTag?.classes || '';
      const unresolvedReason = !bgResolved ? 'variant/context-dependent' : undefined;

      pushFinding({
        fgHex: fgResolved ? effectiveFgHex : null,
        fgClass: alpha !== undefined ? `${colorClass}/${Math.round(alpha * 100)}` : colorClass,
        fgSource: 'tailwind_token',
        bgHex: bgResolved ? bgHex : null,
        bgClass,
        bgSource: bgResolved ? bgSource : 'unresolved',
        ratio,
        threshold,
        sizeStatus,
        evidenceLevel: bgResolved ? 'structural_deterministic' : 'structural_estimated',
        filePath: filepath,
        componentName: componentName || undefined,
        elementContext: inferElementContext(context) || undefined,
        jsxTag,
        context,
        occurrence_count: 1,
        textType,
        appliedThreshold: threshold,
        wcagCriterion: '1.4.3',
        lineNumber: getLineNumber(matchIndex),
        startLine: getLineNumber(matchIndex),
        endLine: getLineNumber(matchIndex),
        extractedClasses,
        fgResolved,
        bgResolved,
        bgUnresolvedReason: unresolvedReason,
      });
    }

    // ===== VARIANT STATE PASS =====
    for (const { colorClass, colorName, context, matchIndex, jsxTag, variant, alpha } of textTokens) {
      if (!variant) continue;
      if (!['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'dark'].includes(variant)) continue;

      const fgHexRaw = TAILWIND_COLORS[colorName] || null;
      if (!fgHexRaw) continue;
      if (!isTextElement(jsxTag, lucideIcons)) continue;

      // --- Ternary-context detection (same as base pass) ---
      const ternaryWindowV = content.slice(Math.max(0, matchIndex - 200), Math.min(content.length, matchIndex + 200));
      const isInsideTernaryV = /\?\s*["'`][^"'`]*$/.test(content.slice(Math.max(0, matchIndex - 200), matchIndex)) ||
        /\?\s*["'`]/.test(ternaryWindowV) && /:\s*["'`]/.test(ternaryWindowV);

      let bgHex: string | null = null;
      let bgClass: string | null = null;
      let bgSource: A1BgSource = 'unresolved';

      if (!isInsideTernaryV) {
        const resolved = resolveBackground(content, matchIndex);
        if (resolved.inlineBgHex) {
          bgHex = resolved.inlineBgHex;
          bgSource = 'inline_style';
        } else if (resolved.bgName && TAILWIND_COLORS[resolved.bgName]) {
          bgHex = TAILWIND_COLORS[resolved.bgName];
          bgClass = resolved.bgClass;
          bgSource = 'tailwind_token';
        }
      }

      const sizeStatus = inferTextSize(context);
      const textType: 'normal' | 'large' = sizeStatus === 'large' ? 'large' : 'normal';
      const threshold: 4.5 | 3.0 = textType === 'large' ? 3.0 : 4.5;

      let effectiveFgHex: string | null = fgHexRaw;
      if (alpha !== undefined && alpha < 1 && isValidHexColor(fgHexRaw) && isValidHexColor(bgHex)) {
        const composited = alphaComposite(fgHexRaw, bgHex, alpha);
        effectiveFgHex = composited ?? null;
      }

      const fgResolved = isValidHexColor(effectiveFgHex);
      const bgResolved = isValidHexColor(bgHex) && bgSource !== 'unresolved';
      const ratio = (fgResolved && bgResolved)
        ? getContrastRatio(effectiveFgHex, bgHex)
        : null;

      // --- Same-color guard (variant pass) ---
      if (ratio !== null && effectiveFgHex && bgHex &&
          effectiveFgHex.toLowerCase() === bgHex.toLowerCase()) {
        continue;
      }

      if (ratio !== null && ratio >= threshold) continue;

      const containingTag = findContainingTagClasses(content, matchIndex);
      const extractedClasses = containingTag?.classes || '';
      const unresolvedReason = !bgResolved ? 'variant/context-dependent' : undefined;
      const line = getLineNumber(matchIndex);

      pushFinding({
        fgHex: fgResolved ? effectiveFgHex : null,
        fgClass: `${variant}:${colorClass}`,
        fgSource: 'tailwind_token',
        bgHex: bgResolved ? bgHex : null,
        bgClass,
        bgSource: bgResolved ? bgSource : 'unresolved',
        ratio,
        threshold,
        sizeStatus,
        evidenceLevel: bgResolved ? 'structural_deterministic' : 'structural_estimated',
        filePath: filepath,
        componentName: componentName || undefined,
        elementContext: inferElementContext(context) || undefined,
        jsxTag,
        context,
        occurrence_count: 1,
        textType,
        appliedThreshold: threshold,
        wcagCriterion: '1.4.3',
        variant,
        variantName: variant,
        lineNumber: line,
        startLine: line,
        endLine: line,
        extractedClasses,
        fgResolved,
        bgResolved,
        bgUnresolvedReason: unresolvedReason,
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

      const fgHexRaw = inlineColors.fg;
      let bgHex: string | null = null;
      let bgSource: A1BgSource = 'unresolved';

      if (inlineColors.bg) {
        bgHex = inlineColors.bg;
        bgSource = 'inline_style';
      } else {
        const resolved = resolveBackground(content, styleMatch.index);
        if (resolved.inlineBgHex) {
          bgHex = resolved.inlineBgHex;
          bgSource = 'inline_style';
        } else if (resolved.bgName && TAILWIND_COLORS[resolved.bgName]) {
          bgHex = TAILWIND_COLORS[resolved.bgName];
          bgSource = 'tailwind_token';
        }
      }

      const ctxStart = Math.max(0, styleMatch.index - 100);
      const ctxEnd = Math.min(content.length, styleMatch.index + 200);
      const context = content.slice(ctxStart, ctxEnd).replace(/\n/g, ' ').trim();
      const sizeStatus = inferTextSize(context);
      const textType: 'normal' | 'large' = sizeStatus === 'large' ? 'large' : 'normal';
      const threshold: 4.5 | 3.0 = textType === 'large' ? 3.0 : 4.5;

      const fgResolved = isValidHexColor(fgHexRaw);
      const bgResolved = isValidHexColor(bgHex) && bgSource !== 'unresolved';
      const ratio = (fgResolved && bgResolved) ? getContrastRatio(fgHexRaw, bgHex) : null;

      if (ratio !== null && ratio >= threshold) continue;

      const line = getLineNumber(styleMatch.index);
      pushFinding({
        fgHex: fgResolved ? fgHexRaw : null,
        fgClass: `style:color(${fgHexRaw})`,
        fgSource: 'inline_style',
        bgHex: bgResolved ? bgHex : null,
        bgClass: null,
        bgSource: bgResolved ? bgSource : 'unresolved',
        ratio,
        threshold,
        sizeStatus,
        evidenceLevel: bgResolved ? 'structural_deterministic' : 'structural_estimated',
        filePath: filepath,
        componentName: componentName || undefined,
        elementContext: inferElementContext(context) || undefined,
        jsxTag,
        context,
        occurrence_count: 1,
        textType,
        appliedThreshold: threshold,
        wcagCriterion: '1.4.3',
        lineNumber: line,
        startLine: line,
        endLine: line,
        extractedClasses: containingTag.classes || '',
        fgResolved,
        bgResolved,
        bgUnresolvedReason: !bgResolved ? 'variant/context-dependent' : undefined,
      });
    }

    // ===== PASS 3: HTML style strings =====
    const htmlStyleRegex = /style\s*=\s*"([^"]+)"/g;
    let htmlMatch;
    while ((htmlMatch = htmlStyleRegex.exec(content)) !== null) {
      const styleStr = htmlMatch[1];
      const colorM = styleStr.match(/(?:^|;)\s*color\s*:\s*([^;]+)/);
      if (!colorM) continue;

      const fgHexRaw = parseCssColor(colorM[1]);
      if (!fgHexRaw) continue;

      const containingTag = findContainingTagClasses(content, htmlMatch.index);
      if (!containingTag) continue;
      const jsxTag = containingTag.tagName;
      if (!isTextElement(jsxTag, lucideIcons)) continue;

      let bgHex: string | null = null;
      let bgSource: A1BgSource = 'unresolved';

      const bgColorM = styleStr.match(/background-color\s*:\s*([^;]+)/);
      if (bgColorM) {
        const parsed = parseCssColor(bgColorM[1]);
        if (parsed) {
          bgHex = parsed;
          bgSource = 'inline_style';
        }
      } else {
        const resolved = resolveBackground(content, htmlMatch.index);
        if (resolved.inlineBgHex) {
          bgHex = resolved.inlineBgHex;
          bgSource = 'inline_style';
        } else if (resolved.bgName && TAILWIND_COLORS[resolved.bgName]) {
          bgHex = TAILWIND_COLORS[resolved.bgName];
          bgSource = 'tailwind_token';
        }
      }

      const ctxStart = Math.max(0, htmlMatch.index - 100);
      const ctxEnd = Math.min(content.length, htmlMatch.index + 200);
      const context = content.slice(ctxStart, ctxEnd).replace(/\n/g, ' ').trim();
      const sizeStatus = inferTextSize(context);
      const textType: 'normal' | 'large' = sizeStatus === 'large' ? 'large' : 'normal';
      const threshold: 4.5 | 3.0 = textType === 'large' ? 3.0 : 4.5;

      const fgResolved = isValidHexColor(fgHexRaw);
      const bgResolved = isValidHexColor(bgHex) && bgSource !== 'unresolved';
      const ratio = (fgResolved && bgResolved) ? getContrastRatio(fgHexRaw, bgHex) : null;

      if (ratio !== null && ratio >= threshold) continue;

      const line = getLineNumber(htmlMatch.index);
      pushFinding({
        fgHex: fgResolved ? fgHexRaw : null,
        fgClass: `style:color(${fgHexRaw})`,
        fgSource: 'inline_style',
        bgHex: bgResolved ? bgHex : null,
        bgClass: null,
        bgSource: bgResolved ? bgSource : 'unresolved',
        ratio,
        threshold,
        sizeStatus,
        evidenceLevel: bgResolved ? 'structural_deterministic' : 'structural_estimated',
        filePath: filepath,
        componentName: componentName || undefined,
        elementContext: inferElementContext(context) || undefined,
        jsxTag,
        context,
        occurrence_count: 1,
        textType,
        appliedThreshold: threshold,
        wcagCriterion: '1.4.3',
        lineNumber: line,
        startLine: line,
        endLine: line,
        extractedClasses: containingTag.classes || '',
        fgResolved,
        bgResolved,
        bgUnresolvedReason: !bgResolved ? 'variant/context-dependent' : undefined,
      });
    }
  }

  if (a1Findings.length === 0) return [];

  const dedupeMap = new Map<string, A1TokenFinding>();
  for (const finding of a1Findings) {
    const key = [
      finding.fgClass,
      finding.bgSource,
      finding.bgHex || 'unresolved',
      finding.filePath,
      finding.variant || 'base',
      finding.variantName || 'none',
      finding.lineNumber || 0,
    ].join('|');

    if (dedupeMap.has(key)) {
      dedupeMap.get(key)!.occurrence_count += 1;
    } else {
      dedupeMap.set(key, { ...finding });
    }
  }

  // === A1.1 risk-signal gate for Potential findings ===
  // Only emit a Potential finding from analyzeContrastInCode if there is a concrete
  // contrast-risk signal (theme token, opacity, CSS variable) in the element's classes.
  // Mere "background unresolved" without a risk signal is NOT enough.
  const A1_RISK_SIGNAL_PATTERNS = [
    /\btext-muted\b/, /\btext-muted-foreground\b/, /\btext-foreground\b/,
    /\btext-primary\b/, /\btext-secondary\b/, /\btext-accent\b/,
    /\btext-popover-foreground\b/, /\btext-card-foreground\b/,
    /\bopacity-(?:50|60|70)\b/, /\btext-opacity-\d+\b/,
    /var\(--[\w-]*(?:foreground|muted|background|primary|secondary|accent)[\w-]*\)/,
    /hsl\(var\(--[\w-]+\)\)/,
  ];

  function hasRiskSignal(classes: string, fgClass: string): boolean {
    const combined = `${classes} ${fgClass}`;
    return A1_RISK_SIGNAL_PATTERNS.some(p => p.test(combined));
  }

  const results: ContrastViolation[] = [];

  for (const finding of dedupeMap.values()) {
    const fileName = finding.filePath.split('/').pop() || finding.filePath;
    const elementIdentifier = finding.componentName
      ? `${finding.componentName} (${fileName})`
      : fileName;

    const fgResolved = finding.fgResolved && isValidHexColor(finding.fgHex);
    const bgResolved = finding.bgResolved && isValidHexColor(finding.bgHex);
    const fontResolved = finding.sizeStatus !== 'unknown';
    const canCompute = fgResolved && bgResolved && finding.ratio !== null;

    // A1 Confirmed requires ALL prerequisites: fg + bg + font size + ratio
    const isConfirmed = canCompute && fontResolved && finding.ratio! < finding.threshold;
    const status: 'confirmed' | 'potential' = isConfirmed ? 'confirmed' : 'potential';

    console.log(`[A1] prereq: fgResolved=${fgResolved} bgResolved=${bgResolved} fontResolved=${fontResolved} ratioComputed=${finding.ratio !== null} → ${status} (${finding.fgClass} in ${finding.filePath})`);

    // === GATE: skip noisy potential findings with no risk signal ===
    if (!isConfirmed && !canCompute) {
      const riskFound = hasRiskSignal(finding.extractedClasses || '', finding.fgClass);
      if (!riskFound) {
        // No concrete risk token → skip this finding (A1.3 handles theme/opacity separately)
        continue;
      }
    }

    const reasonCodes: string[] = ['STATIC_ANALYSIS'];
    if (!bgResolved) reasonCodes.push('BG_UNRESOLVED');
    if (finding.sizeStatus === 'unknown') reasonCodes.push('SIZE_UNKNOWN');

    let riskLevel: 'high' | 'medium' | 'low' = 'low';
    if (canCompute) {
      if (finding.ratio! < 2.5) riskLevel = 'high';
      else if (finding.ratio! < 3.5) riskLevel = 'medium';
      else riskLevel = 'low';
    }

    const ratioStr = canCompute
      ? `${finding.ratio!.toFixed(2)}:1`
      : 'Not computed (requires rendered colors)';

    const bgDisplay = bgResolved && finding.bgHex ? finding.bgHex : 'theme/variable-dependent';
    const fgDisplay = fgResolved && finding.fgHex ? finding.fgHex : 'theme/variable/opacity-dependent';

    const variantLabel = finding.variant ? ` [${finding.variant} state]` : '';
    const branchLabel = finding.variantName ? ` [variant=${finding.variantName}]` : '';
    const diagnosis = canCompute
      ? `Text ${finding.fgClass} (${fgDisplay}) on ${bgDisplay}${variantLabel}${branchLabel} — contrast ratio ${ratioStr} vs ${finding.threshold}:1 required (${finding.sizeStatus === 'large' ? 'large' : 'normal'} text).`
      : `Text ${finding.fgClass} (${fgDisplay}) on ${bgDisplay}${variantLabel}${branchLabel} — contrast not computed (theme/variable-dependent colors).`;

    let correctivePrompt = '';
    if (isConfirmed) {
      correctivePrompt = `• ${finding.elementContext || 'Text element'} "${finding.fgClass}" in ${elementIdentifier}\n` +
        `  Issue: ${ratioStr} vs ${finding.threshold}:1 required\n` +
        `  Fix: Replace ${finding.fgClass} with a darker token or adjust background ${finding.bgClass || bgDisplay} to ensure ≥ ${finding.threshold}:1.`;
    }

    const advisoryGuidance = isConfirmed
      ? undefined
      : !canCompute
        ? 'Theme-dependent or opacity-reduced colors cannot be verified statically. Provide a rendered screenshot or enable runtime contrast sampling to compute effective contrast.'
        : `Verify contrast in browser DevTools. Computed ratio: ${ratioStr}.`;

    results.push({
      ruleId: 'A1',
      ruleName: 'Insufficient text contrast',
      category: 'accessibility',
      status,
      samplingMethod: 'inferred',
      inputType: 'zip',
      contrastRatio: canCompute ? (finding.ratio ?? undefined) : undefined,
      thresholdUsed: finding.threshold,
      foregroundHex: fgResolved ? (finding.fgHex ?? undefined) : undefined,
      backgroundHex: bgResolved ? (finding.bgHex ?? undefined) : undefined,
      foreground: { value: fgResolved ? finding.fgHex : null, resolved: fgResolved },
      background: {
        value: bgResolved ? finding.bgHex : null,
        resolved: bgResolved,
        reason: bgResolved ? undefined : (finding.bgUnresolvedReason || 'theme/variable-dependent'),
      },
      note: !canCompute ? 'contrast not computed (theme/variable-dependent colors)' : undefined,
      elementIdentifier,
      elementDescription: finding.elementContext,
      evidence: `${finding.fgClass}${fgResolved && finding.fgHex ? ` (${finding.fgHex})` : ''}${finding.bgClass ? ` on ${finding.bgClass}${bgResolved && finding.bgHex ? ` (${finding.bgHex})` : ''}` : ''} in ${finding.filePath}${finding.startLine ? `:${finding.startLine}` : ''}${finding.variantName ? ` [variant=${finding.variantName}]` : ''}`,
      diagnosis,
      contextualHint: canCompute
        ? `Contrast ${ratioStr} — ${finding.evidenceLevel.replace(/_/g, ' ')}.`
        : 'Contrast not computed — theme/variable-dependent colors.',
      correctivePrompt,
      confidence: isConfirmed ? 0.9 : (!bgResolved ? 0.4 : 0.55),
      riskLevel,
      reasonCodes: isConfirmed ? undefined : reasonCodes,
      potentialRiskReason: isConfirmed ? undefined : (!canCompute ? 'theme/variable-dependent colors' : `computed ratio ${ratioStr}`),
      backgroundStatus: bgResolved ? 'certain' : 'uncertain',
      blocksConvergence: isConfirmed,
      inputLimitation: !canCompute ? 'Theme/variable-dependent colors; static analysis cannot compute effective contrast ratio.' : undefined,
      advisoryGuidance,
      fgSource: finding.fgSource,
      bgSource: bgResolved ? finding.bgSource : 'unresolved',
      evidenceLevel: finding.evidenceLevel,
      sizeStatus: finding.sizeStatus,
      variant: finding.variant,
      variantName: finding.variantName,
      lineNumber: finding.lineNumber,
      startLine: finding.startLine ?? finding.lineNumber ?? null,
      endLine: finding.endLine ?? finding.lineNumber ?? null,
      extractedClasses: finding.extractedClasses,
      affectedComponents: [{
        colorClass: finding.fgClass,
        hexColor: finding.fgHex ?? undefined,
        filePath: finding.filePath,
        componentName: finding.componentName,
        elementContext: finding.elementContext,
        riskLevel,
        occurrence_count: finding.occurrence_count,
      }],
    });
  }

  const confirmed = results.filter(r => r.status === 'confirmed').length;
  const potential = results.filter(r => r.status === 'potential').length;
  console.log(`A1 token-contrast (ZIP): ${results.length} findings (${confirmed} confirmed, ${potential} potential, ${a1Findings.length - dedupeMap.size} pre-deduped, ${dedupeMap.size - results.length} gated-out)`);

  return results;
}

// ========== A1.3 — Theme-Dependent or Opacity-Reduced Text (Potential Only) ==========
// Detects text using CSS-variable-based colors (text-muted, text-foreground, var(--...))
// or opacity-reduced patterns where contrast ratio cannot be statically computed.

const A1_3_THEME_CLASS_PATTERNS = [
  /\btext-muted\b/,
  /\btext-muted-foreground\b/,
  /\btext-foreground\b/,
  /\btext-primary\b/,
  /\btext-secondary\b/,
  /\btext-accent\b/,
  /\btext-popover-foreground\b/,
  /\btext-card-foreground\b/,
];

const A1_3_OPACITY_PATTERNS = [
  /\bopacity-(?:50|60|70)\b/,
  /\btext-opacity-\d+\b/,
  /\btext-(?:gray|slate|zinc|neutral|stone)-\d{2,3}\s[^"'`]*?opacity-(?:50|60|70)\b/,
];

const A1_3_CSS_VAR_PATTERN = /(?:color|--[\w-]+)\s*:\s*(?:var\(--[\w-]*(?:foreground|muted|primary|secondary|accent)[\w-]*\)|hsl\(var\(--[\w-]+\)\))/;

// Suppression patterns
const A1_3_SUPPRESS_DISABLED = /\bdisabled\b/;
const A1_3_SUPPRESS_ARIA_HIDDEN = /aria-hidden\s*=\s*["']true["']/;
const A1_3_SUPPRESS_PLACEHOLDER = /\bplaceholder\b/;

function detectA1ThemeDependentText(files: Map<string, string>): ContrastViolation[] {
  const findings: ContrastViolation[] = [];
  const seen = new Set<string>();

  for (const [filepath, content] of files) {
    // Skip non-component files
    if (!/\.(tsx|jsx)$/i.test(filepath)) continue;

    let componentName = filepath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    const lucideIcons = extractLucideImports(content);

    // Pre-compute line offsets
    const lineOffsets: number[] = [0];
    for (let ci = 0; ci < content.length; ci++) {
      if (content[ci] === '\n') lineOffsets.push(ci + 1);
    }
    const getLineNumber = (idx: number): number => {
      let lo = 0, hi = lineOffsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineOffsets[mid] <= idx) lo = mid; else hi = mid - 1;
      }
      return lo + 1;
    };

    // Scan all JSX opening tags
    const tagRegex = /<([A-Za-z][A-Za-z0-9_.]*)\s+[^>]*(?:className|style)[^>]*>/g;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(content)) !== null) {
      const tagContent = tagMatch[0];
      const tagName = tagMatch[1];

      // Check if this is a text-bearing element
      if (!isTextElement(tagName, lucideIcons)) continue;

      // === Suppression checks ===
      if (A1_3_SUPPRESS_ARIA_HIDDEN.test(tagContent)) continue;
      if (A1_3_SUPPRESS_DISABLED.test(tagContent)) continue;

      // Check surrounding context for placeholder (input placeholder styling)
      const ctxStart = Math.max(0, tagMatch.index - 40);
      const ctxEnd = Math.min(content.length, tagMatch.index + tagContent.length + 40);
      const surroundingCtx = content.slice(ctxStart, ctxEnd);
      if (A1_3_SUPPRESS_PLACEHOLDER.test(tagContent) && /input|textarea/i.test(tagName)) continue;

      // Check for icon-only elements (no text children)
      const afterTag = content.slice(tagMatch.index + tagContent.length, tagMatch.index + tagContent.length + 80);
      const selfClosing = tagContent.endsWith('/>');
      if (selfClosing) {
        // Self-closing tags with no text content — skip unless they have visible text attributes
        if (!/\b(?:label|title|alt|aria-label)\s*=/.test(tagContent)) continue;
      }

      // === Detection: theme-class patterns ===
      let matched = false;
      let matchedPattern = '';

      for (const pat of A1_3_THEME_CLASS_PATTERNS) {
        if (pat.test(tagContent)) {
          matched = true;
          const m = tagContent.match(pat);
          matchedPattern = m ? m[0] : 'theme-dependent class';
          break;
        }
      }

      // === Detection: opacity-reduced patterns ===
      if (!matched) {
        for (const pat of A1_3_OPACITY_PATTERNS) {
          if (pat.test(tagContent)) {
            matched = true;
            const m = tagContent.match(pat);
            matchedPattern = m ? m[0] : 'opacity-reduced text';
            break;
          }
        }
      }

      // === Detection: CSS variable in inline style ===
      if (!matched && A1_3_CSS_VAR_PATTERN.test(tagContent)) {
        matched = true;
        matchedPattern = 'CSS variable text color';
      }

      if (!matched) continue;

      const line = getLineNumber(tagMatch.index);
      const fileName = filepath.split('/').pop() || filepath;
      const dedupeKey = `a1.3|${filepath}|${line}|${matchedPattern}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const elementIdentifier = componentName
        ? `${componentName} (${fileName})`
        : fileName;

      const elementContext = inferElementContext(surroundingCtx) || `${tagName} element`;

      findings.push({
        ruleId: 'A1',
        ruleName: 'Insufficient text contrast',
        category: 'accessibility',
        status: 'potential',
        samplingMethod: 'inferred',
        inputType: 'zip',
        contrastRatio: undefined,
        thresholdUsed: 4.5,
        foreground: { value: null, resolved: false },
        background: { value: null, resolved: false, reason: 'theme-dependent / CSS variable' },
        note: 'A1.3: Theme-dependent or opacity-reduced text — contrast not statically computable.',
        elementIdentifier,
        elementDescription: elementContext,
        evidence: `${matchedPattern} in ${filepath}:${line}`,
        diagnosis: `Text color is theme-dependent or opacity-reduced. Final contrast ratio cannot be statically computed. WCAG 2.1 AA (4.5:1) compliance must be verified in rendered output.`,
        contextualHint: 'Contrast not computed — theme-dependent or opacity-reduced text.',
        correctivePrompt: '',
        confidence: matchedPattern.includes('opacity') ? 0.70 : 0.65,
        riskLevel: 'low',
        reasonCodes: ['THEME_DEPENDENT', 'STATIC_ANALYSIS'],
        potentialRiskReason: 'theme-dependent or opacity-reduced text color',
        backgroundStatus: 'unmeasurable',
        blocksConvergence: false,
        inputLimitation: 'Text color is theme-dependent or opacity-reduced; static analysis cannot compute effective contrast ratio.',
        advisoryGuidance: 'Text color is theme-dependent or opacity-reduced. Final contrast ratio cannot be statically computed. WCAG 2.1 AA (4.5:1) compliance must be verified in rendered output.',
        fgSource: undefined,
        bgSource: 'unresolved',
        evidenceLevel: 'structural_estimated',
        sizeStatus: 'unknown',
        lineNumber: line,
        startLine: line,
        endLine: line,
        extractedClasses: tagContent.match(/className\s*=\s*"([^"]+)"/)?.[1] || '',
        affectedComponents: [{
          colorClass: matchedPattern,
          filePath: filepath,
          componentName: componentName || undefined,
          elementContext,
          riskLevel: 'low',
          occurrence_count: 1,
        }],
      });
    }
  }

  console.log(`A1.3 theme-dependent/opacity: ${findings.length} potential findings`);
  return findings;
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
  elementTag: string; // actual HTML tag: input, div, button, a, etc.
  elementName: string; // Human-readable element name (e.g., "CommandInput", "CommandItem")
  elementSubtype?: string; // e.g., input[type="text"], div role="option" / aria-selected
  elementSource: 'jsx_tag' | 'wrapper_component' | 'html_tag_fallback' | 'unknown';
  sourceLabel: string;
  filePath: string;
  lineNumber: number;
  lineEnd?: number;
  rawClassName?: string;
  componentName: string;
  classification: 'confirmed' | 'potential' | 'not_applicable';
  detection: string;
  explanation: string;
  confidence: number;
  focusClasses: string[];
  triggerTokens: string[];
  alternativeIndicatorTokens: string[];
  correctivePrompt?: string;
  potentialSubtype?: 'borderline';
  potentialReason?: string;
  deduplicationKey: string;
  // Element metadata
  focusable: 'yes' | 'no' | 'unknown';
  selectorHints: string[]; // e.g., ['type="text"', 'role="menuitem"']
  _a2Debug: {
    outlineRemoved: boolean;
    hasStrongReplacement: boolean;
    hasStateDrivenIndicator: boolean;
    hasWeakFocusStyling: boolean;
    hasWrapperIndicator: boolean;
    matchedTokens: string[];
    triggerTokens: string[];
    focusable: string;
  };
}

interface A2ClassSegment {
  raw: string;
  tokens: string[];
  startLine: number;
  endLine: number;
  absoluteStart: number;
}

function getLineAtIndex(content: string, index: number): number {
  return content.slice(0, Math.max(0, index)).split('\n').length;
}

function tokenizeClassString(classStr: string): string[] {
  return classStr
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean);
}

function extractStringLiteralsFromExpression(expression: string): Array<{ value: string; offset: number }> {
  const literals: Array<{ value: string; offset: number }> = [];
  let i = 0;

  while (i < expression.length) {
    const ch = expression[i];
    if (ch !== '"' && ch !== "'" && ch !== '`') {
      i++;
      continue;
    }

    const quote = ch;
    const valueStart = i + 1;
    i++;
    let value = '';

    while (i < expression.length) {
      const curr = expression[i];

      if (curr === '\\' && i + 1 < expression.length) {
        value += expression.slice(i, i + 2);
        i += 2;
        continue;
      }

      // Handle template interpolation in backticks
      if (quote === '`' && curr === '$' && expression[i + 1] === '{') {
        i += 2;
        let braceDepth = 1;
        while (i < expression.length && braceDepth > 0) {
          const interpChar = expression[i];
          if (interpChar === '\\' && i + 1 < expression.length) {
            i += 2;
            continue;
          }
          if (interpChar === '{') braceDepth++;
          if (interpChar === '}') braceDepth--;
          i++;
        }
        continue;
      }

      if (curr === quote) break;
      value += curr;
      i++;
    }

    literals.push({ value, offset: valueStart });
    i++; // consume closing quote
  }

  return literals;
}

function extractA2ClassSegmentsFromTag(fullTag: string, tagStartIndex: number, content: string): A2ClassSegment[] {
  const segments: A2ClassSegment[] = [];
  const attrRegex = /\b(className|class)\s*=/g;
  let attrMatch: RegExpExecArray | null;

  while ((attrMatch = attrRegex.exec(fullTag)) !== null) {
    let cursor = attrMatch.index + attrMatch[0].length;
    while (cursor < fullTag.length && /\s/.test(fullTag[cursor])) cursor++;
    if (cursor >= fullTag.length) continue;

    const firstChar = fullTag[cursor];

    if (firstChar === '"' || firstChar === "'") {
      const quote = firstChar;
      const valueStart = cursor + 1;
      let end = valueStart;
      while (end < fullTag.length) {
        if (fullTag[end] === quote && fullTag[end - 1] !== '\\') break;
        end++;
      }
      const raw = fullTag.slice(valueStart, end);
      const tokens = tokenizeClassString(raw);
      if (tokens.length > 0) {
        const absoluteStart = tagStartIndex + valueStart;
        const absoluteEnd = tagStartIndex + Math.max(valueStart, end - 1);
        segments.push({
          raw,
          tokens,
          startLine: getLineAtIndex(content, absoluteStart),
          endLine: getLineAtIndex(content, absoluteEnd),
          absoluteStart,
        });
      }
      continue;
    }

    if (firstChar === '{') {
      let end = cursor;
      let depth = 0;
      let inString: string | null = null;
      let inTemplateLiteral = false;

      while (end < fullTag.length) {
        const ch = fullTag[end];

        if (inString) {
          if (ch === inString && fullTag[end - 1] !== '\\') inString = null;
          end++;
          continue;
        }

        if (inTemplateLiteral) {
          if (ch === '`' && fullTag[end - 1] !== '\\') inTemplateLiteral = false;
          end++;
          continue;
        }

        if (ch === '"' || ch === "'") {
          inString = ch;
          end++;
          continue;
        }

        if (ch === '`') {
          inTemplateLiteral = true;
          end++;
          continue;
        }

        if (ch === '{') {
          depth++;
          end++;
          continue;
        }

        if (ch === '}') {
          depth--;
          end++;
          if (depth === 0) break;
          continue;
        }

        end++;
      }

      const exprStart = cursor + 1;
      const exprEnd = Math.max(exprStart, end - 1);
      const expression = fullTag.slice(exprStart, exprEnd);
      const expressionAbsStart = tagStartIndex + exprStart;

      const literals = extractStringLiteralsFromExpression(expression);
      for (const lit of literals) {
        const raw = lit.value;
        const tokens = tokenizeClassString(raw);
        if (tokens.length === 0) continue;
        const absoluteStart = expressionAbsStart + lit.offset;
        const absoluteEnd = absoluteStart + Math.max(raw.length - 1, 0);
        segments.push({
          raw,
          tokens,
          startLine: getLineAtIndex(content, absoluteStart),
          endLine: getLineAtIndex(content, absoluteEnd),
          absoluteStart,
        });
      }
      continue;
    }

    // Bare attribute fallback
    let end = cursor;
    while (end < fullTag.length && !/[\s>]/.test(fullTag[end])) end++;
    const raw = fullTag.slice(cursor, end);
    const tokens = tokenizeClassString(raw);
    if (tokens.length > 0) {
      const absoluteStart = tagStartIndex + cursor;
      const absoluteEnd = tagStartIndex + Math.max(cursor, end - 1);
      segments.push({
        raw,
        tokens,
        startLine: getLineAtIndex(content, absoluteStart),
        endLine: getLineAtIndex(content, absoluteEnd),
        absoluteStart,
      });
    }
  }

  return segments;
}

function extractA2ParentIndicatorTokens(content: string, elementIndex: number): string[] {
  const contextStart = Math.max(0, elementIndex - 700);
  const context = content.slice(contextStart, elementIndex);
  const classAttrRegex = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([\s\S]{0,400}?)\})/g;
  const matches = Array.from(context.matchAll(classAttrRegex));
  if (matches.length === 0) return [];

  const last = matches[matches.length - 1];
  const literalClasses = (last[1] || last[2] || '').trim();
  const expression = (last[3] || '').trim();

  const tokens = new Set<string>();
  tokenizeClassString(literalClasses).forEach(t => tokens.add(t));

  if (expression) {
    const literals = extractStringLiteralsFromExpression(expression);
    for (const lit of literals) {
      tokenizeClassString(lit.value).forEach(t => tokens.add(t));
    }
  }

  return Array.from(tokens).filter(t =>
    /^(?:focus-within|group-focus|group-focus-visible|peer-focus|peer-focus-visible):(?:ring-|border-|outline-|shadow-|bg-|text-|underline)/i.test(t)
  );
}

interface ComponentSymbol {
  name: string;
  startLine: number;
  endLine: number;
}

function buildComponentSymbolTable(content: string): ComponentSymbol[] {
  const symbols: ComponentSymbol[] = [];
  const lines = content.split('\n');

  // Match exported const/function component definitions with forwardRef or arrow functions
  const patterns = [
    /(?:export\s+)?(?:const|let)\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:React\.)?forwardRef/,
    /(?:export\s+)?(?:const|let)\s+([A-Z][A-Za-z0-9_]*)\s*=\s*\(/,
    /(?:export\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        // Find the end of this component (next component start or end of file)
        let endLine = lines.length;
        for (let j = i + 1; j < lines.length; j++) {
          if (patterns.some(p => p.test(lines[j]))) {
            endLine = j - 1;
            break;
          }
        }
        symbols.push({ name: match[1], startLine: i + 1, endLine });
        break;
      }
    }
  }

  return symbols;
}

interface ResolvedElement {
  elementName: string;
  elementSource: 'jsx_tag' | 'wrapper_component' | 'html_tag' | 'unknown';
}

function resolveA2ElementName(
  _content: string,
  _parserPos: number,
  _lineStart: number,
  syntheticTagMatch: RegExpMatchArray | null,
  inferredTag: string,
  symbolTable: ComponentSymbol[],
  componentName: string,
): ResolvedElement {
  // Tier 1: Use JSX tag name if it's a PascalCase component
  const tagName = syntheticTagMatch?.[1] || '';
  if (tagName && /^[A-Z]/.test(tagName)) {
    return { elementName: tagName, elementSource: 'jsx_tag' };
  }

  // Tier 2: Check symbol table for wrapper component
  const wrapper = symbolTable.find(sym => _lineStart >= sym.startLine && _lineStart <= sym.endLine);
  if (wrapper) {
    return { elementName: wrapper.name, elementSource: 'wrapper_component' };
  }

  // Tier 3: HTML tag fallback
  if (inferredTag && inferredTag !== 'unknown') {
    return { elementName: inferredTag, elementSource: 'html_tag' };
  }

  // Tier 4: Unknown
  return { elementName: componentName || 'unknown', elementSource: 'unknown' };
}

function detectA2FocusVisibility(allFiles: Map<string, string>): A2Finding[] {
  const findings: A2Finding[] = [];
  const seenKeys = new Set<string>();

  const FOCUSABLE_ROLES = new Set([
    'button', 'link', 'menuitem', 'option', 'combobox', 'tab', 'checkbox', 'radio',
    'switch', 'listbox', 'slider', 'treeitem', 'gridcell',
  ]);

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|html|htm)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    const fileName = filePath.split('/').pop() || filePath;
    const symbolTable = buildComponentSymbolTable(content);

    const jsxNodes = extractJsxOpeningTags(content, '[A-Za-z][A-Za-z0-9_.]*');

    for (const node of jsxNodes) {
      const classSegments = extractA2ClassSegmentsFromTag(node.fullMatch, node.index, content);
      if (classSegments.length === 0) continue;

      const allTokens = Array.from(new Set(classSegments.flatMap(segment => segment.tokens)));

      const outlineRemovalTokens = allTokens.filter(t =>
        t === 'outline-none' ||
        t === 'focus:outline-none' ||
        t === 'focus-visible:outline-none'
      );
      if (outlineRemovalTokens.length === 0) continue;

      const outlineSegments = classSegments.filter(segment =>
        segment.tokens.some(token =>
          token === 'outline-none' || token === 'focus:outline-none' || token === 'focus-visible:outline-none'
        )
      );

      const lineStart = Math.min(...outlineSegments.map(s => s.startLine));
      const lineEnd = Math.max(...outlineSegments.map(s => s.endLine));
      const rawClassName = outlineSegments.map(s => s.raw).join(' | ');

      const parserPos = outlineSegments[0]?.absoluteStart ?? node.index;
      const syntheticTagMatch = `<${node.tag}`.match(/<([A-Za-z0-9_.]+)/);
      const inferredTag = node.tag.includes('.')
        ? node.tag.split('.').pop()?.toLowerCase() || 'unknown'
        : node.tag.toLowerCase();

      const resolved = resolveA2ElementName(
        content,
        parserPos,
        lineStart,
        syntheticTagMatch,
        inferredTag,
        symbolTable,
        componentName,
      );

      const wrapperSymbol = symbolTable.find(sym => lineStart >= sym.startLine && lineStart <= sym.endLine);
      const elementName = wrapperSymbol?.name || resolved.elementName;
      const elementSource = wrapperSymbol ? 'wrapper_component' as const : resolved.elementSource;

      const roleParsed = parseA5AttributeFromTag(node.fullMatch, 'role');
      const typeParsed = parseA5AttributeFromTag(node.fullMatch, 'type');
      const tabIndexParsed = parseA5AttributeFromTag(node.fullMatch, 'tabIndex');
      const idParsed = parseA5AttributeFromTag(node.fullMatch, 'id');
      const nameParsed = parseA5AttributeFromTag(node.fullMatch, 'name');
      const ariaLabelParsed = parseA5AttributeFromTag(node.fullMatch, 'aria-label');
      const ariaSelectedParsed = parseA5AttributeFromTag(node.fullMatch, 'aria-selected');

      const parsedRole = roleParsed.isNonEmpty && roleParsed.value ? roleParsed.value.toLowerCase() : '';
      const parsedType = typeParsed.isNonEmpty && typeParsed.value ? typeParsed.value.toLowerCase() : null;
      const parsedTabIndex = tabIndexParsed.isNonEmpty && tabIndexParsed.value && /^-?\d+$/.test(tabIndexParsed.value)
        ? parseInt(tabIndexParsed.value, 10)
        : null;

      const elementTag = (() => {
        if (/CommandInput/i.test(elementName)) return 'input';
        if (/CommandItem/i.test(elementName)) return 'div';
        if (node.tag.includes('.')) {
          const last = node.tag.split('.').pop() || '';
          if (/^Input$/i.test(last)) return 'input';
          if (/^Item$/i.test(last)) return 'div';
          return last.toLowerCase();
        }
        return node.tag.toLowerCase();
      })();

      const strongReplacementTokens = allTokens.filter(t =>
        /^focus(?:-visible)?:ring-(?!0$)/i.test(t) ||
        /^focus(?:-visible)?:border-(?!0$|none$)/i.test(t) ||
        /^focus(?:-visible)?:shadow-(?!none$)/i.test(t) ||
        /^focus(?:-visible)?:outline-(?!none$)/i.test(t) ||
        /^focus-visible:underline$/i.test(t)
      );

      if (strongReplacementTokens.length > 0) {
        console.log(`A2 PASS (deterministic): ${filePath}:${lineStart} — strong replacement [${strongReplacementTokens.join(', ')}]`);
        continue;
      }

      const stateDrivenTokens = allTokens.filter(t =>
        /^data-\[selected(?:=true|='true')?\]:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(t) ||
        /^data-\[highlighted(?:=true|='true')?\]:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(t) ||
        /^aria-selected:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(t) ||
        /^data-\[state=active\]:(?:bg-|text-|ring-|border-|outline-|shadow-)/i.test(t)
      );

      const weakFocusTokens = allTokens.filter(t =>
        /^focus(?:-visible)?:bg-/i.test(t) ||
        /^focus(?:-visible)?:text-/i.test(t) ||
        /^focus(?:-visible)?:underline$/i.test(t) ||
        /^focus(?:-visible)?:opacity-/i.test(t) ||
        /^focus(?:-visible)?:font-/i.test(t) ||
        /^(?:group-focus|group-focus-visible|peer-focus|peer-focus-visible):(?:bg-|text-|ring-|border-|outline-|shadow-|underline)/i.test(t)
      );

      const wrapperIndicatorTokens = extractA2ParentIndicatorTokens(content, node.index);
      const isCmdkItem = /Command(?:Primitive\.)?Item|CommandItem/i.test(node.tag) || /CommandItem/i.test(elementName) || stateDrivenTokens.some(t => /^data-\[selected/.test(t));

      const hasStateDrivenIndicator = stateDrivenTokens.length > 0 || ariaSelectedParsed.present;
      const hasWeakFocusStyling = weakFocusTokens.length > 0;
      const hasWrapperIndicator = wrapperIndicatorTokens.length > 0;

      const alternativeIndicatorTokens = Array.from(new Set([
        ...stateDrivenTokens,
        ...weakFocusTokens,
        ...wrapperIndicatorTokens,
      ]));

      // Focusability gate — emit only for focusable targets
      let focusable: 'yes' | 'no' | 'unknown' = 'unknown';
      const hasHref = /\bhref\s*=/.test(node.fullMatch);

      if (/^(input|textarea|select|button)$/.test(elementTag)) {
        focusable = 'yes';
      } else if (elementTag === 'a') {
        focusable = hasHref || (parsedTabIndex !== null && parsedTabIndex >= 0) ? 'yes' : 'no';
      } else if (parsedTabIndex !== null) {
        focusable = parsedTabIndex >= 0 ? 'yes' : 'no';
      } else if (parsedRole && FOCUSABLE_ROLES.has(parsedRole)) {
        focusable = 'yes';
      } else if (/^[A-Z]/.test(node.tag) || node.tag.includes('.')) {
        focusable = /(Input|Item|Button|Link|Trigger|Tab|Checkbox|Switch|Radio|Slider|Option)$/i.test(elementName || node.tag)
          ? 'yes'
          : 'unknown';
      } else {
        focusable = 'no';
      }

      if (focusable !== 'yes') {
        continue;
      }

      let classification: 'confirmed' | 'potential' | 'not_applicable' = 'confirmed';
      if (hasStateDrivenIndicator || hasWeakFocusStyling || hasWrapperIndicator || isCmdkItem) {
        classification = 'potential';
      }

      let elementSubtype = elementTag;
      if (elementTag === 'input') {
        elementSubtype = `input[type="${parsedType || 'text'}"]`;
      } else if (parsedRole) {
        elementSubtype = `${elementTag} role="${parsedRole}"`;
      } else if (parsedTabIndex !== null) {
        elementSubtype = `${elementTag} tabIndex=${parsedTabIndex}`;
      }
      if ((hasStateDrivenIndicator || isCmdkItem) && !/aria-selected/.test(elementSubtype)) {
        elementSubtype = `${elementSubtype} / aria-selected`;
      }

      const selectorHints: string[] = [];
      if (parsedType) selectorHints.push(`type="${parsedType}"`);
      if (parsedRole) selectorHints.push(`role="${parsedRole}"`);
      if (parsedTabIndex !== null) selectorHints.push(`tabIndex=${parsedTabIndex}`);
      if (idParsed.isNonEmpty && idParsed.value) selectorHints.push(`id="${idParsed.value}"`);
      if (nameParsed.isNonEmpty && nameParsed.value) selectorHints.push(`name="${nameParsed.value}"`);
      if (ariaLabelParsed.isNonEmpty && ariaLabelParsed.value) selectorHints.push(`aria-label="${ariaLabelParsed.value}"`);
      if (hasStateDrivenIndicator || isCmdkItem) selectorHints.push('aria-selected');

      const dedupeKey = `A2|${filePath}|${lineStart}|${elementName}|${outlineRemovalTokens.join(',')}|${alternativeIndicatorTokens.join(',')}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      const detection = alternativeIndicatorTokens.length > 0
        ? `outline removed via "${outlineRemovalTokens.join(', ')}"\nalternative indicator detected: ${alternativeIndicatorTokens.join(', ')}`
        : `outline removed via "${outlineRemovalTokens.join(', ')}"\nno visible focus indicator detected`;

      const explanation = classification === 'confirmed'
        ? 'Element removes the default browser outline without providing a visible focus replacement.'
        : 'Outline is removed, but focus feedback appears state-driven or subtle; perceptibility cannot be statically verified.';

      const potentialReason = classification === 'potential'
        ? (hasStateDrivenIndicator || isCmdkItem
            ? 'Focus relies on state-driven background/text change; perceptibility not statically verifiable.'
            : 'Focus relies on subtle or wrapper-driven styling; perceptibility cannot be statically verified.')
        : undefined;

      const sourceLabel = elementName !== 'unknown'
        ? elementName
        : (componentName || fileName.replace(/\.\w+$/, ''));

      console.log(`A2 ${classification.toUpperCase()} (deterministic): ${filePath}:${lineStart}-${lineEnd} name=${elementName} subtype=${elementSubtype} focusable=${focusable} outline=[${outlineRemovalTokens.join(',')}] alt=[${alternativeIndicatorTokens.join(',')}]`);

      findings.push({
        elementLabel: sourceLabel,
        elementType: parsedRole || elementTag,
        elementTag,
        elementName,
        elementSubtype,
        elementSource,
        sourceLabel,
        filePath,
        lineNumber: lineStart,
        lineEnd,
        rawClassName,
        componentName,
        classification,
        detection,
        explanation,
        confidence: classification === 'confirmed' ? 0.92 : 0.72,
        focusClasses: Array.from(new Set([...outlineRemovalTokens, ...alternativeIndicatorTokens])),
        triggerTokens: outlineRemovalTokens,
        alternativeIndicatorTokens,
        correctivePrompt: classification === 'confirmed'
          ? `[${sourceLabel} ${elementSubtype}] — ${filePath}:${lineStart}${lineEnd !== lineStart ? `-${lineEnd}` : ''}\n\nIssue reason:\nFocus indicator is removed (${outlineRemovalTokens.join(', ')}) without a visible replacement.\n\nRecommended fix:\nAdd a visible keyboard focus style using :focus-visible (e.g., focus-visible:ring-2 focus-visible:ring-offset-2) and apply consistently across all instances.`
          : undefined,
        potentialSubtype: classification === 'potential' ? 'borderline' : undefined,
        potentialReason,
        deduplicationKey: dedupeKey,
        focusable,
        selectorHints,
        _a2Debug: {
          outlineRemoved: true,
          hasStrongReplacement: false,
          hasStateDrivenIndicator,
          hasWeakFocusStyling,
          hasWrapperIndicator,
          matchedTokens: Array.from(new Set([...outlineRemovalTokens, ...alternativeIndicatorTokens])),
          triggerTokens: outlineRemovalTokens,
          focusable,
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

### U2 (Incomplete / Unclear Navigation) — WAYFINDING-ONLY ASSESSMENT:
**NOTE:** U2 deterministic sub-checks (U2.D1, U2.D2, U2.D3) run separately via static analysis.
Your role is ONLY to provide optional LLM reinforcement when deterministic D2 signals are ambiguous.

**U2 EVALUATES ONLY (web/desktop wayfinding):**
- Can users know where they are? (active page indicator, page heading)
- Can users know where they can go? (visible navigation, discoverable menu)
- Can users navigate back/up in deep contexts? (back button, breadcrumb, parent link)

**U2 MUST NOT EVALUATE (anti-overlap, belongs to other rules):**
- Step-based forms, progress indicators, generic Next/Previous, missing step context → U4
- Layout grouping, sections, card structure, visual hierarchy → U6
- Inability to go back/exit/cancel a flow → E3
- Content truncation or hidden overflow → U3
- Accessibility landmark semantics → A-rules
- Code maintainability or routing scalability → out of scope

**CRITICAL:** Do NOT flag just because breadcrumbs are missing. If active nav highlight + page heading exist, that is sufficient wayfinding.
**CRITICAL:** Do NOT generate findings about breadcrumb depth, shallow breadcrumbs, or breadcrumbs not reflecting deeper navigation. Breadcrumb-depth analysis is handled EXCLUSIVELY by the deterministic D3 gate. Any LLM breadcrumb-depth finding will be discarded.

**CLASSIFICATION:**
- U2 findings are ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- NEVER generate corrective prompts for U2
- Use evaluationMethod: "hybrid_llm_fallback"
- Confidence: 0.60–0.80 (cap at 0.80)
- If deterministic D2 triggered but you see strong wayfinding cues in code, output "suppress" instead

**OUTPUT FOR U2:**
\`\`\`json
{
  "ruleId": "U2",
  "ruleName": "Incomplete / Unclear navigation",
  "category": "usability",
  "status": "potential",
  "diagnosis": "Evidence-based wayfinding clarity assessment...",
  "evidence": "Specific navigation patterns observed...",
  "contextualHint": "Short guidance...",
  "confidence": 0.65
}
\`\`\`

### U4 (Recognition-to-Recall Regression) — LLM-MANDATORY EVALUATION:
**ALL U4 subtypes require YOUR decision. Deterministic analysis extracted CANDIDATES in \`[U4_EVIDENCE_BUNDLE]\`. You are the SOLE decision maker.**

**GLOBAL CONSTRAINTS (MANDATORY):**
- U4 MUST NEVER output "confirmed". Status is ALWAYS "potential".
- Maximum confidence: 0.65. Range: 0.45–0.65.
- If evidence is ambiguous → SUPPRESS (do not report).
- If categorical intent cannot be verified → SUPPRESS.
- Do NOT assume text inputs require structured selection.
- Do NOT infer enum expectation from generic labels: reason, message, description, notes, details.
- U4 must prioritize false-positive avoidance over sensitivity. You are ALLOWED to decline reporting.
- Truncation/overflow issues are U3 scope — never flag under U4.

**EVALUATION QUESTIONS (answer for each candidate):**
1. Does this reduce recognition-based interaction?
2. Is recall burden plausibly increased?
3. Are there visible mitigations?
4. Is semantic intent clearly categorical?
If ANY answer is "no" or "uncertain" → SUPPRESS.

**U4.1 (Structured Selection → Free-Text):**
Report ONLY if: strong evidence the field represents a FINITE categorical domain AND no structured input exists AND the field is NOT narrative/open-ended.
Suppress if: label implies open description, domain expectation unclear, no explicit enum evidence.
**CRITICAL — Confirmation-phrase exception:** If the input is used for typed confirmation of a destructive action (e.g., "Type DELETE to confirm") and the required phrase is visibly displayed nearby, this is recognition/copying, NOT recall. You MUST suppress these candidates. Look for: "type", "enter", "confirm", "to confirm" + a visible required word like DELETE, CONFIRM, REMOVE.

**U4.2 (Hidden Selection State):**
Report ONLY if: selection interaction exists AND active state is NOT visually persistent AND no visible badge/highlight/breadcrumb/summary exists.
Suppress if: active styling present, aria-selected present, context visible elsewhere.
**CRITICAL for U4.2:** If the mitigation signals include "active_state_in_component_definition", this means the shared component definition (e.g., components/ui/tabs.tsx) provides persistent active styling via data-[state=active] or similar. In this case you MUST output {"report":"no"} — the active indicator EXISTS in the component definition even if not visible in the page-level usage code.

**U4.3 (Multi-Step Context Regression):**
Report ONLY if: multi-step flow confirmed AND missing step indicator AND missing back navigation AND missing summary AND missing persistent context.
If ANY mitigation exists → SUPPRESS.

**U4.4 (Generic Context-Free CTAs):**
Report ONLY if: button text is generic AND action outcome is NOT contextually clarified nearby.
Suppress if: section heading clarifies action, page title clarifies context, action universally obvious (e.g., Login form).

**ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, page titles, or variable names as evidence.
- Base conclusions ONLY on field labels, CTA text, nearby headings, and code context from the evidence bundles.
- If evidence is insufficient, return NO U4 finding.

**OUTPUT FOR U4 — STRUCTURED u4Elements (ALL Potential):**
\`\`\`json
{
  "ruleId": "U4",
  "ruleName": "Recognition-to-recall regression",
  "category": "usability",
  "isU4Aggregated": true,
  "u4Elements": [
    {
      "elementLabel": "\\"Category\\" text input",
      "elementType": "input",
      "location": "src/components/Form.tsx",
      "detection": "U4.1: Text input for categorical field with no selection component",
      "evidence": "Field expects structured category selection but only provides free-text input. Recognition → recall shift: user must remember valid categories instead of selecting from a list.",
      "subCheck": "U4.1",
      "subCheckLabel": "Structured Selection → Free-Text",
      "status": "potential",
      "recommendedFix": "Replace with <Select> or <Combobox>",
      "confidence": 0.60,
      "mitigationSummary": "No selection component, no autocomplete, no datalist"
    }
  ],
  "diagnosis": "Summary of U4 findings — recognition-to-recall shift explanation...",
  "confidence": 0.55
}
\`\`\`
- If NO U4 issues pass evaluation, do NOT include U4 in the violations array.
- Each u4Element MUST include: subCheck, status ("potential"), confidence (0.45–0.65), and mitigationSummary.
- The explanation/evidence MUST explicitly describe the recognition → recall shift.


### U6 (Weak Grouping / Layout Coherence) — LLM-ASSISTED EVALUATION:
**NOTE:** U6 uses pre-extracted layout evidence bundles appended as \`[U6_LAYOUT_EVIDENCE_BUNDLE]\`. Use ONLY the provided extracted layout cues to assess grouping/hierarchy.
**NOTE:** U6 is ONLY evaluated on page-like components (not router/config files). Files have already been filtered. Each bundle includes a trigger summary line: "Blocks:X Containers:Y Headings:Z SemanticSections:S Grid:true/false". Use these counts to ground your assessment.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, page titles, or "test" wording as evidence.
- Do NOT infer developer intent from naming conventions.
- Base conclusions ONLY on the extracted layout evidence: headings, container counts, flex/grid usage, spacing tokens, repeated patterns, flat-stack cues, and the trigger summary counts.
- If evidence is insufficient to demonstrate weak grouping, return NO U6 finding — do not guess.
- If the trigger summary shows Containers >= 2, this indicates deliberate visual grouping — be very cautious about reporting.

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
      "evidence": "Blocks:8 Containers:0 Headings:1 — 12 sibling inputs without section headings or fieldset wrappers",
      "recommendedFix": "Group related fields into fieldsets with legends or add section headings",
      "confidence": 0.70
    }
  ],
  "diagnosis": "Summary of grouping/layout issues grounded in trigger summary counts...",
  "contextualHint": "Short guidance...",
  "confidence": 0.70
}
\`\`\`
- If NO U6 issues found, do NOT include U6 in the violations array.
- Each u6Element MUST cite evidence grounded in the trigger summary counts (Blocks, Containers, Headings — NOT file names).

Usability rules to check:
${rules.usability.filter(r => selectedRulesSet.has(r.id)).map(r => `- ${r.id}: ${r.name}`).join('\n')}

## PASS 3 — Ethics
Look for patterns that may undermine user autonomy or informed consent:
- Imbalanced choice architecture: visual weight, pre-selection, or ordering that nudges users (E2)
- Obscured user controls: opt-out, cancel, dismiss, or unsubscribe options that are suppressed or harder to access (E3)

### E1 (Insufficient Transparency in High-Impact Actions) — LLM-ASSISTED EVALUATION:
**NOTE:** E1 uses pre-extracted high-impact action evidence bundles appended as \`[E1_EVIDENCE_BUNDLE]\`. Use ONLY the provided extracted UI text/context to assess transparency.
**NOTE:** Actions with strong disclosure (irreversibility warnings, consequence lists) AND a confirmation dialog have ALREADY been filtered out. The bundles you receive represent actions where disclosure may be missing or insufficient. Do NOT re-flag actions that were suppressed.
**NOTE:** Detection now covers ALL deletion flows: button labels, handler-based invocations (onClick calling delete functions), network DELETE requests, and Trash icon patterns.

**CRITICAL ANTI-HALLUCINATION RULES (MANDATORY):**
- Do NOT use file names, component names, or test wording as evidence.
- Do NOT infer malicious intent. Use neutral language ("may be unclear", "transparency risk").
- Base conclusions ONLY on the extracted CTA labels, evidence tokens, nearby UI text, and confirmation dialog presence/absence.
- If evidence is insufficient to demonstrate missing transparency, return NO E1 finding — do not guess.
- Do NOT flag password reset, sign-in, sign-out, or other auth-flow actions.
- Do NOT flag actions where disclosure terms are already present (check the "Disclosure terms found" field in the bundle).

**EVALUATE (using ONLY the evidence bundle content):**
- Missing consequence disclosure: delete/remove actions without "permanent", "cannot be undone" warnings
- Missing cost disclosure: subscribe/buy/upgrade actions without visible pricing or billing cycle
- Missing data implications: data-sharing actions without consent explanation
- Missing confirmation step: destructive actions executed with a single gesture without confirmation dialog/modal
- Direct DELETE request: network DELETE calls triggered from UI without any confirmation gate

**CLASSIFICATION:**
- E1 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence:
  - 0.85–0.90: DELETE request + direct UI trigger + no confirmation gate (strong evidence)
  - 0.70–0.80: delete intent inferred from handler name or label but request/gate linkage is weaker
  - 0.60–0.65: partial disclosure exists but confirmation is missing
- For each e1Element, include the "detectionSource" field from the bundle (label/handler/network/icon)

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
      "startLine": 42,
      "deleteLine": 15,
      "detection": "Destructive action without consequence disclosure or confirmation step",
      "evidence": "CTA: 'Delete Account' | Evidence: DELETE method, handler:handleDelete | No confirmation dialog detected",
      "evidenceTokens": ["DELETE method", "handler:handleDelete", "label:\\"Delete Account\\""],
      "recommendedFix": "Add a confirmation dialog that explicitly states the action is irreversible and what data will be lost",
      "confidence": 0.85,
      "detectionSource": "label"
    }
  ],
  "diagnosis": "Summary of transparency issues...",
  "contextualHint": "Short guidance...",
  "confidence": 0.85
}
\`\`\`
- If NO E1 issues found, do NOT include E1 in the violations array.
- Each e1Element MUST cite evidence from the provided evidence bundle (CTA labels, evidence tokens, nearby text — NOT file names).
- Use the startLine/deleteLine from the bundle for precise source attribution.

### E2 (Imbalanced Choice Architecture in High-Impact Decisions) — LLM-ASSISTED EVALUATION:
**NOTE:** E2 uses pre-extracted choice bundle data appended as \`[E2_CHOICE_BUNDLE]\`. Each bundle has ALREADY passed the high-impact domain gate (consent/privacy, monetization, irreversible actions) and has 2+ deterministic imbalance signals. Your job is to confirm whether the imbalance plausibly nudges users toward a system-beneficial outcome.

**SCOPE — E2 flags ONLY when:**
- Multiple choice options are presented for a MEANINGFUL decision (consent, payment, subscription, data sharing, deletion), AND
- One option is visually dominant or frictionless, AND
- The alternative is visually suppressed, harder to find, or requires extra steps, AND
- This imbalance could steer users toward an outcome that benefits the system more than the user.

**MUST NOT FLAG (EXCLUSIONS):**
- Standard "Sign Up" (primary) + "Sign In" (secondary) on landing pages — this is normal hierarchy.
- Navigation links vs auth buttons on marketing pages.
- Standard marketing layout unless tied to consent/monetization/data/high-impact context.
- Role-based dashboard actions that are not explicit user choice sets.
- Any cluster where BOTH options are clearly visible and accessible, even if styled differently.
- **SAFETY PATTERNS:** A destructive action styled in red/destructive (e.g., "Delete Account") paired with a clearly visible neutral cancel/keep/go-back button is a STANDARD SAFETY PATTERN, not manipulative architecture. This includes: red destructive button + neutral cancel button, confirmation dialogs with warning text, and additional acknowledgement checkboxes. If both actions are clearly visible and accessible, do NOT report E2.

**CRITICAL ANTI-HALLUCINATION RULES:**
- Do NOT use file names, component names, or test wording as evidence.
- Do NOT infer malicious intent. Use neutral phrasing ("imbalance risk", "may nudge").
- If evidence is insufficient to demonstrate meaningful autonomy impact, return NO E2 finding.
- Base conclusions ONLY on the extracted labels, style tokens, imbalance signals, and nearby microcopy.

**CONFIDENCE RULES (STRICT):**
- 0.55–0.65: Weak signals — imbalance exists but impact on autonomy is uncertain.
- 0.65–0.75: Multiple strong signals + clear high-impact context (consent/payment/deletion).
- NEVER exceed 0.75.

**OUTPUT FOR E2 — STRUCTURED e2Elements:**
\`\`\`json
{
  "ruleId": "E2",
  "ruleName": "Imbalanced choice architecture in high-impact decision",
  "category": "ethics",
  "status": "potential",
  "isE2Aggregated": true,
  "e2Elements": [
    {
      "elementLabel": "Consent dialog choices",
      "elementType": "button-group",
      "location": "src/components/ConsentModal.tsx",
      "detection": "Accept option visually dominates decline in consent context",
      "evidence": "Accept: 'Accept All' (bg-blue-600, w-full, py-3) | Decline: 'Manage preferences' (text-gray-400, text-sm, link) | High-impact: consent, tracking | Signals: visual_dominance, size_asymmetry",
      "recommendedFix": "Present confirm/decline options with comparable visual weight and equal discoverability.",
      "confidence": 0.65
    }
  ],
  "diagnosis": "Summary of choice imbalance in high-impact context...",
  "contextualHint": "Present confirm/decline options with comparable visual weight and equal discoverability.",
  "confidence": 0.65
}
\`\`\`
- If NO E2 issues found or evidence is insufficient, do NOT include E2 in the violations array.
- Each e2Element MUST cite evidence from the provided choice bundle (labels, style tokens, signals — NOT file names).

### E3 (Structural Absence of Exit/Cancel for High-Impact Actions) — HYBRID EVALUATION:
**NOTE:** E3 uses pre-extracted evidence bundles appended as \`[E3_CONTROL_RESTRICTION_EVIDENCE]\`. Use ONLY the provided structural evidence.

**SCOPE — E3 detects ONLY:**
- High-impact destructive/irreversible actions (delete, payment, subscribe, account deletion) that lack ANY structural exit mechanism (cancel, back, close, undo, dismiss, breadcrumb).

**E3 must NOT evaluate:**
- Visual bias between cancel and confirm buttons (belongs to E2)
- Missing consequence/transparency text (belongs to E1)
- Multi-step wizard usability or step indicators (belongs to U4)
- Forced marketing opt-ins or consent checkboxes (belongs to E1)

**HIGH-IMPACT ACTION GATE (Required):**
E3 triggers ONLY if a high-impact action is present:
- Delete / Remove / Permanently delete
- Confirm payment / Pay / Subscribe / Proceed with charge
- Account deletion / Deactivate account
- Destructive/danger button variants
If NO high-impact action exists → do NOT report E3.

**STRUCTURAL CONTROL ABSENCE (Required):**
E3 triggers ONLY if NO structural exit exists near the high-impact action:
- Cancel button, Back button, Close button (including modal X)
- Undo option, Decline option, Breadcrumb navigation
- Modal dismiss handler (onClose, onDismiss, onOpenChange)
If ANY of these are present → SUPPRESS E3 entirely.

**SUPPRESSION RULES:**
- If cancel/decline exists but is visually weaker → this is E2, NOT E3. Suppress.
- If consequence text is missing but cancel exists → this is E1. Suppress.
- If the issue is step indicators or wizard navigation → this is U4. Suppress.

**CLASSIFICATION:**
- E3 is ALWAYS "Potential" (non-blocking) — NEVER "Confirmed"
- Confidence: 0.65–0.80 (cap at 0.80). Suppress findings below 0.65.
- 0.75–0.80: High-impact destructive action + no structural exit
- 0.65–0.75: Likely missing exit but partial ambiguity

**ANTI-HALLUCINATION:**
- Do NOT use file names as evidence. Do NOT infer malicious intent.
- If evidence is insufficient, return NO E3 finding — do not guess.

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
      "elementLabel": "Delete confirmation without cancel",
      "elementType": "dialog",
      "location": "src/components/DeleteModal.tsx",
      "subCheck": "E3.D1",
      "detection": "High-impact destructive action without visible exit mechanism",
      "evidence": "Delete button in dialog without cancel, close, or dismiss control",
      "recommendedFix": "Add a cancel or close button alongside the destructive action",
      "confidence": 0.78
    }
  ],
  "diagnosis": "Summary of structural exit absence...",
  "contextualHint": "Short guidance...",
  "confidence": 0.78
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

// ========== U4 CANDIDATE EXTRACTION (Recognition-to-Recall Regression) — TWO-STAGE ==========
// Stage 1: Deterministic candidate extraction ONLY — no classification, no emission.
// All candidates are sent to LLM (Stage 2) for final decision.

interface U4Candidate {
  candidateType: 'U4.1' | 'U4.2' | 'U4.3' | 'U4.4';
  elementLabel: string;
  elementType: string;
  filePath: string;
  codeSnippet: string;
  nearbyHeadings: string[];
  mitigationSignals: string[];
  rawEvidence: string;
  // U4.1-specific enrichment fields
  candidateKind?: 'categorical_free_text' | 'confirmation_phrase' | 'unknown';
  hasVisibleRequiredPhrase?: boolean;
  knownOptionsDetected?: boolean;
  knownOptionsExamples?: string[];
  nearbyText?: string[];
  actionContext?: string[];
  suppressionReason?: string;
  fieldLabel?: string;
  fieldPlaceholder?: string;
  inputType?: string;
}

const U4_STRUCTURED_LABEL_RE = /\b(category|type|status|specialty|department|gender|country|state|province|region|language|currency|priority|severity|role|level|grade|plan|tier|occupation|industry|marital|blood\s*type|ethnicity|nationality|education|degree|sport|position|brand|model|color|size|material|condition|source|channel|frequency|method|mode|format|platform|device)\b/i;
const U4_FREEFORM_LABEL_RE = /\b(note|notes|comment|comments|description|details|message|reason|bio|biography|about|story|narrative|explain|additional|other|remarks|feedback|suggestion|instructions|address|street|thoughts|opinion|custom|free.?text)\b/i;
const U4_SELECTION_RE = /<(?:Select|RadioGroup|Radio|CheckboxGroup|Combobox|Autocomplete|Listbox|ToggleGroup|SegmentedControl|Dropdown|DropdownMenu)\b|<(?:select|datalist)\b|\b(?:autocomplete|datalist|onSuggest|filterOptions|combobox)\b/i;
const U4_STANDARD_AUTH_CTAS = /^(Sign\s*In|Sign\s*Up|Log\s*In|Log\s*Out|Register|Create\s*Account|Go\s*to\s*Dashboard|Go\s*Home|Back\s*to\s*Home|Back\s*to\s*Login|Forgot\s*Password|Reset\s*Password|Verify\s*Email|Resend\s*Code|Resend\s*Email|Sign\s*Out|Logout)$/i;

// Confirmation-phrase detection: requires DESTRUCTIVE context keywords (not just "type"/"enter" alone)
const U4_CONFIRMATION_DESTRUCTIVE_RE = /\b(delete|DELETE|cannot\s*be\s*undone|permanent|irreversible|are\s*you\s*sure|this\s*action|will\s*be\s*(?:deleted|removed|lost)|destroy|erase|remove\s*account|close\s*account)\b/i;
const U4_CONFIRMATION_INSTRUCTION_RE = /\b(type|enter)\s+(?:["'`]?[A-Z]{2,20}["'`]?|the\s*(?:word|name|phrase))\b/i;
const U4_CONFIRMATION_PHRASE_VISIBLE_RE = /(?:type|enter)\s+["'`]?(?:DELETE|CONFIRM|REMOVE|CANCEL|YES|[A-Z]{2,20})["'`]?\s*(?:to\s*(?:confirm|delete|remove|proceed|continue)|in\s*order\s*to)|type\s*(?:the\s*)?(?:word|name|phrase|text)\s/i;

// Known-set evidence detection for U4.1 confidence boosting
const U4_KNOWN_SET_RE = /(?:const|let|var)\s+(?:specialties|categories|types|statuses|departments|roles|options|choices|genders|countries|states|provinces|languages|currencies|priorities|severities|levels|grades|plans|tiers|occupations|industries)\s*(?::\s*\w+(?:\[\])?\s*)?=\s*\[([^\]]{10,})\]/i;
const U4_ENUM_RE = /(?:enum\s+\w+|oneOf|z\.enum)\s*(?:\{|\()\s*\[?([^\]})]{10,})\]?\s*(?:\}|\))/i;

function extractU4Candidates(allFiles: Map<string, string>): U4Candidate[] {
  const candidates: U4Candidate[] = [];

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules')) continue;

    const lines = content.split('\n');

    const getHeadings = (lineNum: number, range: number): string[] => {
      const ctxStart = Math.max(0, lineNum - range);
      const ctxEnd = Math.min(lines.length, lineNum + range);
      const nearby = lines.slice(ctxStart, ctxEnd).join('\n');
      const headings: string[] = [];
      const hRe = /<h([1-6])\b[^>]*>([^<]{2,60})<\/h\1>/gi;
      let hm;
      while ((hm = hRe.exec(nearby)) !== null) headings.push(hm[2].replace(/\{[^}]*\}/g, '').trim());
      return headings;
    };

    const getSnippet = (lineNum: number, range: number): string => {
      const ctxStart = Math.max(0, lineNum - range);
      const ctxEnd = Math.min(lines.length, lineNum + range);
      return lines.slice(ctxStart, ctxEnd).join('\n');
    };

    // ---- U4.1 Candidates ----
    const inputRe = /<(?:Input|input|textarea|Textarea)\b([^>]*?)(?:\/>|>)/gi;
    let m;
    while ((m = inputRe.exec(content)) !== null) {
      const attrs = m[1] || '';
      const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const inputType = typeMatch?.[1] || typeMatch?.[2] || 'text';
      if (!['text', ''].includes(inputType.toLowerCase())) continue;

      const labelMatch = attrs.match(/(?:label|aria-label|name|id)\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const label = labelMatch?.[1] || labelMatch?.[2] || '';
      const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2] || '';
      const fieldText = `${label} ${placeholder}`.trim();

      // Skip non-categorical fields entirely
      if (!fieldText || !U4_STRUCTURED_LABEL_RE.test(fieldText)) continue;
      if (U4_FREEFORM_LABEL_RE.test(fieldText)) continue;
      if (/optional/i.test(attrs)) continue;

      const lineNum = content.substring(0, m.index).split('\n').length;
      const nearbyContent = getSnippet(lineNum, 40);
      const mitigations: string[] = [];
      if (U4_SELECTION_RE.test(nearbyContent)) mitigations.push('selection_component_nearby');
      if (/autocomplete/i.test(attrs)) mitigations.push('autocomplete_present');

      // --- Confirmation-phrase suppression (hard) ---
      // If a free-text input is used for typed confirmation of a destructive action,
      // and the required phrase is visibly displayed, this is recognition/copying, not recall.
      const hasDestructiveContext = U4_CONFIRMATION_DESTRUCTIVE_RE.test(nearbyContent);
      const hasConfirmationInstruction = U4_CONFIRMATION_INSTRUCTION_RE.test(nearbyContent);
      const hasVisibleRequiredPhrase = U4_CONFIRMATION_PHRASE_VISIBLE_RE.test(nearbyContent);
      const isConfirmationPattern = hasDestructiveContext && (hasVisibleRequiredPhrase || hasConfirmationInstruction);
      if (isConfirmationPattern && hasVisibleRequiredPhrase) {
        console.log(`U4.1 SUPPRESSED (confirmation_phrase_visible) for "${fieldText}" in ${filePath}: nearby text contains visible confirmation phrase instruction`);
        continue; // Hard suppression — not a recognition→recall issue
      }

      // --- Extract nearby text and action context for enrichment ---
      const nearbyTextSnippets: string[] = [];
      const nearbyTextRe = />([^<]{3,80})</g;
      let ntm;
      let ntCount = 0;
      while ((ntm = nearbyTextRe.exec(nearbyContent)) !== null && ntCount < 6) {
        const txt = ntm[1].replace(/\{[^}]*\}/g, '').trim();
        if (txt.length >= 3 && !/^\s*$/.test(txt)) { nearbyTextSnippets.push(txt); ntCount++; }
      }
      const actionContextLabels: string[] = [];
      const actBtnRe = /<(?:Button|button)\b[^>]*>([^<]{2,40})<\/(?:Button|button)>/gi;
      let abm;
      while ((abm = actBtnRe.exec(nearbyContent)) !== null) {
        const btnLabel = abm[1].replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
        if (btnLabel.length >= 2) actionContextLabels.push(btnLabel);
      }

      // --- Known-set evidence detection ---
      let knownOptionsDetected = false;
      let knownOptionsExamples: string[] = [];
      const knownSetMatch = content.match(U4_KNOWN_SET_RE);
      if (knownSetMatch) {
        knownOptionsDetected = true;
        const arrayContent = knownSetMatch[1];
        const optionVals = arrayContent.match(/["'`]([^"'`]{1,40})["'`]/g);
        if (optionVals) knownOptionsExamples = optionVals.slice(0, 5).map(v => v.replace(/["'`]/g, ''));
        mitigations.push('known_options_in_code');
      }
      const enumMatch = content.match(U4_ENUM_RE);
      if (enumMatch && !knownOptionsDetected) {
        knownOptionsDetected = true;
        const enumContent = enumMatch[1];
        const enumVals = enumContent.match(/["'`]([^"'`]{1,40})["'`]/g);
        if (enumVals) knownOptionsExamples = enumVals.slice(0, 5).map(v => v.replace(/["'`]/g, ''));
        mitigations.push('enum_validation_in_code');
      }

      // --- Determine candidate kind ---
      let candidateKind: 'categorical_free_text' | 'confirmation_phrase' | 'unknown' = 'unknown';
      if (isConfirmationPattern && !hasVisibleRequiredPhrase) {
        candidateKind = 'confirmation_phrase'; // Destructive context + instruction but phrase not visibly shown — ambiguous
      } else {
        candidateKind = 'categorical_free_text';
      }

      // Build evidence text
      const evidenceText = knownOptionsDetected
        ? `User must recall valid values instead of selecting from a list/autocomplete. Known options exist in code (${knownOptionsExamples.slice(0, 3).join(', ')}${knownOptionsExamples.length > 3 ? '...' : ''}) but are not presented as a selection component.`
        : `Text input for categorical field "${fieldText.match(U4_STRUCTURED_LABEL_RE)?.[0] || ''}". User must recall valid values instead of selecting from a list/autocomplete. No known options array detected in code.`;

      candidates.push({
        candidateType: 'U4.1', elementLabel: `"${label || placeholder}" text input`,
        elementType: 'input', filePath, codeSnippet: getSnippet(lineNum, 8),
        nearbyHeadings: getHeadings(lineNum, 15), mitigationSignals: mitigations,
        rawEvidence: evidenceText,
        candidateKind, hasVisibleRequiredPhrase: false, knownOptionsDetected, knownOptionsExamples,
        nearbyText: nearbyTextSnippets, actionContext: actionContextLabels,
        fieldLabel: label, fieldPlaceholder: placeholder, inputType: inputType || 'text',
      });
    }

    // ---- U4.2 Candidates ----
    const ACTIVE_STATE_RE = /\b(bg-primary|bg-accent|aria-selected|aria-current|aria-pressed|isActive|isSelected|data-state\s*=\s*"active"|data-active|activeTab|selectedTab|currentTab|activeIndex|selectedIndex|variant\s*=.*default)\b/i;
    const COMPONENT_DEF_ACTIVE_RE = /data-\[state=active\]:|data-state\s*=\s*["']active["']|aria-selected|\.active\b|isActive|isSelected|&\[data-state="active"\]/i;

    // Helper: resolve import path for a component and check its definition for active state styling
    const resolveComponentActiveState = (componentNames: string[]): { found: boolean; sourceFile: string; evidence: string } => {
      // Find import statement for any of the component names
      for (const cName of componentNames) {
        const importRe = new RegExp(`import\\s+\\{[^}]*\\b${cName}\\b[^}]*\\}\\s+from\\s+['"]([@./][^'"]+)['"]`, 'i');
        const importMatch = content.match(importRe);
        if (!importMatch) continue;
        const importPath = importMatch[1];

        // Normalize import path to match allFiles keys
        const candidatePaths: string[] = [];
        if (importPath.startsWith('@/')) {
          const rel = importPath.slice(2);
          candidatePaths.push(`${rel}.tsx`, `${rel}.ts`, `${rel}/index.tsx`, `${rel}/index.ts`);
          candidatePaths.push(`src/${rel}.tsx`, `src/${rel}.ts`, `src/${rel}/index.tsx`, `src/${rel}/index.ts`);
        } else {
          // Relative import — resolve from current file's directory
          const fileDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
          const segments = importPath.replace(/^\.\//, '').split('/');
          let resolved = fileDir;
          for (const seg of segments) {
            if (seg === '..') resolved = resolved.includes('/') ? resolved.substring(0, resolved.lastIndexOf('/')) : '';
            else resolved = resolved ? `${resolved}/${seg}` : seg;
          }
          candidatePaths.push(`${resolved}.tsx`, `${resolved}.ts`, `${resolved}/index.tsx`, `${resolved}/index.ts`);
        }

        for (const cp of candidatePaths) {
          // Try exact match and also without leading src/
          for (const tryPath of [cp, cp.replace(/^src\//, '')]) {
            for (const [fPath, fContent] of allFiles) {
              const normalizedFPath = fPath.replace(/\\/g, '/').replace(/^\.\//, '');
              if (normalizedFPath === tryPath || normalizedFPath.endsWith('/' + tryPath) || normalizedFPath === 'src/' + tryPath) {
                if (COMPONENT_DEF_ACTIVE_RE.test(fContent)) {
                  return { found: true, sourceFile: normalizedFPath, evidence: `Component definition in ${normalizedFPath} includes active state styling (data-[state=active]: or similar)` };
                }
              }
            }
          }
        }
      }
      return { found: false, sourceFile: '', evidence: '' };
    };

    const selectionPatterns = [
      { re: /<(?:Tabs|TabsList|TabsTrigger)\b/gi, label: 'Tabs component', type: 'tab', resolveNames: ['TabsTrigger', 'Tabs', 'TabsList'] },
      { re: /<(?:ToggleGroup|ToggleGroupItem)\b/gi, label: 'Toggle group', type: 'toggle', resolveNames: ['ToggleGroupItem', 'ToggleGroup'] },
    ];
    for (const pat of selectionPatterns) {
      pat.re.lastIndex = 0;
      let pm;
      while ((pm = pat.re.exec(content)) !== null) {
        const lineNum = content.substring(0, pm.index).split('\n').length;
        const nearbyContent = getSnippet(lineNum, 20);
        const mitigations: string[] = [];
        if (ACTIVE_STATE_RE.test(nearbyContent)) mitigations.push('active_state_indicator');
        if (/className.*\b(active|selected)\b/i.test(nearbyContent)) mitigations.push('active_class');

        // Component-aware: resolve import and check component definition for active state
        const componentCheck = resolveComponentActiveState(pat.resolveNames);
        if (componentCheck.found) {
          mitigations.push('active_state_in_component_definition');
        }

        // SUPPRESS entirely if component definition provides active state styling
        if (mitigations.includes('active_state_in_component_definition')) {
          console.log(`U4.2 SUPPRESSED for ${pat.label} in ${filePath}: ${componentCheck.evidence}`);
          break; // Skip this candidate — active indicator is in the shared component
        }

        candidates.push({
          candidateType: 'U4.2', elementLabel: pat.label, elementType: pat.type, filePath,
          codeSnippet: getSnippet(lineNum, 10), nearbyHeadings: getHeadings(lineNum, 15),
          mitigationSignals: mitigations,
          rawEvidence: `${pat.label} detected. ${mitigations.length > 0 ? 'Active state signals: ' + mitigations.join(', ') : 'No active state indicator found within ±20 lines AND no active styling in resolved component definition.'}`,
        });
        break;
      }
    }

    // ---- U4.3 Candidates (Conservative multi-step detection) ----
    const STEP_INDEX_RE = /\b(step|currentStep|activeStep|stepIndex)\b\s*[=<>!]/i;
    if (STEP_INDEX_RE.test(content)) {
      // --- stepCount: derive ONLY from explicit sources ---
      let stepCount: number | 'unknown' = 'unknown';
      let stepCountSource: 'array' | 'stepper' | 'state-based' | 'unknown' = 'unknown';
      let stepLabels: string[] = [];

      // Source A: Explicit steps array with label properties
      const stepArrayMatch = content.match(/(?:steps|STEPS|stepsConfig|STEP_CONFIG)\s*=\s*\[([^\]]{10,})\]/s);
      if (stepArrayMatch) {
        const arrayContent = stepArrayMatch[1];
        // Count objects with label/title/name properties (user-visible steps)
        const labelMatches = arrayContent.match(/(?:label|title|name)\s*:\s*["'`]([^"'`]+)["'`]/gi);
        if (labelMatches && labelMatches.length >= 2) {
          stepCount = labelMatches.length;
          stepCountSource = 'array';
          stepLabels = labelMatches.map(lm => {
            const v = lm.match(/["'`]([^"'`]+)["'`]/);
            return v?.[1] || '';
          }).filter(Boolean);
        }
      }

      // Source B: Stepper/Progress component with multiple step items rendered in JSX
      if (stepCount === 'unknown') {
        const stepperItemRe = /<(?:Step|StepItem|StepTrigger|StepperItem)\b[^>]*>/gi;
        const stepperItems = content.match(stepperItemRe);
        if (stepperItems && stepperItems.length >= 2) {
          stepCount = stepperItems.length;
          stepCountSource = 'stepper';
        }
      }

      // Source C: Conditional render branches tied to a SINGLE step state variable
      if (stepCount === 'unknown') {
        // Only count step === N comparisons for the SAME variable
        for (const varName of ['step', 'currentStep', 'activeStep', 'stepIndex']) {
          const re = new RegExp(`\\b${varName}\\b\\s*===?\\s*(\\d+)`, 'g');
          const matches = content.match(re);
          if (matches) {
            const uniqueValues = new Set(matches.map(m => m.match(/(\d+)$/)?.[1]));
            if (uniqueValues.size >= 2 && uniqueValues.size <= 10) {
              stepCount = uniqueValues.size;
              stepCountSource = 'state-based';
              break;
            }
          }
        }
      }

      // Only proceed if we found evidence of a multi-step flow
      if (stepCount !== 'unknown' ? stepCount >= 2 : STEP_INDEX_RE.test(content)) {
        // --- hasStepIndicator: strong signals only ---
        let hasStepIndicator: boolean | 'unknown' = 'unknown';
        // Step labels rendered in horizontal nav/stepper
        if (stepLabels.length >= 2) hasStepIndicator = true;
        // Stepper/Progress components
        if (hasStepIndicator !== true && /<(?:Stepper|Steps|StepIndicator|StepList)\b/i.test(content)) hasStepIndicator = true;
        // "Step X of Y" text pattern
        if (hasStepIndicator !== true && /Step\s+\d+\s+of\s+\d+/i.test(content)) hasStepIndicator = true;
        if (hasStepIndicator !== true && /Step\s+\{[^}]*\}\s*(?:of|\/)\s*\{[^}]*\}/i.test(content)) hasStepIndicator = true;
        // aria-current="step" or role="tablist" used as step navigation
        if (hasStepIndicator !== true && /aria-current\s*=\s*["']step["']/i.test(content)) hasStepIndicator = true;
        if (hasStepIndicator !== true && /role\s*=\s*["']tablist["']/i.test(content) && STEP_INDEX_RE.test(content)) hasStepIndicator = true;
        // Rendered step labels (e.g., steps.map rendering label text in nav)
        if (hasStepIndicator !== true && /\.map\b[^)]*=>\s*[^)]*(?:step|s)\.(?:label|title|name)\b/i.test(content)) hasStepIndicator = true;
        // Ambiguous "progress" in className is NOT enough — leave as unknown

        // --- hasBackNav: robust detection ---
        let hasBackNav: boolean | 'unknown' = 'unknown';
        // Button/link with back label in JSX
        const backLabelRe = />\s*(Previous|Back|Go\s*[Bb]ack|Return)\s*</i;
        if (backLabelRe.test(content)) hasBackNav = true;
        // Also accept aria-label or title with back text on buttons
        if (hasBackNav !== true && /<(?:Button|button)\b[^>]*(?:aria-label|title)\s*=\s*["'](?:Previous|Back|Go\s*back|Return)["'][^>]*>/i.test(content)) hasBackNav = true;
        // Handler that decrements step state
        if (hasBackNav !== true && /\b(?:setStep|setCurrentStep|setActiveStep)\s*\(\s*(?:\w+\s*(?:=>|-)|\(\s*\w+\s*\)\s*=>)\s*\w+\s*-\s*1\b/i.test(content)) hasBackNav = true;
        if (hasBackNav !== true && /\bstep\s*-\s*1\b/i.test(content) && /\b(?:setStep|setCurrentStep|setActiveStep)\b/i.test(content)) hasBackNav = true;

        // --- persistentContext: conservative ---
        let persistentContext: boolean | 'unknown' = 'unknown';
        // Previous selections displayed on later steps
        if (/(?:selected(?:Location|Doctor|Service|Date|Time|Item|Plan|Option|Specialty|Provider|Slot)|chosen(?:Plan|Option|Service|Doctor|Location))\b/.test(content)) {
          // Check that these values are rendered in JSX (not just state declarations)
          if (/\{[^}]*selected(?:Location|Doctor|Service|Date|Time|Item|Plan|Option|Specialty|Provider|Slot)[^}]*\}/i.test(content)) {
            persistentContext = true;
          }
        }
        if (persistentContext !== true && /<(?:Breadcrumb|BreadcrumbItem|BreadcrumbLink)\b/i.test(content)) persistentContext = true;
        // Side panel or summary showing selections
        if (persistentContext !== true && /(?:summary|recap|overview|selected-items|selection-panel)\b/i.test(content) && /\{[^}]*selected/i.test(content)) persistentContext = true;

        // --- summaryStep: accurate ---
        let summaryStep: boolean | 'unknown' = 'unknown';
        const hasSummaryHeading = /(?:Review|Review\s*(?:&|and)\s*Confirm|Summary|Confirm\s*(?:&|and)\s*Book|Confirmation)\b/i.test(content);
        if (hasSummaryHeading) {
          // Check that selections are displayed in that context
          if (/\{[^}]*(?:selected|chosen|formData|appointmentData|bookingData)/i.test(content)) {
            summaryStep = true;
          } else {
            summaryStep = 'unknown';
          }
        } else {
          summaryStep = false;
        }

        // --- Pre-LLM suppression rules ---
        const shouldSuppress = (
          // Rule 1: step indicator + back nav = well-structured wizard
          (hasStepIndicator === true && hasBackNav === true) ||
          // Rule 2: persistent context + summary + back nav not false
          (persistentContext === true && summaryStep === true && hasBackNav !== false) ||
          // Rule 3: small wizard (≤4 steps) with step indicator
          (typeof stepCount === 'number' && stepCount <= 4 && hasStepIndicator === true)
        );

        if (shouldSuppress) {
          console.log(`U4.3 SUPPRESSED for ${filePath}: stepCount=${stepCount}, hasStepIndicator=${hasStepIndicator}, hasBackNav=${hasBackNav}, persistentContext=${persistentContext}, summaryStep=${summaryStep}`);
        } else {
          // Only send to LLM when evidence suggests missing mitigations
          const sendToLLM = (
            ((typeof stepCount === 'number' && stepCount >= 5) || stepCount === 'unknown') &&
            hasStepIndicator !== true &&
            persistentContext !== true
          );

          if (sendToLLM) {
            let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx)$/i, '') || '';
            const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
            if (exportedFn?.[1]) componentName = exportedFn[1];
            const stepLine = content.search(STEP_INDEX_RE);
            const lineNum = stepLine >= 0 ? content.substring(0, stepLine).split('\n').length : 1;

            candidates.push({
              candidateType: 'U4.3',
              elementLabel: `${componentName} (${stepCount === 'unknown' ? 'unknown' : stepCount}-step flow)`,
              elementType: 'wizard', filePath, codeSnippet: getSnippet(lineNum, 15),
              nearbyHeadings: getHeadings(lineNum, 20), mitigationSignals: [
                `stepCount=${stepCount} (source: ${stepCountSource})`,
                `hasStepIndicator=${hasStepIndicator}`,
                `hasBackNav=${hasBackNav}`,
                `persistentContext=${persistentContext}`,
                `summaryStep=${summaryStep}`,
                ...(stepLabels.length > 0 ? [`stepLabels: ${stepLabels.join(', ')}`] : []),
              ],
              rawEvidence: `Multi-step flow detected (stepCount=${stepCount}, source=${stepCountSource}). hasStepIndicator=${hasStepIndicator}, hasBackNav=${hasBackNav}, persistentContext=${persistentContext}, summaryStep=${summaryStep}. ${stepLabels.length > 0 ? 'Step labels: ' + stepLabels.join(', ') + '.' : ''} Not suppressed — sent to LLM for evaluation.`,
            });
          } else {
            console.log(`U4.3 NOT SENT TO LLM for ${filePath}: stepCount=${stepCount}, hasStepIndicator=${hasStepIndicator}, persistentContext=${persistentContext} — does not meet LLM send criteria.`);
          }
        }
      }
    }

    // ---- U4.4 Candidates ----
    const GENERIC_CTA_RE = /^(Next|Continue|Submit|Confirm|OK|Done|Proceed|Go|Save|Apply|Accept)$/i;
    const btnRe = /<(?:Button|button)\b[^>]*>([^<]{1,40})<\/(?:Button|button)>/gi;
    let bm;
    while ((bm = btnRe.exec(content)) !== null) {
      const label = bm[1].replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (!label || label.length < 2) continue;
      if (U4_STANDARD_AUTH_CTAS.test(label)) continue;
      if (!GENERIC_CTA_RE.test(label)) continue;

      const lineNum = content.substring(0, bm.index).split('\n').length;
      const nearby = getSnippet(lineNum, 10);
      const transitionsStep = /\b(setStep|nextStep|activeStep|step\s*\+|step\s*\+=)\b/i.test(nearby);
      const commitsData = /\b(onSubmit|handleSubmit|mutate|\.insert|\.update|fetch\(|axios)\b/i.test(nearby);
      if (!transitionsStep && !commitsData) continue;

      const headings = getHeadings(lineNum, 10);
      const mitigations: string[] = [];
      if (headings.length > 0) mitigations.push(`nearby_headings: ${headings.join(', ')}`);

      candidates.push({
        candidateType: 'U4.4', elementLabel: `"${label}" button`, elementType: 'button', filePath,
        codeSnippet: getSnippet(lineNum, 8), nearbyHeadings: headings, mitigationSignals: mitigations,
        rawEvidence: `Generic CTA "${label}". ${transitionsStep ? 'Transitions step.' : ''} ${commitsData ? 'Commits data.' : ''} ${headings.length > 0 ? 'Nearby headings: ' + headings.join(', ') : 'No nearby headings.'}`,
      });
    }
  }

  const seen = new Set<string>();
  return candidates.filter(c => {
    const key = `${c.filePath}|${c.candidateType}|${c.elementLabel}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function formatU4CandidatesForLLM(candidates: U4Candidate[]): string {
  if (candidates.length === 0) return '';
  const lines: string[] = [];
  lines.push('[U4_EVIDENCE_BUNDLE]');
  lines.push('CANDIDATE regions detected by static analysis. You MUST evaluate each and decide: REPORT or SUPPRESS.');
  lines.push('You are the SOLE decision maker. Do NOT auto-confirm. Status is ALWAYS "potential". Max confidence: 0.65.');
  lines.push('For each: (1) Does this reduce recognition-based interaction? (2) Is recall burden plausibly increased? (3) Are there visible mitigations? (4) Is semantic intent clearly categorical?');
  lines.push('If ANY answer uncertain → SUPPRESS.');
  lines.push('IMPORTANT: Confirmation-phrase inputs (e.g., "Type DELETE to confirm") where the required phrase is visible are NOT recognition→recall regressions. They are recognition/copying. SUPPRESS these.');
  lines.push('');
  for (const c of candidates) {
    lines.push(`--- ${c.candidateType} CANDIDATE ---`);
    lines.push(`Element: ${c.elementLabel} (${c.elementType})`);
    lines.push(`File: ${c.filePath}`);
    lines.push(`Evidence: ${c.rawEvidence}`);
    if (c.candidateKind) lines.push(`Candidate kind: ${c.candidateKind}`);
    if (c.knownOptionsDetected) lines.push(`Known options detected: true (examples: ${c.knownOptionsExamples?.join(', ') || 'N/A'})`);
    if (c.nearbyText && c.nearbyText.length > 0) lines.push(`Nearby text: ${c.nearbyText.join(' | ')}`);
    if (c.actionContext && c.actionContext.length > 0) lines.push(`Action context (buttons): ${c.actionContext.join(', ')}`);
    if (c.mitigationSignals.length > 0) lines.push(`Mitigations: ${c.mitigationSignals.join(', ')}`);
    if (c.nearbyHeadings.length > 0) lines.push(`Nearby headings: ${c.nearbyHeadings.join(', ')}`);
    lines.push(`Code:\n${c.codeSnippet.slice(0, 400)}`);
    lines.push('');
  }
  lines.push('[/U4_EVIDENCE_BUNDLE]');
  return lines.join('\n');
}

// ========== E1 EVIDENCE BUNDLE EXTRACTION (Insufficient Transparency in High-Impact Actions) ==========
interface E1EvidenceBundle {
  filePath: string;
  ctaLabel: string;
  ctaType: string; // 'destructive' | 'financial' | 'data-sharing'
  nearbyText: string[];
  hasConfirmationDialog: boolean;
  hasWarningText: boolean;
  hasPricingText: boolean;
  disclosureTermsFound: string[];
  frictionMechanisms: string[];
  suppressed: boolean;
  suppressionReason?: string;
  startLine?: number; // Line number of the UI trigger
  deleteLine?: number; // Line number of the DELETE request
  evidenceTokens: string[]; // Evidence tokens (DELETE method, handler name, label)
  detectionSource: 'label' | 'handler' | 'network' | 'icon'; // How was this detected
}

// Strict high-impact keyword list — excludes "reset", "accept", "agree" (too broad)
const E1_HIGH_IMPACT_KEYWORDS = /\b(delete|remove\s*account|close\s*account|permanently\s*delete|destroy|erase|cancel\s*(?:subscription|membership|plan|account)|subscribe|buy|purchase|pay\b|upgrade|checkout|confirm\s*(?:order|purchase|payment)|finalize|publish|authorize|grant\s*access|share\s*data|export\s*data|connect\s*account)\b/i;

// Destructive label keywords (broader than high-impact — covers "Remove", "Trash")
const E1_DESTRUCTIVE_LABEL_RE = /\b(delete|remove|trash|destroy|erase)\b/i;

// Auth-flow file path patterns — excluded from E1 unless destructive/billing keywords present
const E1_AUTH_FLOW_PATH = /(?:forgot.?password|reset.?password|sign.?in|sign.?up|login|register|auth|verify.?email|confirm.?email)/i;
// Auth-flow CTA labels to exclude
const E1_AUTH_EXCLUDED_LABELS = /\b(send\s*reset\s*link|reset\s*password|sign\s*in|sign\s*up|log\s*in|log\s*out|sign\s*out|register|create\s*account|verify\s*email|resend\s*code|resend\s*link)\b/i;
// Destructive/billing keywords that override auth-flow exclusion
const E1_OVERRIDE_IN_AUTH = /\b(delete|erase|destroy|permanently|purchase|pay\b|subscribe|checkout|billing)\b/i;

const E1_WARNING_WORDS = /\b(permanent|cannot\s*be\s*undone|irreversible|this\s*action|will\s*be\s*(?:deleted|removed|lost)|are\s*you\s*sure|caution|warning|permanently\s*(?:remove|delete|erase)|data\s*will\s*be\s*removed)\b/i;
const E1_PRICING_WORDS = /\b(\$\d|\€\d|\£\d|USD|EUR|per\s*month|\/mo|\/year|billing|subscription\s*(?:fee|cost|price)|free\s*trial|charged)\b/i;
// NOTE: "Dialog" alone is intentionally excluded — too broad (matches add/edit dialogs).
// Only dialog patterns explicitly tied to confirmation/deletion are included.
const E1_CONFIRMATION_PATTERNS = /\b(AlertDialog|confirm\s*\(|useConfirm|ConfirmDialog|ConfirmModal|DeleteConfirmDialog|DeleteDialog)\b/i;

// Two-step state flow confirmation patterns (setPendingDelete, setConfirmOpen, etc.)
const E1_TWO_STEP_STATE_RE = /\b(set(?:Pending|Confirm|ShowConfirm|DeleteConfirm|ConfirmOpen|ConfirmDelete|IsDeleting|ShowDelete|DeleteDialog)\s*\(|setPending\w*Delete\s*\(|setConfirm\w*\s*\(true\))/i;

// Network DELETE request patterns
const E1_NETWORK_DELETE_RE = /(?:fetch\s*\([^)]*[,{]\s*method\s*:\s*["']DELETE["']|\.delete\s*\(|apiRequest\s*\(\s*["']DELETE["']|method\s*:\s*["']DELETE["'])/i;

// Delete mutation / hook patterns
const E1_DELETE_MUTATION_RE = /\b(delete(?:Mutation|mutation)|useMutation\s*\(\s*\{[^}]*(?:method|DELETE))|mutationFn\s*:[^}]*(?:delete|remove|destroy)/i;

// Handler names indicating deletion
const E1_DELETE_HANDLER_RE = /\b(handle(?:Delete|Remove|Destroy)|on(?:Delete|Remove|Destroy)|delete(?:Item|Row|Record|Entry|User|Account|Doctor|Patient|Appointment|Data)|remove(?:Item|Row|Record|Entry)|destroy(?:Item|Row|Record))\b/i;

// Direct delete invocation in onClick (no intermediate confirmation state)
const E1_DIRECT_DELETE_INVOKE_RE = /(?:onClick|onSelect|onAction|onConfirm|onPress)\s*=\s*\{?\s*(?:\(\s*\)\s*=>|function\s*\(\s*\)\s*\{)?\s*(?:delete|remove|destroy|trash)\w*(?:\.\w+)?\s*\(/i;

// Undo / recovery patterns
const E1_UNDO_RECOVERY_RE = /\b(undo|restore|undelete|soft.?delete|archive(?:d)?|moved?\s*to\s*trash|trash.?(?:can|bin)|action\s*:\s*["']undo["']|toast\s*\([^)]*undo)/i;

// Strong disclosure terms — if found near CTA or in modal, disclosure is considered present
const E1_STRONG_DISCLOSURE_RE = /\b(cannot\s*be\s*undone|irreversible|permanent(?:ly)?|will\s*be\s*(?:deleted|removed|lost|erased)|this\s*(?:action|cannot)|data\s*will\s*be\s*removed|all\s*(?:your\s*)?data|appointments|messages|records|files)\b/gi;

// Friction mechanisms — typed confirmation, checkbox acknowledgement, double-confirm
const E1_FRICTION_TYPE_CONFIRM = /\b(type\s*["']?DELETE|type\s*["']?CONFIRM|type\s*to\s*confirm|enter\s*["']?delete)\b/i;
const E1_FRICTION_CHECKBOX = /(?:<(?:Checkbox|checkbox|input)\b[^>]*(?:type\s*=\s*["']checkbox["']))[^>]*(?:acknowledge|confirm|understand|agree|consent|irreversible|permanent)/i;
const E1_FRICTION_DOUBLE_CONFIRM = /(?:Are\s*you\s*(?:sure|certain)|Confirm\s*(?:deletion|removal|action)|This\s*will\s*permanently)/i;

function extractE1DisclosureTerms(text: string): string[] {
  const terms: string[] = [];
  E1_STRONG_DISCLOSURE_RE.lastIndex = 0;
  let m;
  while ((m = E1_STRONG_DISCLOSURE_RE.exec(text)) !== null) {
    const term = m[1].toLowerCase().trim();
    if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

function extractE1FrictionMechanisms(text: string): string[] {
  const mechanisms: string[] = [];
  if (E1_FRICTION_TYPE_CONFIRM.test(text)) mechanisms.push('type-to-confirm');
  if (E1_FRICTION_CHECKBOX.test(text)) mechanisms.push('checkbox');
  if (E1_FRICTION_DOUBLE_CONFIRM.test(text)) mechanisms.push('double-confirm');
  return mechanisms;
}

// Detect confirmation gates in a file: AlertDialog, confirm(), two-step state, disabled-until-confirm, etc.
function detectE1ConfirmationGate(content: string): { hasGate: boolean; gateType: string } {
  const confirmMatch = content.match(E1_CONFIRMATION_PATTERNS);
  if (confirmMatch) {
    return { hasGate: true, gateType: confirmMatch[1] || 'confirmation-dialog' };
  }
  if (E1_TWO_STEP_STATE_RE.test(content)) {
    return { hasGate: true, gateType: 'two-step-state' };
  }
  if (/\bwindow\.confirm\s*\(/i.test(content) || /\bconfirm\s*\(\s*["'`]/i.test(content)) {
    return { hasGate: true, gateType: 'window.confirm' };
  }
  // Disabled-until-confirm gate: button disabled={!confirmState} or disabled={confirmState === false}
  // Allow compound conditions like disabled={!confirmState || isPending}
  // Only match when the state variable name implies confirmation intent
  const disabledConfirmMatch = content.match(/disabled=\{[^}]*!(\w*(?:confirm|acknowledge|accept|agreed|checked|consent)\w*)[^}]*\}/i)
    || content.match(/disabled=\{[^}]*(\w*(?:confirm|acknowledge|accept|agreed|checked|consent)\w*)\s*===\s*false[^}]*\}/i);
  if (disabledConfirmMatch) {
    return { hasGate: true, gateType: `disabled-until-confirm (${disabledConfirmMatch[1]})` };
  }
  // Checkbox/toggle that updates a confirmation state variable
  if (/(?:onCheckedChange|onChange)[=\s{]*(?:set\w*(?:confirm|acknowledge|accept|agreed|checked|consent)\w*)/i.test(content)) {
    return { hasGate: true, gateType: 'checkbox-confirm-gate' };
  }
  // Conditional execution gated by confirm state: confirmState && deleteAction()
  if (/\b(\w*(?:confirm|acknowledge|accept|agreed|checked|consent)\w*)\s*&&\s*\w*(?:delete|remove|destroy)\w*\s*[.(]/i.test(content)) {
    return { hasGate: true, gateType: 'conditional-confirm-gate' };
  }
  // Type-to-confirm gate: "Type DELETE to confirm", input comparing against 'DELETE'/'CONFIRM'
  if (E1_FRICTION_TYPE_CONFIRM.test(content)) {
    return { hasGate: true, gateType: 'type-to-confirm' };
  }
  // String-comparison disabled gate: disabled={confirmation !== 'DELETE'} or disabled={confirmText !== "DELETE"}
  const comparisonDisabledMatch = content.match(/disabled=\{[^}]*(\w*(?:confirm|acknowledge|verification|delete)\w*)\s*!==\s*["'`](?:DELETE|CONFIRM|delete|confirm)["'`][^}]*\}/i);
  if (comparisonDisabledMatch) {
    return { hasGate: true, gateType: `disabled-until-confirm (${comparisonDisabledMatch[1]})` };
  }
  // Handler guard: if (confirmation !== 'DELETE') return
  if (/if\s*\(\s*\w*(?:confirm|verification)\w*\s*!==\s*["'`](?:DELETE|CONFIRM)["'`]\s*\)\s*return/i.test(content)) {
    return { hasGate: true, gateType: 'handler-guard' };
  }
  return { hasGate: false, gateType: '' };
}

// Detect recovery/undo mechanisms
function detectE1Recovery(content: string): { hasRecovery: boolean; recoveryType: string } {
  if (E1_UNDO_RECOVERY_RE.test(content)) {
    const m = content.match(E1_UNDO_RECOVERY_RE);
    return { hasRecovery: true, recoveryType: m?.[1] || 'undo' };
  }
  // Soft-delete API endpoints
  if (/\/archive\b|\/disable\b|\/deactivate\b/i.test(content) && !E1_DESTRUCTIVE_LABEL_RE.test(content.match(/<(?:Button|button)[^>]*>([^<]*)<\//)?.[1] || '')) {
    return { hasRecovery: true, recoveryType: 'soft-delete-endpoint' };
  }
  return { hasRecovery: false, recoveryType: '' };
}

// Check if a handler name is connected to a confirmation gate (same scope)
function isHandlerGatedByConfirmation(handlerName: string, content: string): boolean {
  // Check if the handler sets a confirmation state before executing
  const handlerBodyRe = new RegExp(`(?:function\\s+${handlerName}|const\\s+${handlerName}\\s*=)\\s*(?:\\([^)]*\\)\\s*(?:=>|\\{)|\\{)([\\s\\S]{0,500})`, 'i');
  const bodyMatch = content.match(handlerBodyRe);
  if (bodyMatch) {
    const body = bodyMatch[1];
    // If the handler sets confirmation state, it's gated
    if (E1_TWO_STEP_STATE_RE.test(body)) return true;
    // If the handler calls confirm()
    if (/\bconfirm\s*\(/i.test(body)) return true;
  }
  return false;
}

function extractE1EvidenceBundle(allFiles: Map<string, string>): E1EvidenceBundle[] {
  const bundles: E1EvidenceBundle[] = [];
  const seenKeys = new Set<string>();

  // ── Debug counters ──
  let e1FilesScanned = 0;
  let e1CandidatesLabel = 0;
  let e1CandidatesHandler = 0;
  let e1CandidatesNetwork = 0;
  let e1CandidatesIcon = 0;
  let e1SuppressedConfirmGate = 0;
  let e1SuppressedRecovery = 0;
  let e1SuppressedDisclosure = 0;
  let e1SuppressedAuth = 0;
  let e1Emitted = 0;

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|ts|js|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    e1FilesScanned++;

    // AUTH-FLOW EXCLUSION
    const isAuthFlow = E1_AUTH_FLOW_PATH.test(filePath);
    if (isAuthFlow && !E1_OVERRIDE_IN_AUTH.test(content)) {
      e1SuppressedAuth++;
      console.log(`E1 SUPPRESSED (auth-flow file, no destructive/billing override): ${filePath}`);
      continue;
    }

    const lines = content.split('\n');
    const getLineNumber = (index: number) => content.slice(0, index).split('\n').length;

    // File-level: only collect network DELETE info (needed for evidence, NOT for suppression)
    const hasNetworkDelete = E1_NETWORK_DELETE_RE.test(content) || E1_DELETE_MUTATION_RE.test(content);
    let networkDeleteLine: number | undefined;
    if (hasNetworkDelete) {
      for (let i = 0; i < lines.length; i++) {
        if (E1_NETWORK_DELETE_RE.test(lines[i]) || E1_DELETE_MUTATION_RE.test(lines[i])) {
          networkDeleteLine = i + 1;
          break;
        }
      }
    }

    // ── DETECTION A: UI button labels with delete/high-impact keywords ──
    const btnRe = /<(?:Button|button|a)\b([^>]*)>([^<]{1,80})<\/(?:Button|button|a)>/gi;
    let bm;
    while ((bm = btnRe.exec(content)) !== null) {
      const attrs = bm[1] || '';
      const label = bm[2].replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (!label || label.length < 2) continue;

      // Skip explicitly excluded auth labels
      if (E1_AUTH_EXCLUDED_LABELS.test(label)) continue;
      if (!E1_HIGH_IMPACT_KEYWORDS.test(label) && !E1_HIGH_IMPACT_KEYWORDS.test(attrs)) continue;

      e1CandidatesLabel++;
      const triggerLine = getLineNumber(bm.index);
      const dedupeKey = `E1|${filePath}|${label.toLowerCase()}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      // Classify CTA type
      let ctaType = 'destructive';
      if (/\b(subscribe|buy|purchase|pay|upgrade|checkout)\b/i.test(label)) ctaType = 'financial';
      if (/\b(share\s*data|export\s*data|grant\s*access|connect\s*account|authorize)\b/i.test(label)) ctaType = 'data-sharing';

      // FLOW-LOCAL region: ~500 chars around the trigger for suppression checks
      const regionStart = Math.max(0, bm.index - 500);
      const regionEnd = Math.min(content.length, bm.index + bm[0].length + 500);
      const region = content.slice(regionStart, regionEnd);
      const nearbyText = extractNearbyText(region);

      const hasWarningText = E1_WARNING_WORDS.test(region);
      const hasPricingText = E1_PRICING_WORDS.test(region);

      // Evidence tokens
      const evidenceTokens: string[] = [];
      if (E1_DESTRUCTIVE_LABEL_RE.test(label)) evidenceTokens.push(`label:"${label}"`);
      if (hasNetworkDelete) evidenceTokens.push('DELETE method');

      // Extract handler name from onClick
      const handlerMatch = attrs.match(/onClick\s*=\s*\{?\s*(?:\(\)\s*=>\s*)?(\w+)/);
      if (handlerMatch) evidenceTokens.push(`handler:${handlerMatch[1]}`);

      // FLOW-LOCAL suppression: gate/recovery scoped to region around this trigger
      const localConfirmGate = detectE1ConfirmationGate(region);
      const localRecovery = detectE1Recovery(region);
      const localDisclosure = extractE1DisclosureTerms(region);
      const localFriction = extractE1FrictionMechanisms(region);

      // FILE-LEVEL FALLBACK: if local check misses gate/disclosure, check full file
      // (confirmation modal + disclosure text may be far from the button label)
      const fileLevelGateLbl = !localConfirmGate.hasGate ? detectE1ConfirmationGate(content) : localConfirmGate;
      const fileLevelDisclosureLbl = localDisclosure.length === 0 ? extractE1DisclosureTerms(content) : localDisclosure;
      const fileLevelFrictionLbl = localFriction.length === 0 ? extractE1FrictionMechanisms(content) : localFriction;
      const effectiveGateLbl = localConfirmGate.hasGate ? localConfirmGate : fileLevelGateLbl;
      const effectiveDisclosureLbl = localDisclosure.length > 0 ? localDisclosure : fileLevelDisclosureLbl;
      const effectiveFrictionLbl = localFriction.length > 0 ? localFriction : fileLevelFrictionLbl;

      const suppressResult = shouldSuppressE1Bundle({
        label, filePath, content, confirmGate: effectiveGateLbl, recovery: localRecovery,
        hasStrongDisclosure: effectiveDisclosureLbl.length > 0, disclosureTermsFound: effectiveDisclosureLbl, frictionMechanisms: effectiveFrictionLbl,
        handlerName: handlerMatch?.[1],
      });

      if (suppressResult.suppressed) {
        if (suppressResult.reason.includes('recovery')) e1SuppressedRecovery++;
        else if (suppressResult.reason.includes('disclosure')) e1SuppressedDisclosure++;
        else e1SuppressedConfirmGate++;
        console.log(`E1 SUPPRESSED (label): "${label}" in ${filePath}:${triggerLine} — ${suppressResult.reason}`);
        continue;
      }

      e1Emitted++;
      bundles.push({
        filePath, ctaLabel: label, ctaType,
        nearbyText: [...new Set(nearbyText)].slice(0, 6),
        hasConfirmationDialog: localConfirmGate.hasGate,
        hasWarningText, hasPricingText,
        disclosureTermsFound: localDisclosure, frictionMechanisms: localFriction,
        suppressed: false,
        startLine: triggerLine,
        deleteLine: networkDeleteLine,
        evidenceTokens,
        detectionSource: 'label',
      });
    }

    // ── DETECTION A (icon buttons): aria-label/title on icon buttons ──
    const iconBtnRe = /<(?:Button|button)\b([^>]*(?:aria-label|title)\s*=\s*(?:"([^"]+)"|'([^']+)'))[^>]*(?:\/>|>[^<]*<\/(?:Button|button)>)/gi;
    let ibm;
    while ((ibm = iconBtnRe.exec(content)) !== null) {
      const label = ibm[2] || ibm[3] || '';
      if (!label || !E1_HIGH_IMPACT_KEYWORDS.test(label)) continue;
      if (E1_AUTH_EXCLUDED_LABELS.test(label)) continue;

      e1CandidatesIcon++;
      const dedupeKey = `E1|${filePath}|${label.toLowerCase()}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      const triggerLine = getLineNumber(ibm.index);

      let ctaType = 'destructive';
      if (/\b(subscribe|buy|purchase|pay|upgrade|checkout)\b/i.test(label)) ctaType = 'financial';

      const evidenceTokens: string[] = [`icon-label:"${label}"`];
      if (hasNetworkDelete) evidenceTokens.push('DELETE method');

      // FLOW-LOCAL: scope suppression to region around this icon button
      const iconRegionStart = Math.max(0, ibm.index - 500);
      const iconRegionEnd = Math.min(content.length, ibm.index + 500);
      const iconRegion = content.slice(iconRegionStart, iconRegionEnd);
      const localConfirmGate = detectE1ConfirmationGate(iconRegion);
      const localRecovery = detectE1Recovery(iconRegion);
      const localDisclosure = extractE1DisclosureTerms(iconRegion);
      const localFriction = extractE1FrictionMechanisms(iconRegion);

      // FILE-LEVEL FALLBACK for icon channel
      const fileLevelGateIcon = !localConfirmGate.hasGate ? detectE1ConfirmationGate(content) : localConfirmGate;
      const fileLevelDisclosureIcon = localDisclosure.length === 0 ? extractE1DisclosureTerms(content) : localDisclosure;
      const fileLevelFrictionIcon = localFriction.length === 0 ? extractE1FrictionMechanisms(content) : localFriction;
      const effectiveGateIcon = localConfirmGate.hasGate ? localConfirmGate : fileLevelGateIcon;
      const effectiveDisclosureIcon = localDisclosure.length > 0 ? localDisclosure : fileLevelDisclosureIcon;
      const effectiveFrictionIcon = localFriction.length > 0 ? localFriction : fileLevelFrictionIcon;

      const suppressResult = shouldSuppressE1Bundle({
        label, filePath, content, confirmGate: effectiveGateIcon, recovery: localRecovery,
        hasStrongDisclosure: effectiveDisclosureIcon.length > 0, disclosureTermsFound: effectiveDisclosureIcon, frictionMechanisms: effectiveFrictionIcon,
      });
      if (suppressResult.suppressed) {
        if (suppressResult.reason.includes('recovery')) e1SuppressedRecovery++;
        else if (suppressResult.reason.includes('disclosure')) e1SuppressedDisclosure++;
        else e1SuppressedConfirmGate++;
        console.log(`E1 SUPPRESSED (icon): "${label}" in ${filePath}:${triggerLine} — ${suppressResult.reason}`);
        continue;
      }

      e1Emitted++;
      bundles.push({
        filePath, ctaLabel: label, ctaType,
        nearbyText: [],
        hasConfirmationDialog: localConfirmGate.hasGate,
        hasWarningText: false, hasPricingText: false,
        disclosureTermsFound: localDisclosure, frictionMechanisms: localFriction,
        suppressed: false,
        startLine: triggerLine,
        deleteLine: networkDeleteLine,
        evidenceTokens,
        detectionSource: 'icon',
      });
    }

    // ── DETECTION B: Handler-based deletion (onClick={() => deleteMutation.mutate(id)}) ──
    if (/\.(tsx|jsx)$/.test(filePath)) {
      const directInvokeRe = /(?:onClick|onSelect|onAction|onConfirm|onPress)\s*=\s*\{[^}]{0,200}?\b(delete|remove|destroy|trash)\w*(?:\.\w+)?\s*\(/gi;
      let dim;
      while ((dim = directInvokeRe.exec(content)) !== null) {
        e1CandidatesHandler++;
        const triggerLine = getLineNumber(dim.index);
        const handlerSnippet = dim[0];
        const surroundStart = Math.max(0, dim.index - 300);
        const surroundEnd = Math.min(content.length, dim.index + 300);
        const surroundRegion = content.slice(surroundStart, surroundEnd);

        const nearbyLabelMatch = surroundRegion.match(/>([^<]{2,40}(?:Delete|Remove|Trash|Destroy)[^<]{0,20})<\//i)
          || surroundRegion.match(/<(?:Button|button)[^>]*>([^<]{2,40})<\//i);
        const inferredLabel = nearbyLabelMatch?.[1]?.trim() || `${dim[1]}() action`;

        const dedupeKey = `E1|${filePath}|handler|${inferredLabel.toLowerCase()}|${triggerLine}`;
        if (seenKeys.has(dedupeKey)) continue;
        const labelDedupeKey = `E1|${filePath}|${inferredLabel.toLowerCase()}`;
        if (seenKeys.has(labelDedupeKey)) continue;
        seenKeys.add(dedupeKey);

        const evidenceTokens: string[] = [`handler:${dim[1]}`, `trigger:${handlerSnippet.slice(0, 40)}`];
        if (hasNetworkDelete) evidenceTokens.push('DELETE method');

        // FLOW-LOCAL suppression scoped to handler region
        const localConfirmGate = detectE1ConfirmationGate(surroundRegion);
        const localRecovery = detectE1Recovery(surroundRegion);
        const localDisclosure = extractE1DisclosureTerms(surroundRegion);
        const localFriction = extractE1FrictionMechanisms(surroundRegion);

        // FILE-LEVEL FALLBACK for handler channel
        const fileLevelGateHdl = !localConfirmGate.hasGate ? detectE1ConfirmationGate(content) : localConfirmGate;
        const fileLevelDisclosureHdl = localDisclosure.length === 0 ? extractE1DisclosureTerms(content) : localDisclosure;
        const fileLevelFrictionHdl = localFriction.length === 0 ? extractE1FrictionMechanisms(content) : localFriction;
        const effectiveGateHdl = localConfirmGate.hasGate ? localConfirmGate : fileLevelGateHdl;
        const effectiveDisclosureHdl = localDisclosure.length > 0 ? localDisclosure : fileLevelDisclosureHdl;
        const effectiveFrictionHdl = localFriction.length > 0 ? localFriction : fileLevelFrictionHdl;

        const suppressResult = shouldSuppressE1Bundle({
          label: inferredLabel, filePath, content, confirmGate: effectiveGateHdl, recovery: localRecovery,
          hasStrongDisclosure: effectiveDisclosureHdl.length > 0, disclosureTermsFound: effectiveDisclosureHdl, frictionMechanisms: effectiveFrictionHdl,
          handlerName: dim[1],
        });
        if (suppressResult.suppressed) {
          if (suppressResult.reason.includes('recovery')) e1SuppressedRecovery++;
          else if (suppressResult.reason.includes('disclosure')) e1SuppressedDisclosure++;
          else e1SuppressedConfirmGate++;
          console.log(`E1 SUPPRESSED (handler): "${inferredLabel}" in ${filePath}:${triggerLine} — ${suppressResult.reason}`);
          continue;
        }

        e1Emitted++;
        bundles.push({
          filePath, ctaLabel: inferredLabel, ctaType: 'destructive',
          nearbyText: extractNearbyText(surroundRegion).slice(0, 4),
          hasConfirmationDialog: localConfirmGate.hasGate,
          hasWarningText: E1_WARNING_WORDS.test(surroundRegion),
          hasPricingText: false,
          disclosureTermsFound: localDisclosure, frictionMechanisms: localFriction,
          suppressed: false,
          startLine: triggerLine,
          deleteLine: networkDeleteLine,
          evidenceTokens,
          detectionSource: 'handler',
        });
      }

      // ── DETECTION C: Trash icon + delete handler combination ──
      const trashIconRe = /<(?:Trash|Trash2|TrashIcon)\b[^/]*\/>/gi;
      let tim;
      while ((tim = trashIconRe.exec(content)) !== null) {
        const contextStart = Math.max(0, tim.index - 200);
        const contextEnd = Math.min(content.length, tim.index + 200);
        const iconContext = content.slice(contextStart, contextEnd);

        if (!E1_DELETE_HANDLER_RE.test(iconContext) && !E1_DIRECT_DELETE_INVOKE_RE.test(iconContext)) continue;

        e1CandidatesIcon++;
        const triggerLine = getLineNumber(tim.index);
        const inferredLabel = 'Trash icon (delete action)';

        const dedupeKey = `E1|${filePath}|trash-icon|${triggerLine}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        const evidenceTokens: string[] = ['Trash icon', 'delete handler'];
        if (hasNetworkDelete) evidenceTokens.push('DELETE method');

        // FLOW-LOCAL suppression
        const localConfirmGate = detectE1ConfirmationGate(iconContext);
        const localRecovery = detectE1Recovery(iconContext);
        const localDisclosure = extractE1DisclosureTerms(iconContext);
        const localFriction = extractE1FrictionMechanisms(iconContext);

        // FILE-LEVEL FALLBACK for trash-icon channel
        const fileLevelGateTrsh = !localConfirmGate.hasGate ? detectE1ConfirmationGate(content) : localConfirmGate;
        const fileLevelDisclosureTrsh = localDisclosure.length === 0 ? extractE1DisclosureTerms(content) : localDisclosure;
        const fileLevelFrictionTrsh = localFriction.length === 0 ? extractE1FrictionMechanisms(content) : localFriction;
        const effectiveGateTrsh = localConfirmGate.hasGate ? localConfirmGate : fileLevelGateTrsh;
        const effectiveDisclosureTrsh = localDisclosure.length > 0 ? localDisclosure : fileLevelDisclosureTrsh;
        const effectiveFrictionTrsh = localFriction.length > 0 ? localFriction : fileLevelFrictionTrsh;

        const suppressResult = shouldSuppressE1Bundle({
          label: inferredLabel, filePath, content, confirmGate: effectiveGateTrsh, recovery: localRecovery,
          hasStrongDisclosure: effectiveDisclosureTrsh.length > 0, disclosureTermsFound: effectiveDisclosureTrsh, frictionMechanisms: effectiveFrictionTrsh,
        });
        if (suppressResult.suppressed) {
          if (suppressResult.reason.includes('recovery')) e1SuppressedRecovery++;
          else if (suppressResult.reason.includes('disclosure')) e1SuppressedDisclosure++;
          else e1SuppressedConfirmGate++;
          console.log(`E1 SUPPRESSED (trash-icon): ${filePath}:${triggerLine} — ${suppressResult.reason}`);
          continue;
        }

        e1Emitted++;
        bundles.push({
          filePath, ctaLabel: inferredLabel, ctaType: 'destructive',
          nearbyText: [],
          hasConfirmationDialog: localConfirmGate.hasGate,
          hasWarningText: false, hasPricingText: false,
          disclosureTermsFound: localDisclosure, frictionMechanisms: localFriction,
          suppressed: false,
          startLine: triggerLine,
          deleteLine: networkDeleteLine,
          evidenceTokens,
          detectionSource: 'handler',
        });
      }
    }

    // ── DETECTION D (network): DELETE request with handler not gated ──
    if (hasNetworkDelete && /\.(tsx|jsx)$/.test(filePath)) {
      // FILE-LEVEL non-modal gate check: for network channel, confirmation gates
      // (disabled-until-confirm, checkbox, conditional) may be in JSX far from handler.
      // These are inherently linked to the same deletion flow within the same component file.
      const fileLevelGate = detectE1ConfirmationGate(content);
      const fileLevelIsNonModalGate = fileLevelGate.hasGate &&
        /disabled-until-confirm|checkbox-confirm-gate|conditional-confirm-gate|two-step-state|type-to-confirm|handler-guard/i.test(fileLevelGate.gateType);

      const deleteHandlerRe = /(?:const|function)\s+(handle(?:Delete|Remove|Destroy)|(?:delete|remove|destroy)\w+)\s*=\s*(?:async\s*)?\(?/gi;
      let dhm;
      while ((dhm = deleteHandlerRe.exec(content)) !== null) {
        e1CandidatesNetwork++;
        const handlerName = dhm[1];
        const handlerLine = getLineNumber(dhm.index);

        // Skip if handler is already gated by two-step state in handler body
        if (isHandlerGatedByConfirmation(handlerName, content)) {
          e1SuppressedConfirmGate++;
          console.log(`E1 SUPPRESSED (network/handler-gated): "${handlerName}" in ${filePath}:${handlerLine}`);
          continue;
        }

        // Check handler body for direct DELETE call
        const afterHandler = content.slice(dhm.index, Math.min(content.length, dhm.index + 500));
        if (!E1_NETWORK_DELETE_RE.test(afterHandler) && !E1_DELETE_MUTATION_RE.test(afterHandler)) {
          if (!/\.mutate\s*\(|\.mutateAsync\s*\(/i.test(afterHandler)) continue;
        }

        const inferredLabel = `${handlerName}() network DELETE`;
        const dedupeKey = `E1|${filePath}|network|${handlerName.toLowerCase()}`;
        if (seenKeys.has(dedupeKey)) continue;
        const anyExisting = bundles.some(b => b.filePath === filePath &&
          (b.ctaLabel.toLowerCase().includes(handlerName.toLowerCase().replace('handle', '').replace('delete', 'delete')) ||
           b.evidenceTokens.some(t => t.includes(handlerName))));
        if (anyExisting) continue;
        seenKeys.add(dedupeKey);

        const evidenceTokens: string[] = [`handler:${handlerName}`, 'DELETE method'];

        // FLOW-LOCAL: check region around handler definition
        const handlerRegionStart = Math.max(0, dhm.index - 300);
        const handlerRegionEnd = Math.min(content.length, dhm.index + 600);
        const handlerRegion = content.slice(handlerRegionStart, handlerRegionEnd);
        const localConfirmGate = detectE1ConfirmationGate(handlerRegion);
        const localRecovery = detectE1Recovery(handlerRegion);
        const localDisclosure = extractE1DisclosureTerms(handlerRegion);
        const localFriction = extractE1FrictionMechanisms(handlerRegion);

        // For network channel: use file-level non-modal gate as fallback when flow-local doesn't find it
        const effectiveGate = localConfirmGate.hasGate ? localConfirmGate
          : fileLevelIsNonModalGate ? fileLevelGate
          : localConfirmGate;
        const effectiveDisclosure = localDisclosure.length > 0 ? localDisclosure : extractE1DisclosureTerms(content);

        const suppressResult = shouldSuppressE1Bundle({
          label: inferredLabel, filePath, content, confirmGate: effectiveGate, recovery: localRecovery,
          hasStrongDisclosure: effectiveDisclosure.length > 0, disclosureTermsFound: effectiveDisclosure, frictionMechanisms: localFriction,
          handlerName,
        });
        if (suppressResult.suppressed) {
          if (suppressResult.reason.includes('recovery')) e1SuppressedRecovery++;
          else if (suppressResult.reason.includes('disclosure')) e1SuppressedDisclosure++;
          else e1SuppressedConfirmGate++;
          console.log(`E1 SUPPRESSED (network): "${handlerName}" in ${filePath}:${handlerLine} — ${suppressResult.reason}`);
          continue;
        }

        e1Emitted++;
        bundles.push({
          filePath, ctaLabel: inferredLabel, ctaType: 'destructive',
          nearbyText: [],
          hasConfirmationDialog: false,
          hasWarningText: false, hasPricingText: false,
          disclosureTermsFound: localDisclosure, frictionMechanisms: localFriction,
          suppressed: false,
          startLine: handlerLine,
          deleteLine: networkDeleteLine,
          evidenceTokens,
          detectionSource: 'network',
        });
      }
    }
  }

  // ── Debug summary ──
  console.log(`[E1 DEBUG] files=${e1FilesScanned} candidates: label=${e1CandidatesLabel} handler=${e1CandidatesHandler} network=${e1CandidatesNetwork} icon=${e1CandidatesIcon}`);
  console.log(`[E1 DEBUG] suppressed: confirmGate=${e1SuppressedConfirmGate} recovery=${e1SuppressedRecovery} disclosure=${e1SuppressedDisclosure} auth=${e1SuppressedAuth}`);
  console.log(`[E1 DEBUG] emitted=${e1Emitted} bundles=${bundles.length}`);

  return bundles.slice(0, 30);
}

// Helper: extract nearby text from a region
function extractNearbyText(region: string): string[] {
  const nearbyText: string[] = [];
  const hRe = /<h([1-6])\b[^>]*>([^<]{2,80})<\/h\1>/gi;
  let hm;
  while ((hm = hRe.exec(region)) !== null) {
    nearbyText.push(`h${hm[1]}: ${hm[2].replace(/\{[^}]*\}/g, '').trim()}`);
  }
  const pRe = /<(?:p|span|div|label)\b[^>]*>([^<]{3,150})<\/(?:p|span|div|label)>/gi;
  let pm;
  while ((pm = pRe.exec(region)) !== null) {
    const text = pm[1].replace(/\{[^}]*\}/g, '').trim();
    if (text.length >= 3 && text.length <= 150) nearbyText.push(text);
  }
  return nearbyText;
}

// Unified suppression logic for E1 bundles
// NOTE: confirmGate and recovery are now FLOW-LOCAL (scoped to region around trigger),
// NOT file-level. This prevents unrelated Dialog/AlertDialog from suppressing candidates.
function shouldSuppressE1Bundle(opts: {
  label: string;
  filePath: string;
  content: string;
  confirmGate: { hasGate: boolean; gateType: string };
  recovery: { hasRecovery: boolean; recoveryType: string };
  hasStrongDisclosure: boolean;
  disclosureTermsFound: string[];
  frictionMechanisms: string[];
  handlerName?: string;
}): { suppressed: boolean; reason: string } {
  const { label, content, confirmGate, recovery, hasStrongDisclosure, disclosureTermsFound, frictionMechanisms, handlerName } = opts;

  // Recovery suppression (undo/restore/soft-delete) — flow-local
  if (recovery.hasRecovery) {
    return { suppressed: true, reason: `recovery mechanism detected: ${recovery.recoveryType}` };
  }

  // Confirmation gate + disclosure pass-through — flow-local
  if (confirmGate.hasGate && hasStrongDisclosure) {
    const labelMentionsAction = E1_DESTRUCTIVE_LABEL_RE.test(label);
    if (labelMentionsAction) {
      return { suppressed: true, reason: `label ("${label}") + disclosure (${disclosureTermsFound.slice(0, 3).join(', ')}) + ${confirmGate.gateType}` };
    }
    if (frictionMechanisms.length > 0) {
      return { suppressed: true, reason: `disclosure + ${confirmGate.gateType} + friction (${frictionMechanisms.join(', ')})` };
    }
    return { suppressed: true, reason: `disclosure (${disclosureTermsFound.slice(0, 3).join(', ')}) + ${confirmGate.gateType}` };
  }

  // Confirmation gate alone — only suppress if handler is specifically gated
  if (confirmGate.hasGate) {
    if (handlerName && isHandlerGatedByConfirmation(handlerName, content)) {
      return { suppressed: true, reason: `handler ${handlerName} is gated by confirmation state` };
    }
    // Friction mechanisms in the local region = strong local gate
    if (frictionMechanisms.length > 0) {
      return { suppressed: true, reason: `${confirmGate.gateType} + friction (${frictionMechanisms.join(', ')}) in local scope` };
    }
   // Non-modal gate types always suppress when present (they are inherently linked to the deletion flow)
    if (/disabled-until-confirm|conditional-confirm-gate|checkbox-confirm-gate|type-to-confirm|handler-guard/i.test(confirmGate.gateType)) {
      return { suppressed: true, reason: `non-modal confirmation gate: ${confirmGate.gateType}` };
    }
    // Destructive label + explicit confirmation pattern in LOCAL region = suppress
    if (E1_DESTRUCTIVE_LABEL_RE.test(label) && /AlertDialog|ConfirmDialog|DeleteConfirmDialog|two-step-state/i.test(confirmGate.gateType)) {
      return { suppressed: true, reason: `destructive label + ${confirmGate.gateType} in local scope` };
    }
  }

  return { suppressed: false, reason: '' };
}

// ========== E2 CHOICE BUNDLE EXTRACTION (Imbalanced Choice Architecture — v2 with High-Impact Gate + Signal Scoring) ==========

// High-impact domain keywords that MUST be present nearby for E2 to evaluate a choice cluster.
const E2_HIGH_IMPACT_KEYWORDS_RE = /\b(accept|decline|cookie|consent|tracking|personalization|privacy|data|share|subscribe|trial|upgrade|buy|purchase|payment|card|delete|remove|cancel\s*plan|confirm|submit|discharge|book\s*appointment|final|cannot\s*be\s*undone)\b/gi;

// Exclusion patterns — standard nav/auth that should NOT trigger E2
const E2_EXCLUSION_LABELS = /^(sign\s*in|log\s*in|sign\s*up|register|get\s*started|learn\s*more|home|about|contact|pricing|features|blog|docs|documentation|faq|help|support)$/i;

interface E2ChoiceBundle {
  filePath: string;
  ctaLabels: { label: string; styleTokens: string; position: number }[];
  nearbyMicrocopy: string[];
  highImpactKeywords: string[];
  imbalanceSignals: string[];
  signalCount: number;
}

function detectE2ImbalanceSignals(ctaLabels: { label: string; styleTokens: string; position: number }[]): string[] {
  const signals: string[] = [];
  if (ctaLabels.length < 2) return signals;

  const styles = ctaLabels.map(c => c.styleTokens.toLowerCase());
  const labels = ctaLabels.map(c => c.label.toLowerCase());

  // ── SAFETY PATTERN SUPPRESSION ──
  // A destructive action (red/destructive) paired with a clearly visible neutral cancel/back
  // is a STANDARD SAFETY PATTERN, not manipulative choice architecture.
  const hasDestructiveStyle = styles.some(s => /variant=destructive|bg-destructive|bg-red|text-destructive|border-destructive|text-red/.test(s));
  const hasDestructiveLabel = labels.some(l => /\b(delete|remove|destroy|revoke|deactivate|disable|erase)\b/.test(l));
  const hasSafeOption = labels.some(l => /\b(cancel|go\s*back|keep|no|close|dismiss|nevermind|don'?t)\b/.test(l));
  const safeOptionVisible = hasSafeOption && styles.some(s =>
    // Safe option is a real button (not hidden/text-xs/invisible)
    !/hidden|invisible|sr-only|opacity-0/.test(s)
  );

  if ((hasDestructiveStyle || hasDestructiveLabel) && safeOptionVisible) {
    // This is a standard safety pattern — both options visible, destructive is clearly marked
    // Do NOT count visual_dominance for this case
    console.log(`E2 SAFETY PATTERN: destructive action + visible safe option — suppressing visual_dominance signal`);
    // Return empty — safety patterns should not trigger E2
    return signals;
  }

  // Signal 1: Visual dominance asymmetry (filled primary vs ghost/link/muted alternative)
  const hasPrimary = styles.some(s => /bg-|variant=default|variant=\s*$/.test(s) && !/variant=(ghost|link|outline|secondary)/.test(s));
  const hasGhostOrLink = styles.some(s => /variant=(ghost|link|outline)|text-(gray|muted|slate)|text-sm/.test(s));
  if (hasPrimary && hasGhostOrLink) signals.push('visual_dominance');

  // Signal 1b: Size difference (w-full vs small)
  const hasWFull = styles.some(s => /w-full|px-8|px-10|py-3|py-4/.test(s));
  const hasSmall = styles.some(s => /text-sm|text-xs|size=sm/.test(s));
  if (hasWFull && hasSmall) signals.push('size_asymmetry');

  // Signal 4: Language bias — positive vs negative/shaming wording
  const positiveRe = /\b(yes|continue|accept|agree|upgrade|get|start|try|unlock)\b/i;
  const negativeRe = /\b(no\s*thanks|no,?\s*i|maybe\s*later|i\s*don'?t|not\s*now|i\s*hate|i\s*prefer\s*not)\b/i;
  const hasPositive = labels.some(l => positiveRe.test(l));
  const hasNegative = labels.some(l => negativeRe.test(l));
  if (hasPositive && hasNegative) signals.push('language_bias');

  // Signal 5: Default/pre-selection
  const allTokens = styles.join(' ');
  if (/defaultChecked|checked|defaultValue|pre-?selected/.test(allTokens)) signals.push('default_selection');

  // Signal 6: Ambiguous alternative — "Learn more" as only exit path
  const hasLearnMore = labels.some(l => /^learn\s*more$/i.test(l));
  const hasExplicitDecline = labels.some(l => /\b(decline|cancel|no|opt.?out|dismiss|close|skip)\b/i.test(l));
  if (hasLearnMore && !hasExplicitDecline) signals.push('ambiguous_alternative');

  return signals;
}

function extractE2ChoiceBundle(allFiles: Map<string, string>): E2ChoiceBundle[] {
  const bundles: E2ChoiceBundle[] = [];

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    const btnRe = /<(?:Button|button|a)\b([^>]*)>([^<]{1,80})<\/(?:Button|button|a)>/gi;
    const ctaMatches: { label: string; attrs: string; index: number }[] = [];
    let bm;
    while ((bm = btnRe.exec(content)) !== null) {
      const label = bm[2].replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (!label || label.length < 2) continue;
      ctaMatches.push({ label, attrs: bm[1] || '', index: bm.index });
    }

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

      // ── EXCLUSION: Skip if ALL labels are standard nav/auth ──
      const allExcluded = ctaLabels.every(c => E2_EXCLUSION_LABELS.test(c.label));
      if (allExcluded) continue;

      const regionStart = Math.max(0, group[0].index - 400);
      const regionEnd = Math.min(content.length, group[group.length - 1].index + 400);
      const region = content.slice(regionStart, regionEnd);
      const nearbyMicrocopy: string[] = [];
      const textRe = /<(?:p|span|h[1-6]|div|label)\b[^>]*>([^<]{3,100})<\/(?:p|span|h[1-6]|div|label)>/gi;
      let tm;
      while ((tm = textRe.exec(region)) !== null) {
        const text = tm[1].replace(/\{[^}]*\}/g, '').trim();
        if (text.length >= 3) nearbyMicrocopy.push(text);
      }

      // ── HIGH-IMPACT GATE ──
      const allLabelsLower = ctaLabels.map(c => c.label.toLowerCase()).join(' ');
      const combinedText = region.toLowerCase() + ' ' + allLabelsLower + ' ' + nearbyMicrocopy.join(' ').toLowerCase();

      const matchedKeywords: string[] = [];
      E2_HIGH_IMPACT_KEYWORDS_RE.lastIndex = 0;
      let kwm;
      while ((kwm = E2_HIGH_IMPACT_KEYWORDS_RE.exec(combinedText)) !== null) {
        const kw = kwm[1].toLowerCase();
        if (!matchedKeywords.includes(kw)) matchedKeywords.push(kw);
      }

      // "sign up" / "register" only count if paired with consent/monetization cues
      const hasConversionLabel = /\b(sign\s*up|register|create\s*account)\b/i.test(combinedText);
      const hasConsentOrMoney = matchedKeywords.some(k =>
        /consent|privacy|data|share|cookie|tracking|payment|subscribe|trial|upgrade|buy|purchase|card/.test(k)
      );
      if (hasConversionLabel && hasConsentOrMoney) {
        if (!matchedKeywords.includes('account_conversion')) matchedKeywords.push('account_conversion');
      }

      if (matchedKeywords.length === 0) {
        console.log(`E2 SUPPRESSED (no high-impact gate): ${filePath} — labels: ${ctaLabels.map(c => c.label).join(', ')}`);
        continue;
      }

      // ── IMBALANCE SIGNAL SCORING: Require 2+ signals ──
      const imbalanceSignals = detectE2ImbalanceSignals(ctaLabels);
      if (imbalanceSignals.length < 2) {
        console.log(`E2 SUPPRESSED (${imbalanceSignals.length} signal(s), need 2+): ${filePath} — signals: ${imbalanceSignals.join(', ') || 'none'}`);
        continue;
      }

      bundles.push({
        filePath,
        ctaLabels,
        nearbyMicrocopy: [...new Set(nearbyMicrocopy)].slice(0, 5),
        highImpactKeywords: matchedKeywords,
        imbalanceSignals,
        signalCount: imbalanceSignals.length,
      });
      console.log(`E2 bundle PASSED: ${filePath} — keywords: ${matchedKeywords.join(', ')} — signals (${imbalanceSignals.length}): ${imbalanceSignals.join(', ')}`);
    }
  }
  return bundles.slice(0, 20);
}

function formatE2ChoiceBundleForPrompt(bundles: E2ChoiceBundle[]): string {
  if (bundles.length === 0) return '';
  const lines = [
    '[E2_CHOICE_BUNDLE]',
    'IMPORTANT: E2 evaluates ONLY choice clusters in high-impact decision contexts (consent, monetization, irreversible actions).',
    'Each bundle below has ALREADY passed the high-impact gate and has 2+ imbalance signals.',
    'Do NOT flag standard marketing or navigation patterns.',
  ];
  for (const b of bundles) {
    lines.push(`\n--- Location: ${b.filePath} ---`);
    lines.push(`  High-impact context: ${b.highImpactKeywords.join(', ')}`);
    lines.push(`  Imbalance signals (${b.signalCount}): ${b.imbalanceSignals.join(', ')}`);
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
  subCheck: 'E3.D1' | 'E3.D2';
  elementLabel: string;
  elementType: string;
  detection: string;
  evidence: string;
  recommendedFix: string;
  confidence: number;
  deduplicationKey: string;
}

// High-impact action patterns (gate — E3 only evaluates if these exist)
const E3_HIGH_IMPACT_CTA = /\b(delete|remove|permanently\s*delete|destroy|erase|confirm\s*payment|pay\s*now|pay\b|subscribe|proceed\s*with\s*charge|deactivate\s*account|close\s*account|account\s*deletion|danger|destructive)\b/i;
const E3_HIGH_IMPACT_VARIANT = /\b(variant\s*=\s*["'](?:destructive|danger)["']|colorScheme\s*=\s*["'](?:red|danger)["'])\b/i;

// Structural exit patterns (if ANY present → suppress E3)
const E3_EXIT_PATTERNS = /\b(onClose|onDismiss|handleClose|handleDismiss|closeModal|dismissModal|setOpen\(false\)|setIsOpen\(false\)|setShow\(false\)|onOpenChange)\b/i;
const E3_EXIT_BUTTON_RE = /<(?:Button|button|a)\b[^>]*>([^<]*(?:cancel|back|close|dismiss|decline|undo|no\s*thanks|go\s*back|return|exit|skip|×|✕|X)[^<]*)<\/(?:Button|button|a)>/gi;
const E3_ESCAPE_RE = /\b(Escape|escape|onEscapeKeyDown|closeOnEsc|closeOnOverlayClick|closeOnBackdropClick)\b/i;
const E3_DIALOG_CLOSE_RE = /DialogClose|SheetClose|DrawerClose|AlertDialogCancel/i;
const E3_BREADCRUMB_RE = /<(?:Breadcrumb|breadcrumb|nav)\b[^>]*(?:aria-label\s*=\s*["']breadcrumb["']|className\s*=\s*["'][^"]*breadcrumb)/i;

function hasStructuralExit(region: string): boolean {
  E3_EXIT_BUTTON_RE.lastIndex = 0;
  return E3_EXIT_PATTERNS.test(region) ||
    E3_EXIT_BUTTON_RE.test(region) ||
    E3_ESCAPE_RE.test(region) ||
    E3_DIALOG_CLOSE_RE.test(region) ||
    E3_BREADCRUMB_RE.test(region);
}

function detectE3ControlRestrictions(allFiles: Map<string, string>): E3Finding[] {
  const findings: E3Finding[] = [];
  const seen = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    // HIGH-IMPACT GATE: Skip file entirely if no high-impact actions
    if (!E3_HIGH_IMPACT_CTA.test(content) && !E3_HIGH_IMPACT_VARIANT.test(content)) continue;

    // E3.D1 — High-impact action in Modal/Dialog without structural exit
    const dialogRe = /<(?:Dialog|dialog|Modal|AlertDialog|Drawer|Sheet)\b([^>]*)>/gi;
    let dm;
    while ((dm = dialogRe.exec(content)) !== null) {
      const lineNum = content.substring(0, dm.index).split('\n').length;
      const regionEnd = Math.min(content.length, dm.index + 1000);
      const region = content.slice(dm.index, regionEnd);

      // Must contain high-impact action in this dialog region
      if (!E3_HIGH_IMPACT_CTA.test(region) && !E3_HIGH_IMPACT_VARIANT.test(region)) continue;

      // Suppress if ANY structural exit exists
      E3_EXIT_BUTTON_RE.lastIndex = 0;
      if (hasStructuralExit(region)) continue;

      const key = `${filePath}|E3|E3.D1|${lineNum}`;
      if (!seen.has(key)) {
        seen.add(key);
        const tagName = dm[0].match(/<(\w+)/)?.[1] || 'Dialog';
        // Extract the high-impact CTA label
        const ctaMatch = region.match(/>([^<]*(?:delete|remove|pay|subscribe|deactivate|destroy|confirm)[^<]*)</i);
        const ctaLabel = ctaMatch ? ctaMatch[1].trim() : 'destructive action';
        findings.push({
          filePath, line: lineNum, subCheck: 'E3.D1',
          elementLabel: `${tagName} with "${ctaLabel}" but no exit control`,
          elementType: 'dialog',
          detection: `High-impact action in ${tagName} without visible cancel, close, or dismiss mechanism`,
          evidence: `<${tagName}> contains high-impact CTA ("${ctaLabel}") but no cancel/close/dismiss button, onClose handler, or escape key handler`,
          recommendedFix: 'Add a cancel or close button alongside the destructive action to allow users to exit without committing',
          confidence: 0.78,
          deduplicationKey: key,
        });
      }
    }

    // E3.D2 — High-impact action in form/page without structural exit
    const formRe = /<form\b([^>]*)>/gi;
    let fm;
    while ((fm = formRe.exec(content)) !== null) {
      const lineNum = content.substring(0, fm.index).split('\n').length;
      const regionEnd = Math.min(content.length, fm.index + 1200);
      const region = content.slice(fm.index, regionEnd);

      // Must contain high-impact action
      if (!E3_HIGH_IMPACT_CTA.test(region) && !E3_HIGH_IMPACT_VARIANT.test(region)) continue;

      // Suppress if structural exit exists
      E3_EXIT_BUTTON_RE.lastIndex = 0;
      if (hasStructuralExit(region)) continue;

      // Suppress simple login/signup forms
      const inputCount = (region.match(/<(?:Input|input)\b/gi) || []).length;
      const isSimpleAuth = inputCount <= 2 && /\b(log\s*in|sign\s*in|login|sign\s*up|register)\b/i.test(region);
      if (isSimpleAuth) continue;

      const key = `${filePath}|E3|E3.D2|${lineNum}`;
      if (!seen.has(key)) {
        seen.add(key);
        const ctaMatch = region.match(/>([^<]*(?:delete|remove|pay|subscribe|deactivate|destroy|confirm\s*payment)[^<]*)</i);
        const ctaLabel = ctaMatch ? ctaMatch[1].trim() : 'high-impact action';
        findings.push({
          filePath, line: lineNum, subCheck: 'E3.D2',
          elementLabel: `Form with "${ctaLabel}" but no cancel/exit`,
          elementType: 'form',
          detection: `Form contains high-impact action but no cancel, back, or close option`,
          evidence: `<form> with high-impact CTA ("${ctaLabel}") and ${inputCount} input(s) but no cancel/back/close control`,
          recommendedFix: 'Add a cancel or back button to allow users to exit the form without committing to the high-impact action',
          confidence: 0.70,
          deduplicationKey: key,
        });
      }
    }
  }

  return findings.slice(0, 20);
}

function formatE3FindingsForPrompt(findings: E3Finding[]): string {
  if (findings.length === 0) return '';
  const lines = [
    '[E3_CONTROL_RESTRICTION_EVIDENCE]',
    'IMPORTANT: Location references are for traceability ONLY. Do NOT use file names as evidence. Assess ONLY the structural exit absence for high-impact actions below.',
    'E3 triggers ONLY for high-impact actions (delete, payment, subscribe, account deletion) that lack ALL structural exit controls (cancel, close, back, undo, dismiss).',
    'SUPPRESS if: cancel/back/close exists (even if visually weaker — that is E2), consequence text is missing (that is E1), or issue is wizard navigation (that is U4).',
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
  // Filter out suppressed bundles (should already be filtered, but safety net)
  const activeBundles = bundles.filter(b => !b.suppressed);
  if (activeBundles.length === 0) return '';
  const lines = [
    '[E1_EVIDENCE_BUNDLE]',
    'IMPORTANT: Location references are for traceability ONLY. Do NOT use file names as evidence.',
    'Evaluate ONLY the extracted CTA labels, nearby UI text, and evidence tokens.',
    'NOTE: Bundles where strong disclosure + confirmation dialog are present have ALREADY been filtered out.',
    'The bundles below represent destructive actions where confirmation or disclosure may be missing.',
  ];
  for (const b of activeBundles) {
    lines.push(`\n--- Location: ${b.filePath}${b.startLine ? ':' + b.startLine : ''} ---`);
    lines.push(`  CTA: "${b.ctaLabel}" (type: ${b.ctaType}, source: ${b.detectionSource})`);
    if (b.evidenceTokens.length > 0) lines.push(`  Evidence tokens: ${b.evidenceTokens.join(', ')}`);
    if (b.nearbyText.length > 0) lines.push(`  Nearby text: ${b.nearbyText.join(' | ')}`);
    lines.push(`  Flags: confirmation=${b.hasConfirmationDialog}, warning=${b.hasWarningText}, pricing=${b.hasPricingText}`);
    if (b.disclosureTermsFound.length > 0) lines.push(`  Disclosure terms found: ${b.disclosureTermsFound.join(', ')}`);
    if (b.frictionMechanisms.length > 0) lines.push(`  Friction mechanisms: ${b.frictionMechanisms.join(', ')}`);
    if (b.deleteLine) lines.push(`  DELETE request line: ${b.deleteLine}`);
  }
  lines.push('[/E1_EVIDENCE_BUNDLE]');
  return lines.join('\n');
}

// ========== U6 LAYOUT EVIDENCE BUNDLE EXTRACTION (Weak Grouping / Layout Coherence) ==========
interface U6LayoutEvidence {
  filePath: string;
  headings: string[];
  headingLikeCount: number;
  sectionCount: number;
  fieldsetCount: number;
  articleCount: number;
  componentBlocks: number;
  componentBlockExamples: string[];
  cardLikeDivs: number;
  cardLikeDivExamples: string[];
  separatorCount: number;
  maxDivDepth: number;
  flexCount: number;
  gridCount: number;
  spacingTokens: string[];
  repeatedBlockCount: number;
  flatStackCues: string[];
  majorSiblingEstimate: number;
  tableCount: number;
  navCount: number;
  mainCount: number;
  asideCount: number;
  formCount: number;
  blockCount: number;
  usesGridOrColumns: boolean;
  triggerSummary: string;
  suppressReason: string | null;
}

// Component names that count as grouping containers (expanded)
const U6_COMPONENT_NAME_RE = /<(Card|Panel|Section|Container|Drawer|Sheet|Accordion|AccordionItem|Tabs|TabsContent|Table|FormField|Sidebar|Dialog|DialogContent|Popover|PopoverContent|HoverCard|AlertDialog|Separator)\b/gi;

// Card-like div: className with rounded-* AND (border OR bg-* OR shadow OR ring-*) AND padding p-3+
function u6IsCardLikeDiv(classStr: string): boolean {
  const hasRounded = /\brounded(?:-[a-z]+)?\b/.test(classStr);
  if (!hasRounded) return false;
  let structureSignals = 0;
  if (/\b(border|border-[a-z])/.test(classStr)) structureSignals++;
  if (/\bshadow(?:-[a-z]+)?\b/.test(classStr)) structureSignals++;
  if (/\bbg-(?!transparent\b)[a-zA-Z]/.test(classStr)) structureSignals++;
  if (/\bring(?:-[a-z]+)?\b/.test(classStr)) structureSignals++;
  if (structureSignals === 0) return false;
  if (/\bp-(3|4|5|6|8|10|12|16|20)\b/.test(classStr)) return true;
  if (/\bpx-(3|4|5|6|8)\b/.test(classStr) && /\bpy-(3|4|5|6|8)\b/.test(classStr)) return true;
  return false;
}

// Hard scope: files that should NEVER be evaluated for U6
function u6ShouldSkipFile(filePath: string, content: string): string | null {
  // 1) Router/config files
  const baseName = filePath.split('/').pop() || '';
  if (/^(App|main|index)\.(tsx|jsx)$/i.test(baseName)) return `Router/entry file: ${baseName}`;
  if (/^(router|routes)/i.test(baseName)) return `Router config file: ${baseName}`;
  // 2) JSX contains routing components
  if (/<(Routes|Route|Switch|Router|BrowserRouter|HashRouter)\b/i.test(content)) return 'Contains routing components';
  if (/createBrowserRouter|createHashRouter/i.test(content)) return 'Contains router factory';
  // 3) Mostly providers, no real UI
  const providerCount = (content.match(/<(BrowserRouter|ThemeProvider|AuthProvider|QueryClientProvider|Provider|StoreProvider|TooltipProvider|SidebarProvider)\b/gi) || []).length;
  const totalJsxTags = (content.match(/<[A-Z]\w+\b/g) || []).length;
  if (providerCount >= 2 && totalJsxTags > 0 && providerCount / totalJsxTags > 0.5) return 'Composition/provider wrapper file';
  return null;
}

// Check if file is page-like (has page layout signals)
function u6IsPageLike(content: string, headings: string[], headingLikeCount: number, sectionCount: number, formCount: number, tableCount: number, componentBlocks: number, cardLikeDivs: number, mainCount: number): boolean {
  // Has main/header/aside/section/form/table/Card
  if (mainCount > 0) return true;
  if (/<(header|aside)\b/i.test(content)) return true;
  if (sectionCount > 0 || formCount > 0 || tableCount > 0) return true;
  if (componentBlocks > 0 || cardLikeDivs > 0) return true;
  // Has H1/H2 + multiple blocks
  const hasTopHeading = headings.some(h => /^h[12]:/.test(h));
  if (hasTopHeading && (headings.length + headingLikeCount >= 2)) return true;
  if (headingLikeCount >= 1 && sectionCount + componentBlocks + cardLikeDivs >= 1) return true;
  return false;
}

function extractU6LayoutEvidence(allFiles: Map<string, string>): U6LayoutEvidence[] {
  const bundles: U6LayoutEvidence[] = [];

  for (const [filePathRaw, content] of allFiles) {
    const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!/\.(tsx|jsx|html)$/.test(filePath)) continue;
    if (/\.(test|spec)\./i.test(filePath)) continue;
    if (filePath.includes('components/ui/') || filePath.includes('node_modules') || filePath.includes('dist/')) continue;

    // Hard scope suppression
    const skipReason = u6ShouldSkipFile(filePath, content);
    if (skipReason) continue; // completely skip, don't even create a bundle

    // 1) Headings
    const headings: string[] = [];
    const hRe = /<h([1-6])\b[^>]*>([^<]{2,80})<\/h\1>/gi;
    let hm;
    while ((hm = hRe.exec(content)) !== null) {
      const text = hm[2].replace(/\{[^}]*\}/g, '').trim();
      if (text.length >= 2) headings.push(`h${hm[1]}: ${text}`);
    }
    const roleHeadingRe = /role\s*=\s*["']heading["'][^>]*>([^<]{2,60})</gi;
    let rhm;
    while ((rhm = roleHeadingRe.exec(content)) !== null) {
      headings.push(`role=heading: ${rhm[1].trim()}`);
    }

    let headingLikeCount = 0;
    const twHeadingRe = /className\s*=\s*["'][^"']*\b(text-(?:xl|2xl|3xl|4xl|5xl|6xl))\b[^"']*\b(font-(?:semibold|bold|extrabold))\b[^"']*["']/gi;
    const twHeadingRe2 = /className\s*=\s*["'][^"']*\b(font-(?:semibold|bold|extrabold))\b[^"']*\b(text-(?:xl|2xl|3xl|4xl|5xl|6xl))\b[^"']*["']/gi;
    headingLikeCount += (content.match(twHeadingRe) || []).length;
    headingLikeCount += (content.match(twHeadingRe2) || []).length;

    // 2) Semantic containers (expanded)
    const sectionCount = (content.match(/<section\b/gi) || []).length;
    const fieldsetCount = (content.match(/<fieldset\b/gi) || []).length;
    const articleCount = (content.match(/<article\b/gi) || []).length;
    const tableCount = (content.match(/<(?:Table|table)\b/gi) || []).length;
    const navCount = (content.match(/<nav\b/gi) || []).length;
    const mainCount = (content.match(/<main\b/gi) || []).length;
    const asideCount = (content.match(/<aside\b/gi) || []).length;
    const formCount = (content.match(/<form\b/gi) || []).length;

    // 3) Component blocks (strong grouping signal)
    let componentBlocks = 0;
    const componentBlockExamples: string[] = [];
    const compBlockSet = new Set<string>();
    let cbm;
    const cbRe = new RegExp(U6_COMPONENT_NAME_RE.source, 'gi');
    while ((cbm = cbRe.exec(content)) !== null) compBlockSet.add(cbm[1]);
    for (const name of compBlockSet) {
      const count = (content.match(new RegExp(`<${name}\\b`, 'gi')) || []).length;
      componentBlocks += count;
      componentBlockExamples.push(`${name} x${count}`);
    }

    // 4) Card-like divs
    let cardLikeDivs = 0;
    const cardLikeDivExamples: string[] = [];
    const divClassRe = /<div\b[^>]*className\s*=\s*["']([^"']+)["']/gi;
    let dcm;
    while ((dcm = divClassRe.exec(content)) !== null) {
      if (u6IsCardLikeDiv(dcm[1])) {
        cardLikeDivs++;
        if (cardLikeDivExamples.length < 3) {
          const shortClass = dcm[1].split(/\s+/).filter((c: string) => /border|rounded|shadow|bg-|ring|p-\d|overflow/.test(c)).slice(0, 4).join(' ');
          cardLikeDivExamples.push(`div.${shortClass}`);
        }
      }
    }

    // Also count divide-y sections with headings as containers
    const divideYWithHeading = (content.match(/className\s*=\s*["'][^"']*\bdivide-y\b[^"']*["']/gi) || []).length;
    if (divideYWithHeading > 0 && headings.length > 0) {
      cardLikeDivs += divideYWithHeading;
    }

    // 5) Separators (<hr>, <Separator>, border-b/border-t dividers)
    let separatorCount = (content.match(/<(?:hr|Separator)\b/gi) || []).length;
    separatorCount += (content.match(/className\s*=\s*["'][^"']*\bborder-[bt]\b[^"']*["']/gi) || []).length;

    // 6) Layout primitives
    const flexCount = (content.match(/\bflex\b/g) || []).length;
    const gridCount = (content.match(/\bgrid\b/g) || []).length;
    const usesGridOrColumns = gridCount > 0 || /\bgrid-cols-\d\b/.test(content) || /\bcolumns-\d\b/.test(content);

    // 7) Spacing tokens
    const spacingTokenSet = new Set<string>();
    const spacingRe = /\b(gap-\d+|space-[xy]-\d+|mb-\d+|mt-\d+|py-\d+|px-\d+|p-\d+|m-\d+)\b/g;
    let sm;
    while ((sm = spacingRe.exec(content)) !== null) spacingTokenSet.add(sm[1]);

    // 8) Repeated blocks
    const mapCount = (content.match(/\.map\s*\(/g) || []).length;

    // 9) Flat stack cues
    const flatStackCues: string[] = [];
    if (/(<(?:input|Input|textarea|Textarea|select|Select|button|Button)\b[^>]*(?:\/>|>[^<]*<\/(?:input|Input|textarea|Textarea|select|Select|button|Button)>)\s*\n?\s*){3,}/gi.test(content)) {
      flatStackCues.push('3+ sibling form controls without headings/wrappers');
    }
    if (/(?:<div\b[^>]*>[^<]*<\/div>\s*\n?\s*){5,}/gi.test(content)) {
      flatStackCues.push('5+ flat sibling divs');
    }

    // 10) Major sibling estimate
    const returnMatch = content.match(/return\s*\(\s*\n?\s*<(\w+)/);
    let majorSiblingEstimate = 0;
    if (returnMatch) {
      const afterReturn = content.slice((returnMatch.index || 0) + returnMatch[0].length);
      const directChildRe = /^\s{2,6}<(\w+)\b/gm;
      let dcChild;
      const directChildren = new Set<number>();
      while ((dcChild = directChildRe.exec(afterReturn)) !== null) {
        if (dcChild.index > 3000) break;
        directChildren.add(dcChild.index);
      }
      majorSiblingEstimate = directChildren.size;
    }

    // Page-like check: only evaluate page-like components
    if (!u6IsPageLike(content, headings, headingLikeCount, sectionCount, formCount, tableCount, componentBlocks, cardLikeDivs, mainCount)) continue;

    // Skip files with minimal layout content
    if (headings.length === 0 && headingLikeCount === 0 && sectionCount === 0 && fieldsetCount === 0 &&
        componentBlocks === 0 && cardLikeDivs === 0 && flexCount < 2 && spacingTokenSet.size === 0 && flatStackCues.length === 0) continue;

    // Compute blockCount (semantic + component + card-like)
    const semanticSections = sectionCount + articleCount + fieldsetCount + navCount + asideCount;
    const totalContainers = semanticSections + componentBlocks + cardLikeDivs;
    const blockCount = majorSiblingEstimate;
    const totalHeadings = headings.length + headingLikeCount;

    // ===== Deterministic complexity gate: skip LLM if too simple =====
    if (blockCount < 4 && !usesGridOrColumns) {
      continue; // Not complex enough to warrant U6 evaluation
    }

    // ===== Strong suppression rules =====
    let suppressReason: string | null = null;

    // S1: Table page with thead/column headers
    if (tableCount >= 1 && (/<thead\b/i.test(content) || /<TableHead\b/i.test(content) || /<th\b/i.test(content))) {
      suppressReason = `Table-centric layout with column headers`;
    }
    // S2: >=2 headings each followed by a container/block
    else if (totalHeadings >= 2 && totalContainers >= 2) {
      suppressReason = `Structured: ${totalHeadings} headings + ${totalContainers} containers`;
    }
    // S3: >=2 layout primitives (Card, Separator, Tabs, Accordion) indicating deliberate structure
    else if (componentBlockExamples.length >= 2) {
      const distinctPrimitives = new Set(componentBlockExamples.map(e => e.split(' ')[0]));
      if (distinctPrimitives.size >= 2) {
        suppressReason = `Deliberate structure: ${[...distinctPrimitives].join(', ')} used`;
      }
    }
    // S4: Well-grouped with component blocks + card-like divs
    else if (componentBlocks + cardLikeDivs >= 2) {
      suppressReason = `Well-grouped: ${componentBlocks} component blocks + ${cardLikeDivs} card-like divs`;
    }
    // S5: Clear headings + separators
    else if (totalHeadings >= 2 && separatorCount >= 1) {
      suppressReason = `Clear hierarchy: ${totalHeadings} headings + ${separatorCount} separators`;
    }
    // S6: Semantic blocks provide grouping
    else if (semanticSections >= 2) {
      suppressReason = `Semantic grouping: ${sectionCount} sections + ${articleCount} articles + ${fieldsetCount} fieldsets`;
    }
    // S7: Simple page with no flat stack issues
    else if (majorSiblingEstimate <= 2 && flatStackCues.length === 0) {
      suppressReason = `Simple page: ${majorSiblingEstimate} major siblings`;
    }

    const triggerSummary = `Blocks:${blockCount} Containers:${totalContainers} Headings:${totalHeadings} SemanticSections:${semanticSections} Grid:${usesGridOrColumns}`;

    bundles.push({
      filePath,
      headings: [...new Set(headings)].slice(0, 8),
      headingLikeCount,
      sectionCount,
      fieldsetCount,
      articleCount,
      componentBlocks,
      componentBlockExamples: componentBlockExamples.slice(0, 5),
      cardLikeDivs,
      cardLikeDivExamples: cardLikeDivExamples.slice(0, 3),
      separatorCount,
      maxDivDepth: Math.min((content.match(/<div\b/gi) || []).length, (content.match(/<\/div>/gi) || []).length),
      flexCount,
      gridCount,
      spacingTokens: [...spacingTokenSet].slice(0, 12),
      repeatedBlockCount: mapCount,
      flatStackCues,
      majorSiblingEstimate,
      tableCount,
      navCount,
      mainCount,
      asideCount,
      formCount,
      blockCount,
      usesGridOrColumns,
      triggerSummary,
      suppressReason,
    });
  }

  return bundles.slice(0, 15);
}

function formatU6LayoutEvidenceForPrompt(bundles: U6LayoutEvidence[]): string {
  const unsuppressed = bundles.filter(b => !b.suppressReason);
  if (unsuppressed.length === 0) return '';
  const lines = [
    '[U6_LAYOUT_EVIDENCE_BUNDLE]',
    'IMPORTANT: Location references below are for traceability ONLY. Do NOT use file names or component names as evidence. Evaluate ONLY the extracted layout cues.',
  ];
  for (const b of unsuppressed) {
    lines.push(`\n--- Location: ${b.filePath} ---`);
    lines.push(`  Trigger summary: ${b.triggerSummary}`);
    if (b.headings.length > 0) lines.push(`  Headings: ${b.headings.join(' | ')}`);
    if (b.headingLikeCount > 0) lines.push(`  Heading-like styled elements: ${b.headingLikeCount}`);
    lines.push(`  Semantic containers: ${b.sectionCount} <section>, ${b.fieldsetCount} <fieldset>, ${b.articleCount} <article>, ${b.navCount} <nav>, ${b.asideCount} <aside>`);
    lines.push(`  Component blocks: ${b.componentBlocks} (${b.componentBlockExamples.join(', ') || 'none'})`);
    lines.push(`  Card-like divs: ${b.cardLikeDivs} (${b.cardLikeDivExamples.join(', ') || 'none'})`);
    if (b.separatorCount > 0) lines.push(`  Separators: ${b.separatorCount}`);
    if (b.tableCount > 0) lines.push(`  Tables: ${b.tableCount}`);
    lines.push(`  Layout: ${b.flexCount} flex, ${b.gridCount} grid, grid/columns: ${b.usesGridOrColumns}, div depth ~${b.maxDivDepth}`);
    if (b.spacingTokens.length > 0) lines.push(`  Spacing tokens: ${b.spacingTokens.join(', ')}`);
    if (b.repeatedBlockCount > 0) lines.push(`  Repeated blocks (map): ${b.repeatedBlockCount}`);
    lines.push(`  Major sibling blocks: ~${b.majorSiblingEstimate}`);
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
  startLine?: number | null;
  endLine?: number | null;
}

// --- A4 Helpers: page-level detection ---

/** Identify "page files" — files under common page roots or referenced as route elements */
function identifyPageFiles(allFiles: Map<string, string>): Set<string> {
  const pageFiles = new Set<string>();
  const PAGE_PATH_RE = /(?:^|\/)(?:pages|routes|app|views)\/[^/]+\.(tsx|jsx|ts|js)$/i;
  for (const filePath of allFiles.keys()) {
    const norm = normalizePath(filePath);
    if (PAGE_PATH_RE.test(norm)) pageFiles.add(norm);
  }
  // Also find files referenced as route elements in router config
  for (const [, content] of allFiles) {
    // React Router: element={<Component />} or element: <Component />
    const routeElementRe = /element\s*[:=]\s*(?:\{?\s*)?<(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = routeElementRe.exec(content)) !== null) {
      const compName = m[1];
      // Try to find a file that exports this component
      for (const [fp, fc] of allFiles) {
        const norm = normalizePath(fp);
        if (pageFiles.has(norm)) continue;
        const exportRe = new RegExp(`export\\s+(?:default\\s+)?(?:function|const)\\s+${compName}\\b`);
        if (exportRe.test(fc)) pageFiles.add(norm);
      }
    }
  }
  return pageFiles;
}

/** Resolve a single-hop import path to find the target file content */
function resolveImportedComponent(
  importSource: string,
  currentFile: string,
  allFiles: Map<string, string>
): { filePath: string; content: string } | null {
  // Normalize the import source
  let resolved = importSource.replace(/^@\//, 'src/');
  // If relative, resolve against current file
  if (resolved.startsWith('.')) {
    const dir = currentFile.replace(/\/[^/]+$/, '');
    const parts = dir.split('/');
    for (const seg of resolved.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    resolved = parts.join('/');
  }
  // Try with extensions
  const candidates = [resolved, `${resolved}.tsx`, `${resolved}.ts`, `${resolved}.jsx`, `${resolved}.js`, `${resolved}/index.tsx`, `${resolved}/index.ts`];
  for (const cand of candidates) {
    const norm = normalizePath(cand);
    if (allFiles.has(norm)) return { filePath: norm, content: allFiles.get(norm)! };
  }
  return null;
}

/** Check if a layout component file contains <main> or role="main" */
function layoutProvidesMain(pageContent: string, pageFilePath: string, allFiles: Map<string, string>): boolean {
  // Find JSX tags used as wrappers in the return statement
  const returnMatch = pageContent.match(/\breturn\s*\(\s*</);
  if (!returnMatch) return false;
  const afterReturn = pageContent.slice(returnMatch.index!);
  // Find the outermost component tag (capitalized = React component)
  const wrapperMatch = afterReturn.match(/^\s*return\s*\(\s*<([A-Z]\w*)/);
  if (!wrapperMatch) return false;
  const wrapperName = wrapperMatch[1];

  // Resolve import for this wrapper
  const importRe = new RegExp(`import\\s+(?:\\{[^}]*\\b${wrapperName}\\b[^}]*\\}|${wrapperName})\\s+from\\s+["']([^"']+)["']`);
  const importMatch = pageContent.match(importRe);
  if (!importMatch) return false;
  const importSource = importMatch[1];
  const resolved = resolveImportedComponent(importSource, pageFilePath, allFiles);
  if (!resolved) return false;
  return /<main\b/i.test(resolved.content) || /role\s*=\s*["']main["']/i.test(resolved.content);
}

function detectA4SemanticStructure(allFiles: Map<string, string>): A4Finding[] {
  const findings: A4Finding[] = [];
  const seenKeys = new Set<string>();

  // Global landmark tracking — pre-pass across ALL files (no directory filter)
  // to avoid false positives when <main> is in layout/wrapper files outside src/pages/
  let hasMainLandmark = false;
  for (const [, content] of allFiles) {
    if (/<main\b/i.test(content) || /role\s*=\s*["']main["']/i.test(content)) {
      hasMainLandmark = true;
      break;
    }
  }
  let hasNavLandmark = false;
  const headingLevelsUsed = new Set<number>();
  const clickableNonSemantics: A4Finding[] = [];
  const headingIssues: A4Finding[] = [];
  const landmarkIssues: A4Finding[] = [];
  const listIssues: A4Finding[] = [];
  const visualHeadingIssues: A4Finding[] = [];

  // Identify page files for page-level h1 analysis
  const pageFiles = identifyPageFiles(allFiles);

  // Per-page h1 tracking (stores line numbers of each <h1> occurrence)
  const pageH1Counts = new Map<string, number[]>();

  const NON_INTERACTIVE_TAGS = 'div|span|p|li|section|article|header|footer|main|aside|nav|figure|figcaption|dd|dt|dl';
  const POINTER_HANDLER_RE = /\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/;
  const HTML_CLICK_HANDLER_RE = /\b(onclick|onmousedown|onmouseup|onkeydown)\s*=/i;
  const INTERACTIVE_ROLES = /\brole\s*=\s*["'](button|link|menuitem|tab|option|checkbox|radio|switch|combobox|listbox|slider|treeitem|gridcell)["']/i;
  const KEY_HANDLER_RE = /\b(onKeyDown|onKeyUp|onKeyPress)\s*=/;
  const TABINDEX_GTE0_RE = /tabIndex\s*=\s*\{?\s*(?:0|[1-9])\s*\}?/i;
  const LARGE_FONT_RE = /(?:^|\s)(?:(?:sm|md|lg|xl|2xl):)?(?:text-(?:lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)|text-\[\d+(?:px|rem|em)\])\b/;
  const BOLD_RE = /(?:^|\s)(?:(?:sm|md|lg|xl|2xl):)?(?:font-bold|font-semibold|font-extrabold|font-black)\b/;
  const LIST_INTENT_RE = /^(?:\s*[•\-\*\d]+[\.\)]\s|\s*(?:item|card|entry|row|record)\b)/i;

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html)$/.test(filePath)) continue;
    if (!filePath.startsWith('src/') && !filePath.startsWith('components/') && !filePath.startsWith('app/') && !filePath.startsWith('pages/') && !filePath.startsWith('client/')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|html)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    // Track h1 per page file — store line numbers for each occurrence
    const isPage = pageFiles.has(filePath);
    if (isPage) {
      const h1LineNumbers: number[] = [];
      const h1Re = /<h1\b/gi;
      let h1Match;
      while ((h1Match = h1Re.exec(content)) !== null) {
        h1LineNumbers.push(content.slice(0, h1Match.index).split('\n').length);
      }
      pageH1Counts.set(filePath, h1LineNumbers);
    }

    // Global heading level tracking (for skipped levels only)
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
      if (/role\s*=\s*["']heading["']/i.test(attrs)) continue;
      const afterTag = content.slice(index + attrs.length + tag.length + 2, Math.min(content.length, index + attrs.length + tag.length + 200));
      const textMatch = afterTag.match(/^([^<]{3,80})/);
      if (!textMatch) continue;
      const text = textMatch[1].trim();
      if (text.length < 3 || text.length > 80) continue;

      const lineNumber = content.slice(0, index).split('\n').length;

      const returnMatch = content.match(/\breturn\s*\(/);
      const jsxStartIdx = returnMatch ? (returnMatch.index! + returnMatch[0].length) : 0;
      const isFirstHeadingInJsx = index >= jsxStartIdx && !visualHeadingIssues.some(
        v => v.filePath === filePath && v.detection.includes('visual_heading_no_h1')
      );
      const isTopHeadingCandidate = isFirstHeadingInJsx && !fileHasH1;

      if (isTopHeadingCandidate && isPage) {
        // Page-level: visual heading near top without any <h1> → A4-H1-1 Potential
        const dedupeKey = `A4.1|top-visual-heading|${filePath}|${lineNumber}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        visualHeadingIssues.push({
          elementLabel: `Visual heading: "${text.substring(0, 40)}"`, elementType: tag, sourceLabel: text.substring(0, 40),
          filePath, componentName,
          subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
          classification: 'potential',
          detection: `visual_heading_no_h1: Page has no <h1> but renders a visual heading (<${tag}> with large font + bold)`,
          evidence: `<${tag} className="${cls.substring(0, 60)}"> at ${filePath}:${lineNumber}`,
          explanation: `Page file "${componentName}" has no <h1> but this <${tag}> appears to serve as the page title. Screen readers cannot identify it as a heading.`,
          confidence: 0.70,
          correctivePrompt: `Replace <${tag}> with <h1> (or add role="heading" aria-level="1") since it appears to be the primary page heading.`,
          deduplicationKey: dedupeKey,
          potentialSubtype: 'borderline',
          startLine: lineNumber,
        });
      } else if (isTopHeadingCandidate) {
        // Non-page file top heading without h1 — lower confidence
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
          explanation: `<${tag}> appears to be a page title (large font + bold, near top of component, no <h1> in file) but uses no semantic heading.`,
          confidence: 0.68,
          correctivePrompt: `Replace <${tag}> with <h1> (or add role="heading" aria-level="1") since it appears to be the primary page heading.`,
          deduplicationKey: dedupeKey,
          potentialSubtype: 'borderline',
          startLine: lineNumber,
        });
      } else {
        // Any visual heading missing semantics → Confirmed
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
          startLine: lineNumber,
        });
      }
    }

    // A4.2: Interactive semantics — using multiline JSX parser
    const a4NonInteractiveTags = extractJsxOpeningTags(content, NON_INTERACTIVE_TAGS);
    for (const { tag, attrs, index } of a4NonInteractiveTags) {
      if (!POINTER_HANDLER_RE.test(attrs) && !HTML_CLICK_HANDLER_RE.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      if (/aria-hidden\s*=\s*\{\s*true\s*\}/i.test(attrs)) continue;
      if (INTERACTIVE_ROLES.test(attrs)) continue;
      if (isInsideInteractiveAncestor(content, index)) continue;
      if (isSummaryInDetails(content, index, tag)) continue;

      const hasKeyHandler = KEY_HANDLER_RE.test(attrs);
      const hasTabIndex = TABINDEX_GTE0_RE.test(attrs);
      if (!hasKeyHandler || !hasTabIndex) continue;

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
        startLine: lineNumber,
      });
    }

    // A4.3: Nav landmark detection (main is handled by pre-pass)
    if (/<nav\b/i.test(content) || /role\s*=\s*["']navigation["']/i.test(content)) hasNavLandmark = true;

    // A4.4: Lists — tightened heuristic (Potential only)
    const repeatedClassPattern = /className\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`})/g;
    const classCounts = new Map<string, { count: number; samples: string[] }>();
    let classMatch2;
    while ((classMatch2 = repeatedClassPattern.exec(content)) !== null) {
      const cls = classMatch2[1] || classMatch2[2] || classMatch2[3] || '';
      if (cls.length > 10 && cls.length < 200) {
        const entry = classCounts.get(cls) || { count: 0, samples: [] };
        entry.count++;
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

  // A4.1 Post-scan: Page-level multiple <h1> check
  // Only flag if a single page file contains >1 <h1>
  for (const [pagePath, h1Lines] of pageH1Counts) {
    if (h1Lines.length > 1) {
      // Emit one finding per duplicate <h1> with its specific line number
      for (const h1Line of h1Lines) {
        const dedupeKey = `A4.1|multiple-h1|${pagePath}|${h1Line}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);
        headingIssues.push({
          elementLabel: `<h1> at line ${h1Line}`, elementType: 'h1', sourceLabel: 'Page heading',
          filePath: pagePath, componentName: undefined,
          subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
          classification: 'potential',
          detection: `multiple_h1: ${h1Lines.length} <h1> elements in the same page file`,
          evidence: `<h1> at ${pagePath}:${h1Line} (${h1Lines.length} total in file)`,
          explanation: `This page file contains ${h1Lines.length} <h1> elements. Each page view should have exactly one <h1>.`,
          confidence: 0.70,
          deduplicationKey: dedupeKey,
          startLine: h1Line,
        });
      }
    }
  }

  // A4.1 Post-scan: Skipped heading levels (kept as global, this is structural)
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
        startLine: null,
      });
      break;
    }
  }

  // A4.3: Missing <main> landmark — layout-aware
  // If no file has <main> directly, check if any page's layout wrapper provides it
  if (!hasMainLandmark) {
    let layoutProvidesIt = false;
    for (const pagePath of pageFiles) {
      const pageContent = allFiles.get(pagePath);
      if (pageContent && layoutProvidesMain(pageContent, pagePath, allFiles)) {
        layoutProvidesIt = true;
        break;
      }
    }
    if (!layoutProvidesIt) {
      const confidence = pageFiles.size > 0 ? 0.80 : 0.60;
      landmarkIssues.push({
        elementLabel: 'Missing <main> landmark', elementType: 'main', sourceLabel: 'Page landmark',
        filePath: 'global', componentName: undefined,
        subCheck: 'A4.3', subCheckLabel: 'Landmark regions',
        classification: 'potential',
        detection: 'No <main> or role="main" found in any source or layout file',
        evidence: 'No <main> element or role="main" found across scanned UI source files.',
        explanation: 'No <main> landmark found. Screen readers use landmarks to navigate page regions efficiently (WCAG 2.4.1 Bypass Blocks).',
        confidence,
        deduplicationKey: 'A4.3|no-main',
        startLine: 1,
      });
    }
  }

  findings.push(...headingIssues, ...visualHeadingIssues, ...clickableNonSemantics, ...landmarkIssues, ...listIssues);
  return findings;
}

// ========== A5 DETERMINISTIC DETECTION (Missing Form Labels) ==========

// Wrapper component → implied control type mapping
const A5_WRAPPER_COMPONENT_MAP: Record<string, { controlType: string; impliedRole?: string }> = {
  'Input': { controlType: 'input' },
  'Textarea': { controlType: 'textarea' },
  'SelectTrigger': { controlType: 'select', impliedRole: 'combobox' },
  'Switch': { controlType: 'checkbox', impliedRole: 'switch' },
  'Checkbox': { controlType: 'checkbox' },
  'RadioGroupItem': { controlType: 'radio' },
  'Slider': { controlType: 'slider', impliedRole: 'slider' },
};

// Build regex alternation from the map keys
const A5_WRAPPER_NAMES = Object.keys(A5_WRAPPER_COMPONENT_MAP).join('|');

// Import paths that indicate a UI control (not routing, not utility)
const A5_UI_IMPORT_PATTERNS = [
  /['"]@\/components\/ui\//,
  /['"]\.\.?\/components\/ui\//,
  /['"]@radix-ui\//,
  /['"]shadcn/,
  /['"]@headlessui\//,
];

// Import paths that indicate NON-UI usage (routing, state, etc.)
const A5_NON_UI_IMPORT_PATTERNS = [
  /['"]react-router/,
  /['"]@remix-run/,
  /['"]next\/navigation/,
  /['"]wouter/,
];

/**
 * Extract import sources for each component name from file content.
 * Returns a map: componentName → import path string
 */
function extractImportSources(content: string): Map<string, string> {
  const importMap = new Map<string, string>();
  // Match: import { X, Y } from 'path' and import X from 'path'
  const importRegex = /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+(['"][^'"]+['"])/g;
  let m;
  while ((m = importRegex.exec(content)) !== null) {
    const path = m[3]; // includes quotes
    if (m[1]) {
      // Named imports: { X, Y as Z }
      const names = m[1].split(',').map(n => {
        const parts = n.trim().split(/\s+as\s+/);
        return parts.length > 1 ? parts[1].trim() : parts[0].trim();
      }).filter(Boolean);
      for (const name of names) importMap.set(name, path);
    }
    if (m[2]) {
      // Default import
      importMap.set(m[2], path);
    }
  }
  return importMap;
}

/**
 * Check if a wrapper component name should be treated as a UI control
 * based on its import source or explicit ARIA role.
 */
const A5_FORM_CONTROL_ROLES = new Set([
  'switch',
  'combobox',
  'checkbox',
  'radio',
  'slider',
  'textbox',
  'searchbox',
  'spinbutton',
  'listbox',
]);

interface ParsedA5Attribute {
  present: boolean;
  value: string | null;
  isNonEmpty: boolean;
  isDynamic: boolean;
  evidence: string | null;
}

function compactA5EvidenceValue(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function parseA5AttributeFromTag(openingTag: string, attributeName: string): ParsedA5Attribute {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attrRegex = new RegExp(`\\b${escapedName}\\s*=\\s*`, 'i');
  const attrMatch = attrRegex.exec(openingTag);

  if (!attrMatch) {
    return { present: false, value: null, isNonEmpty: false, isDynamic: false, evidence: null };
  }

  let cursor = attrMatch.index + attrMatch[0].length;
  while (cursor < openingTag.length && /\s/.test(openingTag[cursor])) cursor++;

  if (cursor >= openingTag.length) {
    return { present: true, value: null, isNonEmpty: false, isDynamic: false, evidence: `${attributeName}=` };
  }

  const firstChar = openingTag[cursor];

  if (firstChar === '"' || firstChar === "'") {
    const quote = firstChar;
    let end = cursor + 1;
    while (end < openingTag.length) {
      if (openingTag[end] === quote && openingTag[end - 1] !== '\\') break;
      end++;
    }
    const rawValue = openingTag.slice(cursor + 1, end);
    return {
      present: true,
      value: rawValue,
      isNonEmpty: rawValue.trim().length > 0,
      isDynamic: false,
      evidence: `${attributeName}=${quote}${rawValue}${quote}`,
    };
  }

  if (firstChar === '{') {
    let end = cursor;
    let depth = 0;
    let inString: string | null = null;
    let inTemplateLiteral = false;

    while (end < openingTag.length) {
      const ch = openingTag[end];

      if (inString) {
        if (ch === inString && openingTag[end - 1] !== '\\') inString = null;
        end++;
        continue;
      }

      if (inTemplateLiteral) {
        if (ch === '`' && openingTag[end - 1] !== '\\') inTemplateLiteral = false;
        end++;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = ch;
        end++;
        continue;
      }

      if (ch === '`') {
        inTemplateLiteral = true;
        end++;
        continue;
      }

      if (ch === '{') {
        depth++;
        end++;
        continue;
      }

      if (ch === '}') {
        depth--;
        end++;
        if (depth === 0) break;
        continue;
      }

      end++;
    }

    const expressionRaw = openingTag.slice(cursor + 1, Math.max(cursor + 1, end - 1)).trim();
    const literalExpressionMatch = expressionRaw.match(/^(["'])([\s\S]*)\1$/);

    if (literalExpressionMatch) {
      const literalValue = literalExpressionMatch[2];
      return {
        present: true,
        value: literalValue,
        isNonEmpty: literalValue.trim().length > 0,
        isDynamic: false,
        evidence: `${attributeName}={${literalExpressionMatch[1]}${literalValue}${literalExpressionMatch[1]}}`,
      };
    }

    return {
      present: true,
      value: expressionRaw,
      isNonEmpty: expressionRaw.length > 0,
      isDynamic: true,
      evidence: `${attributeName}={${compactA5EvidenceValue(expressionRaw)}}`,
    };
  }

  let end = cursor;
  while (end < openingTag.length && !/[\s/>]/.test(openingTag[end])) end++;
  const bareValue = openingTag.slice(cursor, end);

  return {
    present: true,
    value: bareValue,
    isNonEmpty: bareValue.trim().length > 0,
    isDynamic: false,
    evidence: `${attributeName}=${bareValue}`,
  };
}

function isUiControl(componentName: string, importMap: Map<string, string>, openingTag: string): boolean {
  const importPath = importMap.get(componentName);

  if (importPath) {
    if (A5_NON_UI_IMPORT_PATTERNS.some(p => p.test(importPath))) return false;
    if (A5_UI_IMPORT_PATTERNS.some(p => p.test(importPath))) return true;
  }

  const parsedRole = parseA5AttributeFromTag(openingTag, 'role');
  if (parsedRole.isNonEmpty && parsedRole.value) {
    return A5_FORM_CONTROL_ROLES.has(parsedRole.value.toLowerCase());
  }

  return false;
}

function parseAriaLabelValue(openingTag: string): ParsedA5Attribute {
  return parseA5AttributeFromTag(openingTag, 'aria-label');
}

function parseAriaLabelledByValue(openingTag: string): ParsedA5Attribute {
  return parseA5AttributeFromTag(openingTag, 'aria-labelledby');
}

interface A5Finding {
  elementKey: string; // Stable identity: hash of tag + id + name + type + filePath + lineNumber
  elementLabel: string;
  elementType: string;
  elementName?: string; // React component name (e.g., "Input", "SelectTrigger")
  controlType?: string; // Implied native type (e.g., "input", "select", "checkbox")
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
  // Element metadata
  selectorHints?: string[]; // e.g., ['id="email"', 'name="email"']
  controlId?: string; // The actual id if present
  labelingMethod?: string; // What labeling was found/missing
  // Line number metadata
  startLine?: number;
  endLine?: number;
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

    // Collect all id= attributes (exclude data-testid, data-id, etc.)
    const controlIds = new Set<string>();
    const controlIdRegex = /(?<![a-zA-Z-])id\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
    let idMatch;
    while ((idMatch = controlIdRegex.exec(content)) !== null) {
      const id = idMatch[1] || idMatch[2] || idMatch[3];
      if (id) controlIds.add(id);
    }

    // Count id occurrences for duplicate detection
    const idCounts = new Map<string, number>();
    for (const id of controlIds) {
      const idRegex = new RegExp(`(?<![a-zA-Z-])id\\s*=\\s*(?:"|'|\\{["'])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:"|'|["']\\})`, 'g');
      const matches = content.match(idRegex);
      if (matches) idCounts.set(id, matches.length);
    }

    // Collect label[for] / htmlFor targets (covers <label>, <Label>, <FormLabel>)
    const labelForTargets = new Set<string>();
    const labelForRegex = /(?:htmlFor|for)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
    let labelForMatch;
    while ((labelForMatch = labelForRegex.exec(content)) !== null) {
      const target = labelForMatch[1] || labelForMatch[2] || labelForMatch[3];
      if (target) labelForTargets.add(target);
    }

    // Detect shadcn Form pattern: FormItem containing FormLabel + FormControl
    const hasFormPattern = /<FormLabel\b/.test(content) && /<FormControl\b/.test(content);
    const formControlRanges: Array<{start: number; end: number}> = [];
    if (hasFormPattern) {
      const formItemRegex = /<FormItem\b[^>]*>/g;
      let fiMatch;
      while ((fiMatch = formItemRegex.exec(content)) !== null) {
        const fiStart = fiMatch.index;
        const closeIdx = content.indexOf('</FormItem>', fiStart);
        if (closeIdx === -1) continue;
        const block = content.slice(fiStart, closeIdx);
        if (/<FormLabel\b/.test(block) && /<FormControl\b/.test(block)) {
          const fcStart = content.indexOf('<FormControl', fiStart);
          const fcEnd = content.indexOf('</FormControl>', fcStart);
          if (fcStart !== -1 && fcEnd !== -1 && fcEnd <= closeIdx) {
            formControlRanges.push({ start: fcStart, end: fcEnd + '</FormControl>'.length });
          }
        }
      }
    }

    // Extract imports for this file to determine component sources
    const importMap = extractImportSources(content);

    // Find form controls: native <input>, <textarea>, <select> (lowercase only)
    // AND React wrapper components from A5_WRAPPER_COMPONENT_MAP
    // Do NOT match <Select> (Radix wrapper — not the actual interactive element)
    const EXCLUDED_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button']);
    const controlNodes = extractJsxOpeningTags(content, `input|textarea|select|${A5_WRAPPER_NAMES}`);

    for (const controlNode of controlNodes) {
      const { tag: rawTag, attrs, index, fullMatch } = controlNode;
      // Normalize: native tags stay lowercase; React components get descriptive names
      const isReactComponent = /^[A-Z]/.test(rawTag);
      const tag = isReactComponent ? rawTag : rawTag.toLowerCase();
      // Skip <Select> wrapper if it somehow matches through case-insensitive extraction
      if (tag === 'Select') continue;

      // Import-aware control identification: skip wrapper components from non-UI sources
      if (isReactComponent && A5_WRAPPER_COMPONENT_MAP[tag]) {
        if (!isUiControl(tag, importMap, fullMatch)) continue;
      }

      // Exclude hidden, submit, reset, button types
      const tagLower = tag.toLowerCase();
      if (tagLower === 'input') {
        const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        const inputType = (typeMatch?.[1] || typeMatch?.[2] || 'text').toLowerCase();
        if (EXCLUDED_INPUT_TYPES.has(inputType)) continue;
      }

      // Exclude disabled controls
      if (/\bdisabled\b/.test(attrs)) continue;
      // Exclude aria-hidden="true"
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;

      const linesBefore = content.slice(0, index).split('\n');
      const lineNumber = linesBefore.length;
      const endLineNumber = lineNumber + (fullMatch.split('\n').length - 1);

      // Determine display tag and element name for wrapper components
      const wrapperInfo = isReactComponent ? A5_WRAPPER_COMPONENT_MAP[tag] : undefined;
      const elementNameVal = isReactComponent ? tag : undefined; // e.g., "Input", "SelectTrigger"
      const controlTypeVal = wrapperInfo?.controlType || tagLower; // e.g., "input", "select", "checkbox"
      const impliedRole = wrapperInfo?.impliedRole;
      const displayTag = isReactComponent && impliedRole
        ? `${tag} (role=${impliedRole})`
        : isReactComponent ? tag : tagLower;

      // Extract input type for display
      const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const inputSubtype = (controlTypeVal === 'input') ? (typeMatch?.[1] || typeMatch?.[2] || 'text') : undefined;

      // Check for valid label sources from the full opening tag (multiline + dashed props)
      const ariaLabelParsed = parseAriaLabelValue(fullMatch);
      const hasAriaLabel = ariaLabelParsed.present && ariaLabelParsed.isNonEmpty;
      const ariaLabelledByParsed = parseAriaLabelledByValue(fullMatch);
      const hasAriaLabelledBy = ariaLabelledByParsed.present && ariaLabelledByParsed.isNonEmpty;

      const controlIdParsed = parseA5AttributeFromTag(fullMatch, 'id');
      const controlId = (controlIdParsed.isNonEmpty && !controlIdParsed.isDynamic && controlIdParsed.value)
        ? controlIdParsed.value
        : null;
      const hasDynamicId = controlIdParsed.isNonEmpty && controlIdParsed.isDynamic;
      const hasExplicitLabel = !!controlId && labelForTargets.has(controlId);

      // Component-aware label resolution: check for `label` prop on wrapper components
      let hasLabelProp = false;
      let labelPropIsDynamic = false;
      if (isReactComponent && A5_WRAPPER_COMPONENT_MAP[tag]) {
        const labelPropParsed = parseA5AttributeFromTag(fullMatch, 'label');
        if (labelPropParsed.present && labelPropParsed.isNonEmpty) {
          hasLabelProp = true;
          labelPropIsDynamic = labelPropParsed.isDynamic;
        }
      }

      // Check if wrapped in <label> or <Label>
      const beforeControl = content.slice(Math.max(0, index - 500), index);
      const lastLabelOpen = Math.max(beforeControl.lastIndexOf('<label'), beforeControl.lastIndexOf('<Label'));
      const lastLabelClose = Math.max(beforeControl.lastIndexOf('</label'), beforeControl.lastIndexOf('</Label'));
      const isWrappedInLabel = lastLabelOpen > lastLabelClose && lastLabelOpen !== -1;

      // Check if inside FormControl with FormLabel (shadcn Form pattern)
      const isInFormControl = formControlRanges.some(r => index >= r.start && index <= r.end);

      // Wrapper with non-dynamic label prop is considered fully labeled
      const hasValidLabel = hasAriaLabel || hasAriaLabelledBy || hasExplicitLabel || isWrappedInLabel || isInFormControl || (hasLabelProp && !labelPropIsDynamic);

      // Wrapper with dynamic label prop (e.g., label={t('email')}) — not statically verifiable
      // If no other label source, downgrade to Potential instead of Confirmed
      const hasDynamicLabelOnly = hasLabelProp && labelPropIsDynamic && !hasAriaLabel && !hasAriaLabelledBy && !hasExplicitLabel && !isWrappedInLabel && !isInFormControl;

      // Extract placeholder
      const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2];
      const hasPlaceholder = !!placeholder && placeholder.trim().length > 0;

      // Build a label for the finding
      const nameParsed = parseA5AttributeFromTag(fullMatch, 'name');
      const elementNameAttr = (nameParsed.isNonEmpty && nameParsed.value ? nameParsed.value : '') || controlId || '';
      const label = placeholder || elementNameAttr || `<${displayTag}> control`;
      const fileName = filePath.split('/').pop() || filePath;

      // Build selector hints for element metadata
      const selectorHints: string[] = [];
      if (controlId) selectorHints.push(`id="${controlId}"`);
      else if (hasDynamicId) selectorHints.push('id=(dynamic)');
      if (nameParsed.isNonEmpty && nameParsed.value) selectorHints.push(`name="${nameParsed.value}"`);
      if (hasAriaLabel && ariaLabelParsed.evidence) selectorHints.push(ariaLabelParsed.evidence);
      if (hasAriaLabelledBy && ariaLabelledByParsed.evidence) selectorHints.push(ariaLabelledByParsed.evidence);

      // Determine labeling method for display (include evidence)
      let labelingMethod = '';
      if (isInFormControl) labelingMethod = 'FormLabel/FormControl (shadcn)';
      else if (hasLabelProp && !labelPropIsDynamic) labelingMethod = 'label prop (wrapper)';
      else if (hasAriaLabel) labelingMethod = ariaLabelParsed.evidence || 'aria-label';
      else if (hasAriaLabelledBy) labelingMethod = ariaLabelledByParsed.evidence || 'aria-labelledby';
      else if (hasExplicitLabel) labelingMethod = `label[htmlFor="${controlId}"]`;
      else if (isWrappedInLabel) labelingMethod = 'wrapping <label>';
      else if (hasDynamicLabelOnly) labelingMethod = 'label prop (dynamic — not verified)';

      // A5.3: Broken label association — label[for] targets a non-existent or duplicate id
      if (controlId && hasExplicitLabel) {
        const idCount = idCounts.get(controlId) || 0;
        if (idCount > 1) {
          const dedupeKey = `A5.3|${filePath}|${controlId}|duplicate`;
          if (!seenKeys.has(dedupeKey)) {
            seenKeys.add(dedupeKey);
            findings.push({
              elementKey: makeA5ElementKey(tag, controlId, elementNameAttr, inputSubtype || tag, filePath, lineNumber),
              elementLabel: label, elementType: displayTag, elementName: elementNameVal, controlType: controlTypeVal,
              inputSubtype, sourceLabel: label, filePath, componentName,
              subCheck: 'A5.3', subCheckLabel: 'Broken label association',
              classification: 'confirmed',
              detection: `Duplicate id="${controlId}" — ambiguous label association`,
              evidence: `<${displayTag} id="${controlId}"> at ${filePath}:${lineNumber} — ${idCount} elements share this id`,
              explanation: `Multiple elements share id="${controlId}", creating ambiguous label-control association.`,
              wcagCriteria: ['1.3.1', '3.3.2'],
              correctivePrompt: `[${label} (${displayTag})] — ${fileName}\n\nIssue reason:\nMultiple elements share id="${controlId}". The <label for="${controlId}"> cannot uniquely target the correct control.\n\nRecommended fix:\nAssign unique ids to each form control and update the corresponding <label for> attributes.`,
              deduplicationKey: dedupeKey,
              selectorHints,
              controlId,
              labelingMethod: 'broken (duplicate id)',
              startLine: lineNumber,
              endLine: endLineNumber !== lineNumber ? endLineNumber : undefined,
            });
          }
          continue; // Don't double-report
        }
      }

      if (hasValidLabel) continue; // Properly labeled — skip

      // Dynamic label prop on wrapper → downgrade to Potential and skip Confirmed paths
      if (hasDynamicLabelOnly) {
        const dedupeKey = `A5.1|${filePath}|${tag}|${label}|${lineNumber}|dynamic-label`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          findings.push({
            elementKey: makeA5ElementKey(tag, controlId || '', elementNameAttr, inputSubtype || tag, filePath, lineNumber),
            elementLabel: label, elementType: displayTag, elementName: elementNameVal, controlType: controlTypeVal,
            inputSubtype, sourceLabel: label, filePath, componentName,
            subCheck: 'A5.1', subCheckLabel: 'Missing label association',
            classification: 'potential',
            detection: `<${displayTag}> has label prop but value is dynamic — not statically verifiable`,
            evidence: `<${displayTag}> at ${filePath}:${lineNumber} — label prop present but runtime-dependent`,
            explanation: `Wrapper component <${displayTag}> has a label prop with a dynamic value that cannot be statically verified as non-empty.`,
            wcagCriteria: ['1.3.1', '3.3.2'],
            confidence: 0.50,
            potentialSubtype: 'borderline',
            deduplicationKey: dedupeKey,
            selectorHints,
            controlId: controlId || (hasDynamicId ? '(dynamic)' : undefined),
            labelingMethod,
            startLine: lineNumber,
            endLine: endLineNumber !== lineNumber ? endLineNumber : undefined,
          });
        }
        continue;
      }

      // title is NOT a valid label source — title-only inputs remain A5.1 Confirmed

      // A5.2: Placeholder-only labeling
      if (hasPlaceholder && !hasValidLabel) {
        const dedupeKey = `A5.2|${filePath}|${tag}|${label}|${lineNumber}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          findings.push({
            elementKey: makeA5ElementKey(tag, controlId || '', elementNameAttr, inputSubtype || tag, filePath, lineNumber),
            elementLabel: label, elementType: displayTag, elementName: elementNameVal, controlType: controlTypeVal,
            inputSubtype, sourceLabel: label, filePath, componentName,
            subCheck: 'A5.2', subCheckLabel: 'Placeholder used as label',
            classification: 'confirmed',
            detection: `<${displayTag}> has placeholder="${placeholder}" but no label/aria-label/aria-labelledby`,
            evidence: `<${displayTag} placeholder="${placeholder}"> at ${filePath}:${lineNumber} — missing label association`,
            explanation: `Placeholder text "${placeholder}" is the only label. Placeholders disappear on input and are not reliably announced by all screen readers.`,
            wcagCriteria: ['1.3.1', '3.3.2'],
            correctivePrompt: `[${label} (${displayTag})] — ${fileName}\n\nIssue reason:\nPlaceholder text is the only label for this control. Placeholders are not sufficient labels per WCAG 3.3.2.\n\nRecommended fix:\nAdd a persistent <label> associated with this input using for/id, or provide an accessible name via aria-label or aria-labelledby.`,
            deduplicationKey: dedupeKey,
            selectorHints,
            controlId: controlId || (hasDynamicId ? '(dynamic)' : undefined),
            labelingMethod: 'none (placeholder only)',
            startLine: lineNumber,
            endLine: endLineNumber !== lineNumber ? endLineNumber : undefined,
          });
        }
        continue; // Don't double-report as A5.1
      }

      // A5.1: Missing accessible label entirely
      // Epistemic safety: React wrapper components are library abstractions
      // that may internally provide accessible names → classify as Potential
      const isAmbiguousControl = isReactComponent;
      const dedupeKey = `A5.1|${filePath}|${tag}|${label}|${lineNumber}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        if (isAmbiguousControl) {
          findings.push({
            elementKey: makeA5ElementKey(tag, controlId || '', elementNameAttr, inputSubtype || tag, filePath, lineNumber),
            elementLabel: label, elementType: displayTag, elementName: elementNameVal, controlType: controlTypeVal,
            inputSubtype, sourceLabel: label, filePath, componentName,
            subCheck: 'A5.1', subCheckLabel: 'Missing label association',
            classification: 'potential',
            detection: `<${displayTag}> — no explicit programmatic label detected (label, aria-label, aria-labelledby). Accessible name may rely on rendered text content, which cannot be fully verified statically.`,
            evidence: `<${displayTag}> at ${filePath}:${lineNumber} — no explicit label source detected; library abstraction may provide accessible name internally`,
            explanation: `No explicit programmatic label detected for <${displayTag}>. As a library component, it may internally render an accessible name that cannot be verified statically.`,
            wcagCriteria: ['1.3.1', '3.3.2'],
            confidence: 0.70,
            potentialSubtype: 'accuracy',
            deduplicationKey: dedupeKey,
            selectorHints,
            controlId: controlId || (hasDynamicId ? '(dynamic)' : undefined),
            labelingMethod: 'no explicit label detected',
            startLine: lineNumber,
            endLine: endLineNumber !== lineNumber ? endLineNumber : undefined,
          });
        } else {
          findings.push({
            elementKey: makeA5ElementKey(tag, controlId || '', elementNameAttr, inputSubtype || tag, filePath, lineNumber),
            elementLabel: label, elementType: displayTag, elementName: elementNameVal, controlType: controlTypeVal,
            inputSubtype, sourceLabel: label, filePath, componentName,
            subCheck: 'A5.1', subCheckLabel: 'Missing label association',
            classification: 'confirmed',
            detection: `<${displayTag}> has no label, aria-label, or aria-labelledby`,
            evidence: `<${displayTag}> at ${filePath}:${lineNumber} — no programmatic label source found`,
            explanation: `Form control <${displayTag}> has no accessible name. Screen readers cannot identify what this control is for.`,
            wcagCriteria: ['1.3.1', '3.3.2'],
            correctivePrompt: `[${label} (${displayTag})] — ${fileName}\n\nIssue reason:\nThis form control has no programmatic label (no <label>, aria-label, or aria-labelledby).\n\nRecommended fix:\nAdd a visible <label> associated with this input using for + id, or provide an accessible name via aria-label or aria-labelledby.`,
            deduplicationKey: dedupeKey,
            selectorHints,
            controlId: controlId || (hasDynamicId ? '(dynamic)' : undefined),
            labelingMethod: 'none',
            startLine: lineNumber,
            endLine: endLineNumber !== lineNumber ? endLineNumber : undefined,
          });
        }
      }
    }

    let match: RegExpExecArray | null;

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
        classification: 'potential',
        detection: `<${tag} role="${role}"> — no explicit programmatic label detected (aria-label, aria-labelledby). Accessible name may rely on rendered text content, which cannot be fully verified statically.`,
        evidence: `<${tag} role="${role}"> at ${filePath}:${lineNumber} — no explicit label source; element may contain children providing accessible name`,
        explanation: `No explicit programmatic label detected for <${tag} role="${role}">. The element may contain text content or child components that provide an accessible name at runtime.`,
        wcagCriteria: ['1.3.1', '3.3.2', '4.1.2'],
        confidence: 0.70,
        potentialSubtype: 'accuracy',
        deduplicationKey: dedupeKey,
        labelingMethod: 'no explicit label detected',
        startLine: lineNumber,
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
        classification: 'potential',
        detection: `<${tag} contenteditable="true"> — no explicit programmatic label detected (aria-label, aria-labelledby). Accessible name may rely on rendered text content, which cannot be fully verified statically.`,
        evidence: `<${tag} contenteditable="true"> at ${filePath}:${lineNumber2} — no explicit label source; element may contain text providing accessible name`,
        explanation: `No explicit programmatic label detected for contenteditable element. The element may contain text content that provides an accessible name at runtime.`,
        wcagCriteria: ['1.3.1', '3.3.2', '4.1.2'],
        confidence: 0.70,
        potentialSubtype: 'accuracy',
        deduplicationKey: dedupeKey,
        labelingMethod: 'no explicit label detected',
        startLine: lineNumber2,
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

      // Check for visible text (excluding nested tags but preserving expressions)
      const strippedOfTags = innerContent.replace(/<[^>]*>/g, '');
      const visibleText = strippedOfTags.replace(/\{[^}]*\}/g, '').trim();
      if (visibleText.length > 0) return; // Has literal text content

      // Check for JSX expression children that likely render text
      // e.g., {item.label}, {label}, {title}, {t("...")}, {`${name}`}
      const exprMatches = strippedOfTags.match(/\{([^}]+)\}/g);
      if (exprMatches) {
        const TEXT_EXPR_RE = /^\{\s*(?:[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*|`[^`]*`|t\s*\(|i18n\.t\s*\(|formatMessage\s*\(|intl\.formatMessage\s*\()/;
        const TEXT_PROP_SUFFIXES = /\.(label|name|title|text|caption|heading|description|content|displayName|value)\s*\}$/;
        const SINGLE_IDENT = /^\{\s*[a-zA-Z_$][\w$]*\s*\}$/;
        const TEMPLATE_LITERAL = /^\{\s*`[^`]*`\s*\}$/;
        const I18N_CALL = /^\{\s*(?:t|i18n\.t|formatMessage|intl\.formatMessage)\s*\(/;
        for (const expr of exprMatches) {
          if (TEXT_PROP_SUFFIXES.test(expr) || SINGLE_IDENT.test(expr) || TEMPLATE_LITERAL.test(expr) || I18N_CALL.test(expr)) {
            return; // Expression likely renders visible text — has accessible name
          }
        }
      }

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
    const { zipBase64, categories, selectedRules, toolUsed, u4_llm_validator_enabled } = await req.json();

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

    const excludedFiles: ExcludedFile[] = [];
    for (const entry of entries) {
      if (entry.directory) continue;
      
      const filterResult = pFilterPath(entry.filename);
      if (!filterResult.included) {
        excludedFiles.push({ path: entry.filename, reason: filterResult.reason!, detail: filterResult.detail });
        continue;
      }
      
      try {
        const rawContent = await entry.getData!(new TextWriter());
        if (!rawContent) continue;
        const content = pNormalizeContent(rawContent);
        const canonPath = pNormalizePath(entry.filename);

        // Per-file size cap
        if (content.length > PER_FILE_SIZE_CAP) {
          excludedFiles.push({ path: entry.filename, reason: 'size_cap', detail: `${content.length} bytes > ${PER_FILE_SIZE_CAP}` });
          continue;
        }

        // Check for high replacement ratio (binary/corrupted)
        if (pHasHighReplacementRatio(content)) {
          excludedFiles.push({ path: entry.filename, reason: 'decode_error', detail: 'high replacement char ratio' });
          continue;
        }

        // Check for LFS pointers (can appear in ZIP if repo was cloned with LFS)
        if (pIsLfsPointer(content)) {
          excludedFiles.push({ path: entry.filename, reason: 'git_lfs_pointer' });
          continue;
        }

        // Always try to retain a broader set for static analysis first
        if (totalStaticSize + content.length < maxStaticContentSize) {
          allFiles.set(canonPath, content);
          totalStaticSize += content.length;
        } else {
          excludedFiles.push({ path: entry.filename, reason: 'size_cap', detail: `total exceeded ${maxStaticContentSize}` });
        }

        // Keep a smaller subset for AI context
        if (totalSize + content.length < maxContentSize) {
          files.set(canonPath, content);
          totalSize += content.length;
        }
      } catch (e) {
        console.warn(`Failed to read ${entry.filename}:`, e);
        excludedFiles.push({ path: entry.filename, reason: 'decode_error', detail: e instanceof Error ? e.message : String(e) });
      }
    }

    // Strip common root folder (ZIP exports often wrap in a single project folder)
    const allPaths = Array.from(allFiles.keys());
    const commonRoot = pDetectCommonRoot(allPaths);
    if (commonRoot) {
      const remappedAll = new Map<string, string>();
      const remappedSmall = new Map<string, string>();
      for (const [k, v] of allFiles) {
        remappedAll.set(k.startsWith(commonRoot) ? k.slice(commonRoot.length) : k, v);
      }
      for (const [k, v] of files) {
        remappedSmall.set(k.startsWith(commonRoot) ? k.slice(commonRoot.length) : k, v);
      }
      allFiles.clear();
      remappedAll.forEach((v, k) => allFiles.set(k, v));
      files.clear();
      remappedSmall.forEach((v, k) => files.set(k, v));
      console.log(`Stripped common root folder: "${commonRoot}"`);
    }
    console.log(`Excluded ${excludedFiles.length} files during ZIP ingestion`);

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
      // A1.3: theme-dependent / opacity-reduced text detection
      const themeDependentFindings = detectA1ThemeDependentText(files);
      contrastViolations.push(...themeDependentFindings);
      console.log(`Computed ${contrastViolations.length} contrast violations (incl. ${themeDependentFindings.length} A1.3 theme/opacity)`);
    } else {
      console.log('A1 not selected, skipping contrast analysis');
    }

    // Build code summary for AI
    const codeContent = Array.from(files.entries())
      .map(([path, content]) => `### File: ${path}\n\`\`\`\n${content.slice(0, 5000)}\n\`\`\``)
      .join('\n\n');

    // Extract U4 candidates (Stage 1: deterministic extraction only, no classification)
    const u4Candidates: U4Candidate[] = selectedRulesSet.has('U4') ? extractU4Candidates(allFiles) : [];
    const u4BundleText = formatU4CandidatesForLLM(u4Candidates);

    // Extract U6 layout evidence bundle (context for LLM layout assessment)
    const u6LayoutBundles = selectedRulesSet.has('U6') ? extractU6LayoutEvidence(allFiles) : [];
    const u6BundleText = formatU6LayoutEvidenceForPrompt(u6LayoutBundles);

    // Extract E1 evidence bundle (high-impact action transparency)
    const e1EvidenceBundles = selectedRulesSet.has('E1') ? extractE1EvidenceBundle(allFiles) : [];
    const e1BundleText = formatE1EvidenceBundleForPrompt(e1EvidenceBundles);
    console.log(`E1 evidence bundles: ${e1EvidenceBundles.length} active (${e1EvidenceBundles.filter(b => !b.suppressed).length} unsuppressed), prompt text length: ${e1BundleText.length}`);

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
    // Emit per-element findings with exact subtype + source location.
    const aggregatedA2List: any[] = [];
    if (selectedRulesSet.has('A2')) {
      const a2Findings = detectA2FocusVisibility(allFiles);
      if (a2Findings.length > 0) {
        const mapA2Finding = (f: A2Finding) => {
          const roleHint = f.selectorHints.find(h => h.startsWith('role='));
          const typeHint = f.selectorHints.find(h => h.startsWith('type='));
          const elementSubtype = f.elementSubtype || (() => {
            if (typeHint && (f.elementTag || '').toLowerCase() === 'input') {
              return `input[${typeHint}]`;
            }
            if (roleHint) {
              return `${f.elementTag || 'element'} ${roleHint}`;
            }
            return f.elementTag || f.elementType || 'element';
          })();

          const triggerTokens = f.triggerTokens || f.focusClasses.filter(t => /outline-none/i.test(t));
          const alternativeTokens = f.alternativeIndicatorTokens || f.focusClasses.filter(t => !/outline-none/i.test(t));
          const structuredDetection = alternativeTokens.length > 0
            ? `outline removed via "${triggerTokens.join(', ')}"\nalternative indicator detected: ${alternativeTokens.join(', ')}`
            : `outline removed via "${triggerTokens.join(', ')}"\nno visible focus indicator detected`;

          return {
            elementLabel: f.elementName !== 'unknown' ? f.elementName : f.sourceLabel,
            elementType: f.elementType,
            elementTag: f.elementTag,
            elementName: f.elementName,
            elementSubtype,
            elementSource: f.elementSource,
            role: roleHint ? roleHint.replace(/^role=["']?|["']?$/g, '') : f.elementType,
            accessibleName: '',
            sourceLabel: f.sourceLabel,
            selectorHint: `<${f.elementTag || f.elementType || 'element'}> in ${f.filePath}`,
            selectorHints: f.selectorHints,
            location: f.filePath,
            lineRange: f.lineEnd ? `${f.lineNumber}–${f.lineEnd}` : `${f.lineNumber}`,
            detection: structuredDetection,
            detectionMethod: 'deterministic' as const,
            focusClasses: f.focusClasses,
            classification: f.classification as 'confirmed' | 'potential',
            potentialSubtype: f.potentialSubtype,
            potentialReason: f.potentialReason,
            explanation: f.explanation,
            confidence: f.confidence,
            correctivePrompt: f.correctivePrompt,
            deduplicationKey: f.deduplicationKey,
            focusable: f.focusable,
            startLine: f.lineNumber,
            endLine: f.lineEnd ?? null,
            filePath: f.filePath,
            rawClassName: f.rawClassName,
            triggerTokens,
            _a2Debug: f._a2Debug,
          };
        };

        const confirmedFindings = a2Findings.filter(f => f.classification === 'confirmed');
        const potentialFindings = a2Findings.filter(f => f.classification === 'potential');

        if (confirmedFindings.length > 0) {
          aggregatedA2List.push({
            ruleId: 'A2',
            ruleName: 'Poor focus visibility',
            category: 'accessibility',
            status: 'confirmed',
            blocksConvergence: true,
            inputType: 'zip',
            isA2Aggregated: true,
            a2Elements: confirmedFindings.map(mapA2Finding),
            evaluationMethod: 'deterministic',
            diagnosis: `Focus visibility issues detected: ${confirmedFindings.length} element(s). Elements remove the default focus outline without any visible replacement.`,
            contextualHint: 'Interactive elements remove the default focus outline without a visible replacement indicator.',
            correctivePrompt: 'Add a visible focus indicator (focus ring, border change, shadow, or distinct background change) for interactive elements that remove the default outline.',
            confidence: Math.max(...confirmedFindings.map(f => f.confidence)),
          });
        }

        if (potentialFindings.length > 0) {
          aggregatedA2List.push({
            ruleId: 'A2',
            ruleName: 'Poor focus visibility',
            category: 'accessibility',
            status: 'potential',
            potentialSubtype: 'borderline',
            blocksConvergence: false,
            inputType: 'zip',
            isA2Aggregated: true,
            a2Elements: potentialFindings.map(mapA2Finding),
            evaluationMethod: 'deterministic',
            diagnosis: `Focus visibility issues detected: ${potentialFindings.length} element(s). Elements have weak focus styling that may not be sufficiently visible.`,
            contextualHint: 'Interactive elements have subtle focus indicators — verify visibility manually.',
            advisoryGuidance: 'Focus styling exists but may be too subtle. Consider using a clearer focus-visible indicator.',
            confidence: Math.max(...potentialFindings.map(f => f.confidence)),
          });
        }

        console.log(`A2 deterministic: ${a2Findings.length} raw findings → ${aggregatedA2List.length} violation object(s) (${confirmedFindings.length} confirmed, ${potentialFindings.length} potential)`);
      } else {
        console.log('A2 deterministic: No violations found');
      }
    }
    
    let aiViolations = [
      ...filteredOtherViolations,
      ...aggregatedA2List,
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
      // A4 debug: log each trigger with file+line and prereqs
      for (const f of a4Findings) {
        const hasH1 = f.subCheck === 'missing_h1' || f.detection?.includes('h1');
        const hasLandmark = f.subCheck === 'missing_landmark' || f.detection?.includes('landmark');
        const visualHeadingNoH1 = f.subCheck === 'visual_heading_no_semantic';
        console.log(`[A4] trigger: file=${f.filePath} line=${f.startLine ?? '?'} subCheck=${f.subCheck} classification=${f.classification} prereqs: hasH1=${hasH1} hasLandmark=${hasLandmark} visualHeadingNoH1=${visualHeadingNoH1} evidence="${(f.evidence || '').slice(0, 80)}"`);
      }
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
          startLine: f.startLine ?? null, endLine: f.endLine ?? null,
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
          elementLabel: f.sourceLabel, elementType: f.elementType, elementName: f.elementName, controlType: f.controlType,
          inputSubtype: f.inputSubtype, role: f.role, sourceLabel: f.sourceLabel,
          location: f.filePath, filePath: f.filePath, detection: f.detection, evidence: f.evidence,
          subCheck: f.subCheck, subCheckLabel: f.subCheckLabel,
          classification: f.classification,
          explanation: f.explanation,
          ...(f.classification === 'potential' ? { confidence: f.confidence } : {}),
          wcagCriteria: f.wcagCriteria,
          correctivePrompt: f.correctivePrompt,
          potentialSubtype: f.potentialSubtype,
          deduplicationKey: f.deduplicationKey,
          selectorHints: f.selectorHints,
          controlId: f.controlId,
          labelingMethod: f.labelingMethod,
          startLine: f.startLine ?? null,
          endLine: f.endLine ?? null,
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
        const fgResolved = v.foreground?.resolved ?? !!v.foregroundHex;
        const bgResolved = v.background?.resolved ?? (v.backgroundStatus === 'certain' && !!v.backgroundHex);
        const hasInsufficientColorContext = !fgResolved || !bgResolved || v.backgroundStatus !== 'certain';

        const ratioStr = v.contrastRatio != null ? `${v.contrastRatio.toFixed(1)}:1` : 'Not computed (requires rendered colors)';
        const threshStr = `${v.thresholdUsed || 4.5}:1`;
        const sizeLabel = v.sizeStatus === 'large' ? 'large' : 'normal';
        const fgHex = fgResolved ? (v.foregroundHex || v.foreground?.value || '???') : 'theme/variable/opacity-dependent';
        const bgHex = bgResolved ? (v.backgroundHex || v.background?.value || 'theme/variable-dependent') : 'theme/variable-dependent';
        const prompt = v.status === 'confirmed' && !hasInsufficientColorContext
          ? `Issue reason: ${ratioStr} measured vs ${threshStr} required (WCAG AA, ${sizeLabel} text).\n\nRecommended fix: Increase text contrast for this element (currently ${fgHex} on ${bgHex}) by darkening the text color or adjusting the background to reach ≥${threshStr}; keep visual style consistent across similar elements.`
          : undefined;

        return {
          elementLabel: v.variant
            ? `${v.elementIdentifier || v.elementDescription || 'Unknown element'} [${v.variant}]`
            : (v.elementIdentifier || v.elementDescription || 'Unknown element'),
          textSnippet: v.evidence,
          location: v.evidence || '',
          foregroundHex: fgResolved ? (v.foregroundHex || v.foreground?.value || undefined) : undefined,
          backgroundHex: bgResolved ? (v.backgroundHex || v.background?.value || undefined) : undefined,
          foreground: v.foreground || { value: fgResolved ? (v.foregroundHex || null) : null, resolved: !!fgResolved },
          background: v.background || { value: bgResolved ? (v.backgroundHex || null) : null, resolved: !!bgResolved, reason: !bgResolved ? 'theme/variable-dependent' : undefined },
          backgroundStatus: (bgResolved ? 'certain' : (v.backgroundStatus || 'uncertain')) as 'certain' | 'uncertain' | 'unmeasurable',
          contrastRatio: hasInsufficientColorContext ? undefined : v.contrastRatio,
          contrastNotMeasurable: hasInsufficientColorContext || v.contrastRatio === undefined,
          thresholdUsed: (v.thresholdUsed || 4.5) as 4.5 | 3.0,
          explanation: v.diagnosis,
          reasonCodes: v.reasonCodes || ['STATIC_ANALYSIS'],
          jsxTag: v.affectedComponents?.[0]?.jsxTag,
          textType: v.sizeStatus === 'large' ? 'large' : 'normal',
          appliedThreshold: v.thresholdUsed || 4.5,
          wcagCriterion: '1.4.3' as const,
          deduplicationKey: `a1|${v.elementIdentifier}|${v.foregroundHex || v.evidence}|${v.variant || 'base'}|${v.startLine || ''}`,
          correctivePrompt: prompt,
          variant: v.variant || undefined,
          lineNumber: v.lineNumber || undefined,
          filePath: v.affectedComponents?.[0]?.filePath || v.filePath,
          startLine: v.startLine ?? v.lineNumber ?? null,
          endLine: v.endLine ?? v.lineNumber ?? null,
          variantName: v.variantName || v.variant || undefined,
          extractedClasses: v.extractedClasses || undefined,
          resolutionStatus: {
            fg: fgResolved ? 'resolved' : 'unresolved',
            bg: bgResolved ? 'resolved' : 'unresolved',
          },
          unresolvedReason: !bgResolved ? (v.background?.reason || 'theme/variable-dependent') : undefined,
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
        // Deduplicate potential elements by (elementIdentifier + evidence + variant)
        const rawElements = potentialFindings.map(mapToElement);
        const dedupeMap = new Map<string, any>();
        for (const el of rawElements) {
          if (dedupeMap.has(el.deduplicationKey)) {
            // Merge: increment occurrence count
            const existing = dedupeMap.get(el.deduplicationKey);
            existing.occurrences = (existing.occurrences || 1) + 1;
          } else {
            dedupeMap.set(el.deduplicationKey, { ...el, occurrences: 1 });
          }
        }
        const a1Elements = Array.from(dedupeMap.values());
        
        const avgConf = potentialFindings.reduce((s, v) => s + v.confidence, 0) / potentialFindings.length;
        aggregatedA1Violations.push({
          ruleId: 'A1',
          ruleName: 'Insufficient text contrast',
          category: 'accessibility',
          status: 'potential',
          isA1Aggregated: true,
          a1Elements,
          diagnosis: `${a1Elements.length} text element${a1Elements.length !== 1 ? 's' : ''} with potential contrast issues (WCAG 1.4.3) — theme/variable/opacity-dependent colors require runtime verification.`,
          correctivePrompt: 'Verify text contrast meets WCAG AA requirements (4.5:1 for normal text, 3:1 for large text) using browser DevTools after rendering.',
          contextualHint: 'Verify contrast with browser DevTools or accessibility testing tools after rendering.',
          confidence: Math.round(avgConf * 100) / 100,
          reasonCodes: ['STATIC_ANALYSIS', 'THEME_DEPENDENT'],
          potentialRiskReason: 'THEME_DEPENDENT',
          advisoryGuidance: 'Theme-dependent or opacity-reduced colors cannot be verified statically. Provide a rendered screenshot or enable runtime contrast sampling to compute effective contrast.',
          blocksConvergence: false,
          inputType: 'zip',
          samplingMethod: 'inferred',
          evaluationMethod: 'deterministic',
          evidenceLevel: 'structural_estimated',
        });
        console.log(`A1 potential dedup: ${rawElements.length} raw → ${a1Elements.length} unique elements`);
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
          diagnosis: `Navigation clarity risk: ${u2Findings.length} wayfinding concern(s) detected via structural analysis.`,
          contextualHint: 'Navigation clarity risk — verify in context.',
          advisoryGuidance: 'Review navigation wayfinding: ensure users can identify their location, discover available routes, and navigate back from deep views.',
          confidence: Math.min(Math.round(overallConfidence * 100) / 100, 0.80),
        });

        console.log(`U2 aggregated: ${u2Findings.length} findings → 1 potential violation object`);
      } else {
        // If no deterministic signals, keep LLM U2 findings but:
        // 1. Ensure they are Potential
        // 2. FILTER OUT any LLM breadcrumb-depth findings — these MUST only come from deterministic D3 gate
        aiViolations = aiViolations.map((v: any) => {
          if (v.ruleId === 'U2') {
            // Reject LLM breadcrumb-depth speculations that bypass the evidence gate
            const diagnosisLower = ((v.diagnosis || '') + (v.evidence || '') + (v.contextualHint || '')).toLowerCase();
            if (/breadcrumb.*depth|breadcrumb.*shallow|breadcrumb.*level|breadcrumb.*cap|breadcrumb.*reflect|breadcrumb.*limited|breadcrumb.*not cover|breadcrumb.*deeper|breadcrumb.*insufficient/i.test(diagnosisLower)) {
              console.log('[U2] Filtered out LLM breadcrumb-depth finding — must pass deterministic D3 gate');
              return null; // will be filtered below
            }
            return {
              ...v,
              status: 'potential',
              blocksConvergence: false,
              evaluationMethod: 'hybrid_llm_fallback',
              confidence: Math.min(v.confidence || 0.65, 0.80),
            };
          }
          return v;
        }).filter(Boolean);
        console.log('U2: No deterministic signals found, LLM findings (if any) preserved as Potential (breadcrumb-depth filtered)');
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
          classification: f.classification, // confirmed | potential
          advisoryGuidance: f.advisoryGuidance, deduplicationKey: f.deduplicationKey,
          truncationType: f.truncationType, textLength: f.textLength,
          triggerReason: f.triggerReason, expandDetected: f.expandDetected,
          elementTag: f.elementTag,
          occurrences: f.occurrences,
          startLine: f.startLine ?? f.lineNumber ?? null,
          endLine: f.endLine ?? f.lineNumber ?? null,
          contentKind: f.contentKind,
          recoverySignals: f.recoverySignals,
          truncationTokens: f.truncationTokens,
        }));

        const hasConfirmed = u3Findings.some(f => f.classification === 'confirmed');
        const confirmedCount = u3Findings.filter(f => f.classification === 'confirmed').length;
        const potentialCount = u3Findings.length - confirmedCount;
        const overallConfidence = Math.max(...u3Findings.map(f => f.confidence));
        const statusLabel = hasConfirmed ? 'confirmed' : 'potential';
        const diagParts: string[] = [];
        if (confirmedCount > 0) diagParts.push(`${confirmedCount} confirmed`);
        if (potentialCount > 0) diagParts.push(`${potentialCount} potential`);
        aggregatedU3List.push({
          ruleId: 'U3', ruleName: 'Truncated or inaccessible content', category: 'usability',
          status: statusLabel,
          blocksConvergence: false, // Usability rules never block convergence
          inputType: 'zip', isU3Aggregated: true, u3Elements, evaluationMethod: 'deterministic_structural',
          diagnosis: `Content accessibility issues: ${diagParts.join(', ')} risk(s) detected via structural analysis.`,
          contextualHint: 'Ensure all meaningful text is fully visible or has an accessible expand mechanism.',
          advisoryGuidance: hasConfirmed
            ? 'Content is truncated by CSS and no accessible recovery is provided.'
            : 'Static analysis suggests possible clipping; verify in rendered UI.',
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

    // ========== U4 POST-PROCESSING (Recognition-to-Recall — Two-Stage, LLM-Mandatory) ==========
    // ALL U4 output comes from LLM (Stage 2). NEVER confirmed, always potential, max 0.65.
    const aggregatedU4List: any[] = [];
    if (selectedRulesSet.has('U4')) {
      const u4FromLLM = aiViolations.filter((v: any) => v.ruleId === 'U4');
      aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'U4');

      const allU4Elements: any[] = [];

      // Only LLM findings — no deterministic emission
      if (u4FromLLM.length > 0) {
        const aggregatedOne = u4FromLLM.find((v: any) => v.isU4Aggregated && v.u4Elements?.length > 0);
        const llmElements = aggregatedOne?.u4Elements || u4FromLLM.map((v: any) => ({
          elementLabel: v.evidence?.split('.')[0] || 'UI region',
          elementType: 'component', location: v.evidence || 'Unknown',
          detection: v.diagnosis || '', evidence: v.evidence || '',
          recommendedFix: v.contextualHint || '', confidence: v.confidence || 0.55,
          subCheck: 'U4.4', subCheckLabel: 'Generic Action Labels',
        }));

        for (const el of llmElements) {
          // ENFORCE: always potential, max confidence 0.65
          const cappedConf = Math.min(el.confidence || 0.55, 0.65);
          allU4Elements.push({
            elementLabel: el.elementLabel || 'UI region',
            elementType: el.elementType || 'component',
            location: el.location || el.filePath || 'Unknown',
            detection: el.detection || '', evidence: el.evidence || '',
            recommendedFix: el.recommendedFix || '',
            confidence: Math.round(cappedConf * 100) / 100,
            subCheck: el.subCheck || 'U4.4',
            subCheckLabel: el.subCheckLabel || 'Generic Action Labels',
            status: 'potential', // ALWAYS potential
            evaluationMethod: 'llm_assisted',
            mitigationSummary: el.mitigationSummary || '',
            deduplicationKey: el.deduplicationKey || `U4|${el.subCheck || 'U4.4'}|${el.location || ''}|${el.elementLabel || ''}`,
          });
        }
      }

      // ========== OPTIONAL U4 LLM VALIDATOR (suppression-only) ==========
      // When enabled, runs a focused LLM validation on ambiguous U4 candidates.
      // Can ONLY suppress or downgrade — never creates new findings.
      if (u4_llm_validator_enabled === true && allU4Elements.length > 0 && LOVABLE_API_KEY) {
        const ambiguousCandidates = allU4Elements.filter((el: any) => {
          const conf = el.confidence || 0.55;
          return (conf >= 0.45 && conf <= 0.70);
        });
        if (ambiguousCandidates.length > 0) {
          console.log(`U4 LLM Validator: validating ${ambiguousCandidates.length} ambiguous candidates`);
          try {
            // Build minimal structured input for each candidate
            const validationPayload = ambiguousCandidates.map((el: any) => {
              // Find matching original candidate for enriched fields
              const origCandidate = u4Candidates.find(c => 
                c.filePath === (el.location || '') && c.candidateType === (el.subCheck || '')
              );
              return {
                rule: el.subCheck || 'U4.1',
                field_label: origCandidate?.fieldLabel || el.elementLabel || '',
                placeholder: origCandidate?.fieldPlaceholder || '',
                input_type: origCandidate?.inputType || 'text',
                nearby_text: origCandidate?.nearbyText || [],
                action_context: origCandidate?.actionContext || [],
                deterministic_reason: el.detection || '',
                candidate_kind: origCandidate?.candidateKind || 'unknown',
                has_visible_required_phrase: origCandidate?.hasVisibleRequiredPhrase || false,
                known_options_detected: origCandidate?.knownOptionsDetected || false,
                known_options_examples: origCandidate?.knownOptionsExamples || [],
              };
            });

            const validatorPrompt = `You are a strict validator for U4 (Recognition-to-Recall Regression) findings.
Your task: For each candidate, decide if it is a GENUINE recognition→recall regression.

Rules:
- If it is a confirmation phrase input where the required phrase is visible (e.g., "Type DELETE to confirm"), it MUST be suppressed — this is copying, not recall.
- If it is a categorical field with no selection component and known options exist, it is likely genuine.
- If evidence is ambiguous, suppress.
- You can ONLY suppress or downgrade. You CANNOT create new findings.

Output STRICT JSON array, one entry per candidate:
[{ "index": 0, "keep_issue": true|false, "reason": "<one sentence>", "confidence_adjust": -0.20..+0.10 }]

Candidates:
${JSON.stringify(validationPayload, null, 2)}`;

            const validatorResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [{ role: "user", content: validatorPrompt }],
                temperature: 0.1,
              }),
            });

            if (validatorResponse.ok) {
              const validatorData = await validatorResponse.json();
              const validatorText = validatorData.choices?.[0]?.message?.content || '';
              // Extract JSON array from response
              const jsonMatch = validatorText.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                try {
                  const decisions = JSON.parse(jsonMatch[0]);
                  let suppressedCount = 0;
                  for (const decision of decisions) {
                    if (typeof decision.index === 'number' && decision.index < ambiguousCandidates.length) {
                      const targetEl = ambiguousCandidates[decision.index];
                      if (decision.keep_issue === false) {
                        // Remove from allU4Elements
                        const idx = allU4Elements.indexOf(targetEl);
                        if (idx >= 0) { allU4Elements.splice(idx, 1); suppressedCount++; }
                        console.log(`U4 LLM Validator SUPPRESSED: ${targetEl.elementLabel} — ${decision.reason}`);
                      } else if (typeof decision.confidence_adjust === 'number') {
                        // Apply confidence adjustment (cap to [0.40, 0.75])
                        const newConf = Math.min(0.75, Math.max(0.40, (targetEl.confidence || 0.55) + decision.confidence_adjust));
                        targetEl.confidence = Math.round(newConf * 100) / 100;
                      }
                    }
                  }
                  console.log(`U4 LLM Validator: suppressed ${suppressedCount}/${ambiguousCandidates.length}, kept ${allU4Elements.length}`);
                } catch (parseErr) {
                  console.warn('U4 LLM Validator: failed to parse response, keeping deterministic decisions', parseErr);
                }
              }
            } else {
              console.warn(`U4 LLM Validator: API error ${validatorResponse.status}, keeping deterministic decisions`);
            }
          } catch (validatorErr) {
            console.warn('U4 LLM Validator: error, falling back to deterministic decisions', validatorErr);
          }
        }
      }

      if (allU4Elements.length > 0) {
        const conf = Math.min(Math.max(...allU4Elements.map((e: any) => e.confidence)), 0.65);
        aggregatedU4List.push({
          ruleId: 'U4', ruleName: 'Recognition-to-recall regression', category: 'usability',
          status: 'potential', blocksConvergence: false,
          inputType: 'zip', isU4Aggregated: true, u4Elements: allU4Elements,
          evaluationMethod: 'llm_assisted',
          diagnosis: `Potential recognition-to-recall risks: ${allU4Elements.length} finding(s). LLM evaluated ${u4Candidates.length} candidates, reported ${allU4Elements.length}.`,
          contextualHint: 'Review to ensure recognition-based interaction is preferred over recall-dependent alternatives.',
          advisoryGuidance: 'Ensure structured selections, active state indicators, step context, and descriptive CTAs are provided where appropriate.',
          confidence: Math.round(conf * 100) / 100,
        });
        console.log(`U4 aggregated: ${allU4Elements.length} potential (from ${u4Candidates.length} candidates)`);
      } else {
        console.log(`U4: LLM suppressed all ${u4Candidates.length} candidates — no findings`);
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

    // ========== U6 POST-PROCESSING (Weak Grouping / Layout Coherence — deterministic + LLM) ==========
    const aggregatedU6List: any[] = [];
    if (selectedRulesSet.has('U6')) {
      // Check if ALL bundles are suppressed deterministically
      const allSuppressed = u6LayoutBundles.length > 0 && u6LayoutBundles.every(b => b.suppressReason);
      const suppressedFiles = u6LayoutBundles.filter(b => b.suppressReason).map(b => `${b.filePath} (${b.suppressReason})`);
      if (suppressedFiles.length > 0) {
        console.log(`U6 deterministic suppression: ${suppressedFiles.join('; ')}`);
      }

      const u6FromLLM = aiViolations.filter((v: any) => v.ruleId === 'U6');
      aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'U6');

      if (allSuppressed) {
        console.log('U6: All files pass deterministic grouping checks — suppressing all U6 findings');
      } else if (u6FromLLM.length > 0) {
        // Filter LLM findings: drop any that reference a deterministically suppressed file
        const suppressedPaths = new Set(u6LayoutBundles.filter(b => b.suppressReason).map(b => b.filePath));
        const filterElement = (el: any) => {
          const loc = el.location || el.filePath || '';
          for (const sp of suppressedPaths) {
            if (loc.includes(sp) || sp.includes(loc)) return false;
          }
          return true;
        };

        const aggregatedOne = u6FromLLM.find((v: any) => v.isU6Aggregated && v.u6Elements?.length > 0);
        let u6Elements: any[];
        if (aggregatedOne) {
          u6Elements = (aggregatedOne.u6Elements || []).filter(filterElement).map((el: any) => ({
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
        } else {
          u6Elements = u6FromLLM.filter(filterElement).map((v: any) => ({
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
        }

        // Enrich evidence with deterministic counts from bundles
        const unsuppressedBundles = u6LayoutBundles.filter(b => !b.suppressReason);
        const evidenceSummary = unsuppressedBundles.map(b =>
          `${b.filePath}: ${b.componentBlocks} component blocks, ${b.cardLikeDivs} card-like divs, ${b.sectionCount + b.articleCount + b.fieldsetCount} semantic, ~${b.majorSiblingEstimate} siblings`
        ).join('; ');

        if (u6Elements.length > 0) {
          const overallConfidence = Math.min(Math.max(...u6Elements.map((e: any) => e.confidence)), 0.80);
          aggregatedU6List.push({
            ruleId: 'U6', ruleName: 'Weak grouping / layout coherence', category: 'usability',
            status: 'potential', blocksConvergence: false,
            inputType: 'zip', isU6Aggregated: true, u6Elements, evaluationMethod: 'llm_assisted',
            diagnosis: (aggregatedOne?.diagnosis || `Layout coherence issues: ${u6Elements.length} potential risk(s).`) + ` [Structural: ${evidenceSummary}]`,
            contextualHint: aggregatedOne?.contextualHint || 'Improve grouping, alignment, and spacing to clarify content relationships.',
            advisoryGuidance: 'Use consistent spacing, section headings, and visual containers to group related elements. Establish clear visual hierarchy through alignment, whitespace, and background differentiation.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
          console.log(`U6 aggregated: ${u6FromLLM.length} LLM finding(s) → ${u6Elements.length} element(s) after suppression`);
        } else {
          console.log('U6: All LLM findings suppressed by deterministic checks');
        }
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

    // ========== E2 POST-PROCESSING (Imbalanced Choice Architecture — High-Impact Gate + LLM-assisted) ==========
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
            recommendedFix: el.recommendedFix || 'Present confirm/decline options with comparable visual weight and equal discoverability.',
            confidence: Math.min(el.confidence || 0.60, 0.75),
            evaluationMethod: 'llm_only_code' as const,
            deduplicationKey: el.deduplicationKey || `E2|${el.location || ''}|${el.elementLabel || ''}`,
          }));

          const overallConfidence = Math.min(Math.max(...e2Elements.map((e: any) => e.confidence)), 0.75);
          aggregatedE2List.push({
            ruleId: 'E2', ruleName: 'Imbalanced choice architecture in high-impact decision', category: 'ethics',
            status: 'potential', blocksConvergence: false,
            inputType: 'zip', isE2Aggregated: true, e2Elements, evaluationMethod: 'llm_assisted',
            diagnosis: aggregatedOne.diagnosis || `Choice architecture imbalance: ${e2Elements.length} potential risk(s) in high-impact decision context.`,
            contextualHint: aggregatedOne.contextualHint || 'Present confirm/decline options with comparable visual weight and equal discoverability.',
            advisoryGuidance: 'Present confirm/decline options with comparable visual weight and equal discoverability. Avoid preselected consent/paid options; ensure opt-out is as easy as opt-in.',
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
            recommendedFix: v.contextualHint || 'Present confirm/decline options with comparable visual weight and equal discoverability.',
            confidence: Math.min(v.confidence || 0.60, 0.75),
            evaluationMethod: 'llm_only_code' as const,
            deduplicationKey: `E2|${v.evidence || 'unknown'}`,
          }));

          const overallConfidence = Math.min(Math.max(...e2FromLLM.map((v: any) => v.confidence || 0.60)), 0.75);
          aggregatedE2List.push({
            ruleId: 'E2', ruleName: 'Imbalanced choice architecture in high-impact decision', category: 'ethics',
            status: 'potential', blocksConvergence: false,
            inputType: 'zip', isE2Aggregated: true, e2Elements, evaluationMethod: 'llm_assisted',
            diagnosis: `Choice architecture imbalance: ${e2Elements.length} potential risk(s) in high-impact decision context.`,
            contextualHint: 'Present confirm/decline options with comparable visual weight and equal discoverability.',
            advisoryGuidance: 'Present confirm/decline options with comparable visual weight and equal discoverability. Avoid preselected consent/paid options; ensure opt-out is as easy as opt-in.',
            confidence: Math.round(overallConfidence * 100) / 100,
          });
        }
        console.log(`E2 aggregated: ${e2FromLLM.length} LLM finding(s) → ${aggregatedE2List[0]?.e2Elements?.length || 0} element(s)`);
      } else {
        console.log('E2: No LLM findings (high-impact gate likely filtered all bundles)');
      }
    }

    // ========== E3 POST-PROCESSING (Obscured or Restricted User Control — HYBRID) ==========
    const aggregatedE3List: any[] = [];
    if (selectedRulesSet.has('E3')) {
      const deterministicE3 = e3Findings;
      const e3FromLLM = aiViolations.filter((v: any) => v.ruleId === 'E3');
      aiViolations = aiViolations.filter((v: any) => v.ruleId !== 'E3');

      const e3Elements: any[] = [];

      for (const f of deterministicE3) {
        let confidence = f.confidence;
        const llmReinforced = e3FromLLM.some((v: any) =>
          v.e3Elements?.some((el: any) => el.subCheck === f.subCheck && el.location?.includes(f.filePath.split('/').pop() || ''))
        );
        if (llmReinforced) confidence = Math.min(confidence + 0.05, 0.80);

        // Suppress below 0.65
        if (confidence < 0.65) continue;

        e3Elements.push({
          elementLabel: f.elementLabel,
          elementType: f.elementType,
          location: f.filePath,
          subCheck: f.subCheck,
          detection: f.detection,
          evidence: f.evidence,
          recommendedFix: f.recommendedFix,
          confidence: Math.min(confidence, 0.80),
          evaluationMethod: llmReinforced ? 'hybrid_structural_llm' as const : 'deterministic_structural' as const,
          deduplicationKey: f.deduplicationKey,
        });
      }

      // Add LLM-only findings (only if they pass the high-impact gate)
      if (e3FromLLM.length > 0) {
        const aggregatedLLM = e3FromLLM.find((v: any) => v.isE3Aggregated && v.e3Elements?.length > 0);
        if (aggregatedLLM) {
          for (const el of (aggregatedLLM.e3Elements || [])) {
            const alreadyCovered = e3Elements.some(e => e.subCheck === el.subCheck && e.location === el.location);
            if (!alreadyCovered) {
              const conf = Math.min(el.confidence || 0.65, 0.80);
              if (conf < 0.65) continue;
              e3Elements.push({
                elementLabel: el.elementLabel || 'High-impact action without exit',
                elementType: el.elementType || 'unknown',
                location: el.location || 'Unknown',
                subCheck: el.subCheck,
                detection: el.detection || '',
                evidence: el.evidence || '',
                recommendedFix: el.recommendedFix || '',
                confidence: conf,
                evaluationMethod: 'hybrid_structural_llm' as const,
                deduplicationKey: el.deduplicationKey || `E3|${el.location || ''}|${el.elementLabel || ''}`,
              });
            }
          }
        }
      }

      if (e3Elements.length > 0) {
        const overallConfidence = Math.min(Math.max(...e3Elements.map((e: any) => e.confidence)), 0.80);
        aggregatedE3List.push({
          ruleId: 'E3', ruleName: 'Obscured or restricted user control', category: 'ethics',
          status: 'potential', blocksConvergence: false,
          inputType: 'zip', isE3Aggregated: true, e3Elements, evaluationMethod: 'hybrid_deterministic',
          diagnosis: `Structural exit absence: ${e3Elements.length} high-impact action(s) without visible cancel/close/exit mechanism.`,
          contextualHint: 'Verify that high-impact actions provide clear exit controls (cancel, close, back, undo).',
          advisoryGuidance: 'Analysis flagged potential restriction of user control; verify structural exit mechanisms for high-impact actions.',
          confidence: Math.round(overallConfidence * 100) / 100,
        });
        console.log(`E3 aggregated: ${deterministicE3.length} deterministic + ${e3FromLLM.length} LLM → ${e3Elements.length} element(s)`);
      } else {
        console.log('E3: No findings (all suppressed or no high-impact actions without exit)');
      }
    }

    const allViolationsPreSuppression = [...aggregatedA1Violations, ...aiViolations, ...aggregatedU1List, ...aggregatedU2List, ...aggregatedU3List, ...aggregatedU4List, ...aggregatedU5List, ...aggregatedU6List, ...aggregatedE1List, ...aggregatedE2List, ...aggregatedE3List, ...(aggregatedA3 ? [aggregatedA3] : []), ...(aggregatedA4 ? [aggregatedA4] : []), ...(aggregatedA5 ? [aggregatedA5] : []), ...(aggregatedA6 ? [aggregatedA6] : [])];

    // ========== POSITIVE FINDING FILTER (Issues-Only Guardrail) ==========
    const { applyCrossRuleSuppression, filterPositiveFindings } = await import('../_shared/cross-rule-suppression.ts');
    const { kept: issuesOnly } = filterPositiveFindings(allViolationsPreSuppression);
    console.log(`Positive-filter: ${allViolationsPreSuppression.length} → ${issuesOnly.length} (removed ${allViolationsPreSuppression.length - issuesOnly.length} non-issues)`);

    // ========== CROSS-RULE SUPPRESSION (S1–S10 + fallback priority) ==========
    const { kept: allViolations, suppressedElements } = applyCrossRuleSuppression(issuesOnly);
    console.log(`Code analysis complete: ${allViolationsPreSuppression.length} pre-suppression → ${allViolations.length} violations (${suppressedElements.length} element(s) suppressed)`);

    // === PARITY DIAGNOSTICS ===
    const rulesExecuted = Array.from(selectedRulesSet);
    const findingsPerRule: Record<string, number> = {};
    for (const v of allViolations) {
      const rid = (v as any).ruleId || 'unknown';
      findingsPerRule[rid] = (findingsPerRule[rid] || 0) + 1;
    }
    const zipSnapshot = pBuildSnapshot(allFiles, 'zip', excludedFiles);
    pLogParityDiagnostics(zipSnapshot, rulesExecuted, findingsPerRule);

    return new Response(
      JSON.stringify({
        success: true,
        violations: allViolations,
        passNotes: analysisResult.passNotes || {},
        filesAnalyzed: files.size > 0 ? files.size : allFiles.size,
        stackDetected: stack,
        snapshotHash: zipSnapshot.hash,
        snapshotFileCount: zipSnapshot.metadata.totalFiles,
        snapshotTotalBytes: zipSnapshot.metadata.totalSizeBytes,
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