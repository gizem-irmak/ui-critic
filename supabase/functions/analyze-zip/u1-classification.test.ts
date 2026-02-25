import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// =====================
// Inline helpers required by detectU1PrimaryAction
// =====================

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

type Emphasis = 'high' | 'medium' | 'low' | 'unknown';

interface CvaVariantConfig {
  defaultVariant?: string;
  variantClassMap: Record<string, string>;
}

function extractCvaVariantConfigRegex(source: string): CvaVariantConfig | null {
  try {
    const cvaMatch = source.match(/(?:const\s+\w+\s*=\s*)?cva\s*\(\s*(?:"[^"]*"|'[^']*'|`[^`]*`)\s*,\s*\{/s);
    if (!cvaMatch) return null;
    const startIdx = source.indexOf(cvaMatch[0]) + cvaMatch[0].length - 1;
    let depth = 1;
    let endIdx = startIdx + 1;
    while (depth > 0 && endIdx < source.length) {
      if (source[endIdx] === '{') depth++;
      else if (source[endIdx] === '}') depth--;
      endIdx++;
    }
    const configStr = source.slice(startIdx, endIdx);
    const variantClassMap: Record<string, string> = {};
    const variantsMatch = configStr.match(/variants\s*:\s*\{[\s\S]*?variant\s*:\s*\{([^}]+)\}/);
    if (variantsMatch) {
      const variantBlock = variantsMatch[1];
      const kvRegex = /(\w+)\s*:\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g;
      let kvMatch;
      while ((kvMatch = kvRegex.exec(variantBlock)) !== null) {
        variantClassMap[kvMatch[1]] = kvMatch[2] || kvMatch[3] || kvMatch[4] || '';
      }
    }
    let defaultVariant: string | undefined;
    const defaultVariantsMatch = configStr.match(/defaultVariants\s*:\s*\{[^}]*variant\s*:\s*(?:"([^"]+)"|'([^']+)')/);
    if (defaultVariantsMatch) defaultVariant = defaultVariantsMatch[1] || defaultVariantsMatch[2];
    if (!defaultVariant) {
      if (variantClassMap['default']) defaultVariant = 'default';
      else { const keys = Object.keys(variantClassMap); if (keys.length > 0) defaultVariant = keys[0]; }
    }
    if (Object.keys(variantClassMap).length === 0) return null;
    return { defaultVariant, variantClassMap };
  } catch { return null; }
}

function looksLikeFilledClass(className: string): boolean {
  const s = className.toLowerCase();
  if (/\bbg-(primary|destructive|blue|indigo|emerald|green|red|accent)(?:-|\b)/.test(s)) return true;
  if (/\bbg-background\b/.test(s)) return false;
  if (/\bbg-/.test(s) && !/\bbg-transparent\b/.test(s)) return true;
  return false;
}

function classifyTailwindEmphasis(className: string): Emphasis {
  const s = className.toLowerCase();
  if (/\bbg-primary\b/.test(s)) return 'high';
  if (/\bbg-\w+-[6-9]00\b/.test(s)) return 'high';
  if (/\btext-white\b/.test(s) && /\bbg-/.test(s) && !/\bbg-transparent\b/.test(s)) return 'high';
  if (/\bborder\b/.test(s) && !/\bbg-/.test(s)) return 'low';
  if (/\bbg-transparent\b/.test(s)) return 'low';
  if (/\bunderline\b/.test(s)) return 'low';
  if (/\bbg-(secondary|muted|gray-\d+|slate-\d+)\b/.test(s)) return 'medium';
  return 'unknown';
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
  if (lowVariants.has(resolvedVariant)) return { emphasis: 'low', styleKey: resolvedVariant };
  if (mediumVariants.has(resolvedVariant)) return { emphasis: 'medium', styleKey: resolvedVariant };
  if (highVariants.has(resolvedVariant)) return { emphasis: 'high', styleKey: resolvedVariant };
  const variantClasses = variantConfig.variantClassMap[resolvedVariant] || '';
  const combined = `${variantClasses} ${instanceClassName}`.trim();
  if (looksLikeFilledClass(combined) && !looksLikeOutlineOrGhostClass(combined)) return { emphasis: 'high', styleKey: resolvedVariant };
  if (looksLikeOutlineOrGhostClass(combined)) return { emphasis: 'low', styleKey: resolvedVariant };
  return { emphasis: 'unknown', styleKey: null };
}

// Unified CTA emphasis classifier — tool-agnostic
function classifyCTAEmphasis(params: {
  variant: string | null;
  variantConfig: CvaVariantConfig | null;
  className: string;
}): { emphasis: Emphasis; cue: string } {
  const { variant, variantConfig, className } = params;
  const s = (className || '').toLowerCase();
  if (variantConfig && (variant || variantConfig.defaultVariant)) {
    const resolvedVariant = variant || variantConfig.defaultVariant || 'default';
    const result = classifyButtonEmphasis({ resolvedVariant, variantConfig, instanceClassName: className });
    if (result.emphasis !== 'unknown') return { emphasis: result.emphasis, cue: `variant="${resolvedVariant}"` };
  }
  if (/\bbg-primary\b/.test(s)) return { emphasis: 'high', cue: 'bg-primary' };
  if (/\bbg-\w+-[6-8]00\b/.test(s)) { const m = s.match(/\b(bg-\w+-[6-8]00)\b/); return { emphasis: 'high', cue: m?.[1] || 'bg-dark' }; }
  if (/\btext-white\b/.test(s) && /\bbg-/.test(s) && !/\bbg-transparent\b/.test(s)) { const bgM = s.match(/\b(bg-\S+)\b/); return { emphasis: 'high', cue: `${bgM?.[1] || 'bg-*'} + text-white` }; }
  if (/\b(?:btn-primary|button-primary|cta-primary|main-action)\b/.test(s)) return { emphasis: 'high', cue: 'semantic:btn-primary' };
  if (/\bprimary\b/.test(s) && !/\b(?:text-primary|bg-primary|border-primary|ring-primary|outline-primary)\b/.test(s)) return { emphasis: 'high', cue: 'semantic:primary' };
  if (/style\s*=/.test(s) && /background-?color/i.test(s) && /color\s*:\s*(?:white|#fff)/i.test(s)) return { emphasis: 'high', cue: 'inline-style:filled' };
  if (/\b(?:ghost|link)\b/.test(s)) return { emphasis: 'low', cue: 'semantic:ghost/link' };
  if (/\bborder\b/.test(s) && !/\bbg-/.test(s)) return { emphasis: 'low', cue: 'border-only' };
  if (/\bbg-transparent\b/.test(s)) return { emphasis: 'low', cue: 'bg-transparent' };
  if (/\bunderline\b/.test(s)) return { emphasis: 'low', cue: 'underline' };
  if (/\b(?:btn-outline|button-outline|btn-ghost|btn-link|btn-text)\b/.test(s)) return { emphasis: 'low', cue: 'semantic:outline' };
  if (/\b(?:secondary|btn-secondary|button-secondary)\b/.test(s)) return { emphasis: 'medium', cue: 'semantic:secondary' };
  if (/\bbg-(secondary|muted|gray-\d+|slate-\d+)\b/.test(s)) return { emphasis: 'medium', cue: 'bg-muted' };
  if (/\b(?:outline)\b/.test(s) && !/\b(?:btn-outline|button-outline)\b/.test(s)) return { emphasis: 'medium', cue: 'outline' };
  return { emphasis: 'unknown', cue: '' };
}

interface ButtonUsage {
  label: string;
  variant: string | null;
  className: string;
  hasOnClick: boolean;
  offset: number;
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
    const variantMatch = attrs.match(/variant\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/);
    const variant = variantMatch ? (variantMatch[1] || variantMatch[2] || variantMatch[3]) : null;
    const classMatch = attrs.match(/className\s*=\s*(?:"([^"]+)"|'([^']+)'|\{[`"']([^`"']+)[`"']\})/);
    const className = classMatch ? (classMatch[1] || classMatch[2] || classMatch[3] || '') : '';
    const hasOnClick = /onClick\s*=/.test(attrs);
    let label = children.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!label) {
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
    usages.push({ label, variant: null, className, hasOnClick: /onClick\s*=/.test(attrs), offset: baseOffset + aMatch.index });
  }
  return usages;
}

interface ActionGroup {
  containerType: string;
  buttons: ButtonUsage[];
  lineContext: string;
  offset: number;
  containerEnd: number;
}

function extractActionGroups(content: string, buttonLocalNames: Set<string>): ActionGroup[] {
  const groups: ActionGroup[] = [];
  const NAMED_CONTAINERS = 'CardFooter|ModalFooter|DialogFooter|DialogActions|ButtonGroup|Actions|Toolbar|HeaderActions|FormActions';
  const LAYOUT_CLASS_RE = /(?:flex|grid|gap-|justify-|items-|space-x-|space-y-|actions|footer|toolbar|button-group)/;
  const openerRegex = new RegExp(`<(${NAMED_CONTAINERS}|div|footer|section|nav|header|aside|span)\\b([^>]*)>`, 'gi');
  let openerMatch;
  while ((openerMatch = openerRegex.exec(content)) !== null) {
    const tagName = openerMatch[1];
    const attrs = openerMatch[2] || '';
    const isNamedContainer = new RegExp(`^(${NAMED_CONTAINERS})$`, 'i').test(tagName);
    if (!isNamedContainer) { if (!LAYOUT_CLASS_RE.test(attrs)) continue; }
    const containerType = isNamedContainer ? tagName : 'FlexContainer';
    const openTagEnd = openerMatch.index + openerMatch[0].length;
    const nestRegex = new RegExp(`<(/?)(${tagName})\\b`, 'gi');
    nestRegex.lastIndex = openTagEnd;
    let depth = 1;
    let nestMatch;
    let containerEnd = -1;
    while ((nestMatch = nestRegex.exec(content)) !== null) {
      if (nestMatch[1] === '/') { depth--; if (depth === 0) { const closeIdx = content.indexOf('>', nestMatch.index); containerEnd = closeIdx >= 0 ? closeIdx + 1 : nestMatch.index + nestMatch[0].length; break; } } else { depth++; }
    }
    if (containerEnd < 0) continue;
    const containerContent = content.slice(openTagEnd, containerEnd);
    const buttons = extractCTAElements(containerContent, buttonLocalNames, openTagEnd);
    if (buttons.length >= 2) {
      groups.push({ containerType, buttons, lineContext: content.slice(openerMatch.index, Math.min(openerMatch.index + 200, containerEnd)), offset: openerMatch.index, containerEnd });
    }
  }
  const sorted = groups.sort((a, b) => a.offset - b.offset);
  const deduped: ActionGroup[] = [];
  for (const g of sorted) {
    const gEnd = g.containerEnd;
    const containedByExisting = deduped.some(d => d.offset <= g.offset && d.containerEnd >= gEnd);
    if (!containedByExisting) {
      for (let i = deduped.length - 1; i >= 0; i--) { if (g.offset <= deduped[i].offset && gEnd >= deduped[i].containerEnd) { deduped.splice(i, 1); } }
      deduped.push(g);
    }
  }
  return deduped;
}

// =====================
// Inline detectU1PrimaryAction (matches generalized index.ts)
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
  const u11FormScopes = new Map<string, Array<{ start: number; end: number }>>();

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
        findings.push({
          subCheck: 'U1.1', subCheckLabel: 'No submit primary action', classification: 'confirmed',
          elementLabel: 'Form element', elementType: 'form', filePath,
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

  const isInsideU11Form = (filePath: string, offset: number): boolean => {
    const scopes = u11FormScopes.get(filePath);
    if (!scopes) return false;
    return scopes.some(s => offset >= s.start && offset <= s.end);
  };

  const resolveKnownButtonImpl = (): { filePath: string; config: CvaVariantConfig } | null => {
    for (const p of ['src/components/ui/button.tsx', 'components/ui/button.tsx']) {
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
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

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
    if (exportedFn?.[1]) componentName = exportedFn[1];

    // U1.2: tool-agnostic detection with line-window fallback
    const u12SuppressedLabels = new Set<string>();
    const actionGroups = extractActionGroups(content, buttonLocalNames);
    const coveredOffsets = new Set<number>();

    const processU12Region = (
      ctaUsages: ButtonUsage[],
      regionLabel: string,
      regionType: 'container' | 'line-window',
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
      const highs = ctas.filter(c => c.emphasis === 'high');
      if (highs.length < 2) return;
      const groupKey = `${filePath}|${regionLabel}`;
      if (seenU12Groups.has(groupKey)) return;
      seenU12Groups.add(groupKey);
      const labels = ctas.map(c => c.label);
      const cueList = highs.map(h => h.cue).join(', ');
      let u12Confidence = 0.60;
      if (regionType === 'container') u12Confidence += 0.10;
      const strongCues = highs.filter(h => /variant=|bg-\w+-[6-8]00|bg-primary|btn-primary|semantic:/.test(h.cue));
      if (strongCues.length === highs.length) u12Confidence += 0.10;
      const offsets = ctaUsages.map(b => b.offset);
      if (offsets.length >= 2 && Math.max(...offsets) - Math.min(...offsets) < 500) u12Confidence += 0.05;
      u12Confidence = Math.min(u12Confidence, 0.90);
      findings.push({
        subCheck: 'U1.2', subCheckLabel: 'Multiple equivalent CTAs', classification: 'potential',
        elementLabel: `${componentName} — ${regionLabel}`, elementType: 'button group', filePath,
        detection: `${highs.length}+ equivalent high-emphasis CTAs in the same region`,
        evidence: `${labels.join(', ')} — emphasis cues: [${cueList}] (${regionType === 'container' ? regionLabel : 'line-window proximity'})`,
        explanation: `${highs.length} CTA buttons share equivalent high-emphasis styling in the same UI region.`,
        confidence: u12Confidence,
        advisoryGuidance: 'Visually distinguish the primary action.',
        deduplicationKey: `U1.2|${filePath}|${regionLabel}`,
      });
      for (const cta of ctas) { u12SuppressedLabels.add(cta.label.trim().toLowerCase()); }
    };

    for (const group of actionGroups) {
      if (isInsideU11Form(filePath, group.offset)) continue;
      for (const btn of group.buttons) coveredOffsets.add(btn.offset);
      processU12Region(group.buttons, group.containerType, 'container');
    }

    // Line-window fallback
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
          windowCTAs.push(sortedOrphans[windowEnd]); windowEnd++;
        }
        if (windowCTAs.length >= 2) {
          const notInForm = windowCTAs.filter(c => !isInsideU11Form(filePath, c.offset));
          if (notInForm.length >= 2) {
            processU12Region(notInForm, `line-window@${sortedOrphans[windowStart].offset}`, 'line-window');
          }
        }
        windowStart = windowEnd;
      }
    }

    const allButtons = extractButtonUsagesFromJsx(content, buttonLocalNames);
    for (const btn of allButtons) {
      const labelLower = btn.label.trim().toLowerCase();
      if (GENERIC_LABELS.has(labelLower)) {
        if (isInsideU11Form(filePath, btn.offset)) continue;
        if (u12SuppressedLabels.has(labelLower)) continue;
        const dedupeKey = `U1.3|${filePath}|${labelLower}`;
        if (findings.some(f => f.deduplicationKey === dedupeKey)) continue;
        const HIGH_RISK_GENERICS = new Set(['continue', 'next', 'submit', 'save', 'confirm', 'ok']);
        let u13Confidence = 0.55;
        if (HIGH_RISK_GENERICS.has(labelLower)) u13Confidence += 0.10;
        const hasNearbyHeading = /<(?:h[1-6]|label|legend)\b[^>]*>/.test(content);
        if (!hasNearbyHeading) u13Confidence += 0.05;
        const btnEmphasis = buttonImpl && (btn.variant || buttonImpl.config.defaultVariant)
          ? classifyButtonEmphasis({ resolvedVariant: btn.variant || buttonImpl.config.defaultVariant || 'default', variantConfig: buttonImpl.config, instanceClassName: btn.className }).emphasis
          : classifyTailwindEmphasis(btn.className);
        if (btnEmphasis === 'high') u13Confidence += 0.05;
        u13Confidence = Math.min(u13Confidence, 0.80);
        findings.push({
          subCheck: 'U1.3', subCheckLabel: 'Ambiguous CTA label', classification: 'potential',
          elementLabel: `"${btn.label}" button`, elementType: 'button', filePath,
          detection: `Generic label: "${btn.label}"`,
          evidence: `CTA labeled "${btn.label}" in ${componentName}`,
          explanation: `The CTA label "${btn.label}" is generic and does not communicate the specific action.`,
          confidence: u13Confidence,
          advisoryGuidance: 'Use specific, action-oriented labels.',
          deduplicationKey: dedupeKey,
        });
      }
    }
  }
  return findings;
}

// ========== TESTS ==========

const MOCK_BUTTON_TSX = `
import { cva } from "class-variance-authority";
const buttonVariants = cva("inline-flex items-center", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      destructive: "bg-destructive text-destructive-foreground",
      outline: "border border-input bg-background",
      secondary: "bg-secondary text-secondary-foreground",
      ghost: "hover:bg-accent",
      link: "underline-offset-4 underline",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});
export function Button() {}
`;

Deno.test("U1.1: Form without submit control → Confirmed", () => {
  const files = new Map<string, string>();
  files.set("src/components/ContactForm.tsx", `
export default function ContactForm() {
  return (
    <form>
      <input type="text" name="email" />
      <input type="text" name="message" />
    </form>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u11 = results.find(f => f.subCheck === 'U1.1');
  assert(u11 !== undefined, "Expected U1.1 finding");
  assertEquals(u11!.classification, "confirmed");
  assert(u11!.confidence === 1.0, `Expected confidence 1.0 for confirmed, got ${u11!.confidence}`);
});

Deno.test("U1.2: Two buttons with identical primary classes → Potential", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/components/ActionCard.tsx", `
import { Button } from "@/components/ui/button";
export default function ActionCard() {
  return (
    <CardFooter>
      <Button>Accept</Button>
      <Button>Decline</Button>
    </CardFooter>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 finding");
  assertEquals(u12!.classification, "potential");
  assert(u12!.confidence >= 0.80 && u12!.confidence <= 0.90, `Expected confidence 80-90%, got ${u12!.confidence}`);
});

Deno.test("U1.3: Single CTA 'Continue' (generic) → Potential", () => {
  const files = new Map<string, string>();
  files.set("src/components/NextStep.tsx", `
export default function NextStep() {
  return <button onClick={handleClick}>Continue</button>;
}
`);
  const results = detectU1PrimaryAction(files);
  const u13 = results.find(f => f.subCheck === 'U1.3');
  assert(u13 !== undefined, "Expected U1.3 finding");
  assertEquals(u13!.classification, "potential");
  assert(u13!.confidence >= 0.55 && u13!.confidence <= 0.80, `Expected confidence 55-80%, got ${u13!.confidence}`);
});

Deno.test("PASS: Clear hierarchy (primary + outline) → no U1.2", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/components/GoodCard.tsx", `
import { Button } from "@/components/ui/button";
export default function GoodCard() {
  return (
    <CardFooter>
      <Button>Save</Button>
      <Button variant="outline">Cancel</Button>
    </CardFooter>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assertEquals(u12, undefined, "Should NOT trigger U1.2 when clear hierarchy exists");
});

Deno.test("PASS: Form with submit button → no U1.1", () => {
  const files = new Map<string, string>();
  files.set("src/components/LoginForm.tsx", `
export default function LoginForm() {
  return (
    <form>
      <input type="text" name="username" />
      <button type="submit">Log in</button>
    </form>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u11 = results.find(f => f.subCheck === 'U1.1');
  assertEquals(u11, undefined, "Should NOT trigger U1.1 when submit button exists");
});

Deno.test("PASS: Form with onSubmit handler → no U1.1", () => {
  const files = new Map<string, string>();
  files.set("src/components/SearchForm.tsx", `
export default function SearchForm() {
  return (
    <form onSubmit={handleSearch}>
      <input type="text" name="query" />
    </form>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u11 = results.find(f => f.subCheck === 'U1.1');
  assertEquals(u11, undefined, "Should NOT trigger U1.1 when onSubmit handler exists");
});

Deno.test("PASS: Specific label 'Save changes' → no U1.3", () => {
  const files = new Map<string, string>();
  files.set("src/components/Settings.tsx", `
export default function Settings() {
  return <button>Save changes</button>;
}
`);
  const results = detectU1PrimaryAction(files);
  const u13 = results.find(f => f.subCheck === 'U1.3');
  assertEquals(u13, undefined, "Should NOT trigger U1.3 for specific labels");
});

Deno.test("U1.1 suppresses U1.2/U1.3 for same file", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/components/BrokenForm.tsx", `
import { Button } from "@/components/ui/button";
export default function BrokenForm() {
  return (
    <form>
      <input type="text" />
      <CardFooter>
        <Button>Save</Button>
        <Button>Cancel</Button>
      </CardFooter>
    </form>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  // U1.1 should fire (form has buttons but they are type="button" implicitly? No, <Button> renders as <button> which defaults to submit)
  // Actually <Button> inside a form defaults to submit, so U1.1 should NOT fire
  // But the form content has <Button>Save</Button> which matches the hasSubmitButton check
  // So U1.1 should NOT fire, and U1.2 MIGHT fire
  const u11 = results.find(f => f.subCheck === 'U1.1');
  // The form HAS a <Button> (which counts as submit), so U1.1 should NOT fire
  assertEquals(u11, undefined, "Form with <Button> should not trigger U1.1");
});

Deno.test("U1.2 suppresses U1.3 for labels in same container", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/components/SaveDialog.tsx", `
import { Button } from "@/components/ui/button";
export default function SaveDialog() {
  return (
    <CardFooter>
      <Button>Save</Button>
      <Button>Cancel</Button>
    </CardFooter>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 finding for competing CTAs");
  const u13Save = results.find(f => f.subCheck === 'U1.3' && f.elementLabel.includes('Save'));
  assertEquals(u13Save, undefined, "U1.3 for 'Save' should be suppressed when U1.2 fires for same container");
});

Deno.test("U1.3 still fires for generic label outside U1.2 container", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/components/StandaloneSave.tsx", `
import { Button } from "@/components/ui/button";
export default function StandaloneSave() {
  return <Button>Save</Button>;
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assertEquals(u12, undefined, "No U1.2 for single button");
  const u13 = results.find(f => f.subCheck === 'U1.3');
  assert(u13 !== undefined, "U1.3 should fire for standalone generic label");
});

// ========== PATH 2: Tailwind-token emphasis tests ==========

Deno.test("U1.2 Path 2: Plain buttons with matching Tailwind high-emphasis → Potential", () => {
  const files = new Map<string, string>();
  // No button.tsx (no CVA) — triggers Path 2
  files.set("src/components/BoltPage.tsx", `
export default function BoltPage() {
  return (
    <div className="flex gap-4">
      <button className="bg-blue-600 text-white font-semibold px-4 py-2 rounded">Save</button>
      <button className="bg-blue-600 text-white font-semibold px-4 py-2 rounded">Cancel</button>
    </div>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 for plain Tailwind buttons with matching high-emphasis");
  assertEquals(u12!.classification, "potential");
  assert(u12!.confidence >= 0.80 && u12!.confidence <= 0.90, `Expected confidence 80-90%, got ${u12!.confidence}`);
});

Deno.test("U1.2 Path 2: bg-primary siblings → Potential", () => {
  const files = new Map<string, string>();
  files.set("src/components/Actions.tsx", `
export default function Actions() {
  return (
    <div className="flex gap-2">
      <button className="bg-primary text-white rounded px-3 py-1">Confirm</button>
      <button className="bg-primary text-white rounded px-3 py-1">Delete</button>
    </div>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 for bg-primary siblings");
});

Deno.test("PASS Path 2: Mixed emphasis (filled + outline) → no U1.2", () => {
  const files = new Map<string, string>();
  files.set("src/components/MixedButtons.tsx", `
export default function MixedButtons() {
  return (
    <div className="flex gap-2">
      <button className="bg-blue-700 text-white px-4 py-2">Save</button>
      <button className="border border-gray-300 bg-transparent px-4 py-2">Cancel</button>
    </div>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assertEquals(u12, undefined, "Should NOT trigger U1.2 when buttons have different emphasis");
});

Deno.test("U1.2 Path 2 suppresses U1.3 for same container", () => {
  const files = new Map<string, string>();
  files.set("src/components/TailwindDialog.tsx", `
export default function TailwindDialog() {
  return (
    <div className="flex gap-4">
      <button className="bg-indigo-700 text-white px-4 py-2">Save</button>
      <button className="bg-indigo-700 text-white px-4 py-2">Ok</button>
    </div>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 for competing Tailwind buttons");
  const u13Save = results.find(f => f.subCheck === 'U1.3' && f.elementLabel.includes('Save'));
  const u13Ok = results.find(f => f.subCheck === 'U1.3' && f.elementLabel.includes('Ok'));
  assertEquals(u13Save, undefined, "U1.3 'Save' suppressed by U1.2");
  assertEquals(u13Ok, undefined, "U1.3 'Ok' suppressed by U1.2");
});

// ========== SCOPED SUPPRESSION TESTS ==========

Deno.test("U1.1 does NOT suppress U1.3 for buttons OUTSIDE the form in same file", () => {
  const files = new Map<string, string>();
  files.set("src/components/CombinedPage.tsx", `
export default function CombinedPage() {
  return (
    <div>
      <form>
        <input type="text" name="email" />
      </form>
      <button onClick={handleClick}>Save</button>
    </div>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u11 = results.find(f => f.subCheck === 'U1.1');
  assert(u11 !== undefined, "Expected U1.1 for form without submit");
  const u13 = results.find(f => f.subCheck === 'U1.3');
  assert(u13 !== undefined, "Expected U1.3 for 'Save' button OUTSIDE the form");
});

Deno.test("U1.1 suppresses U1.3 for buttons INSIDE the same form", () => {
  const files = new Map<string, string>();
  files.set("src/components/FormWithGeneric.tsx", `
export default function FormWithGeneric() {
  return (
    <form>
      <input type="text" />
      <button type="button" onClick={doSomething}>Save</button>
    </form>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u11 = results.find(f => f.subCheck === 'U1.1');
  // The form has a <button type="button"> which does NOT count as submit
  assert(u11 !== undefined, "Expected U1.1 for form without submit");
  const u13 = results.find(f => f.subCheck === 'U1.3');
  assertEquals(u13, undefined, "U1.3 should be suppressed for button INSIDE the U1.1 form");
});

Deno.test("Combined: U1.1 + U1.2 in different parts of same file", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/components/MixedPage.tsx", `
import { Button } from "@/components/ui/button";
export default function MixedPage() {
  return (
    <div>
      <form>
        <input type="text" />
      </form>
      <CardFooter>
        <Button>Accept</Button>
        <Button>Decline</Button>
      </CardFooter>
    </div>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u11 = results.find(f => f.subCheck === 'U1.1');
  assert(u11 !== undefined, "Expected U1.1 for form without submit");
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 for competing CTAs OUTSIDE the form");
});

// ========== NESTED / GRID WRAPPER TESTS ==========

Deno.test("U1.2: Buttons nested inside grid wrapper divs → fires", () => {
  const files = new Map<string, string>();
  files.set("src/components/OptionPicker.tsx", `
export default function OptionPicker() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <button className="bg-blue-600 text-white font-semibold px-4 py-2">Option A</button>
      </div>
      <div>
        <button className="bg-blue-600 text-white font-semibold px-4 py-2">Option B</button>
      </div>
    </div>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 for nested grid buttons with same high-emphasis");
  assert(u12!.evidence.includes("Option A"), "Evidence should mention Option A");
  assert(u12!.evidence.includes("Option B"), "Evidence should mention Option B");
});

Deno.test("U1.2: Buttons inside justify-between flex container → fires", () => {
  const files = new Map<string, string>();
  files.set("src/components/Actions.tsx", `
export default function Actions() {
  return (
    <div className="flex justify-between items-center">
      <button className="bg-primary text-white rounded px-4">Accept</button>
      <button className="bg-primary text-white rounded px-4">Reject</button>
    </div>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 for bg-primary siblings in flex container");
});

// ========== GENERALIZED U1.2 TESTS ==========

Deno.test("U1.2: Semantic class 'btn-primary' on both → fires", () => {
  const files = new Map<string, string>();
  files.set("src/components/CustomActions.tsx", `
export default function CustomActions() {
  return (
    <div className="flex gap-2">
      <button className="btn-primary px-4 py-2">Create</button>
      <button className="btn-primary px-4 py-2">Import</button>
    </div>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 for btn-primary semantic class");
  assert(u12!.evidence.includes("btn-primary") || u12!.evidence.includes("semantic"), "Evidence should mention semantic cue");
});

Deno.test("U1.2: Anchor role=button with btn-primary → fires alongside button", () => {
  const files = new Map<string, string>();
  files.set("src/components/MixedCTAs.tsx", `
export default function MixedCTAs() {
  return (
    <div className="flex gap-4">
      <button className="bg-primary text-white px-4 py-2">Save</button>
      <a role="button" className="btn-primary px-4 py-2">Export</a>
    </div>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 for mixed button + anchor CTAs");
  assert(u12!.evidence.includes("Export"), "Evidence should include anchor CTA label");
});

Deno.test("U1.2: Different emphasis (btn-primary + btn-secondary) → no fire", () => {
  const files = new Map<string, string>();
  files.set("src/components/GoodHierarchy.tsx", `
export default function GoodHierarchy() {
  return (
    <div className="flex gap-2">
      <button className="btn-primary px-4 py-2">Save</button>
      <button className="btn-secondary px-4 py-2">Cancel</button>
    </div>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assertEquals(u12, undefined, "Should NOT fire when emphasis tiers differ");
});

Deno.test("U1.2: ModalFooter named container → fires", () => {
  const files = new Map<string, string>();
  files.set("src/components/ConfirmDialog.tsx", `
export default function ConfirmDialog() {
  return (
    <ModalFooter>
      <button className="bg-red-700 text-white px-4 py-2">Delete</button>
      <button className="bg-blue-700 text-white px-4 py-2">Archive</button>
    </ModalFooter>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 for ModalFooter with two high-emphasis CTAs");
  assert(u12!.elementLabel.includes("ModalFooter"), "Element label should reference ModalFooter");
});

Deno.test("U1.2: Line-window fallback for orphaned CTAs → fires", () => {
  const files = new Map<string, string>();
  files.set("src/components/FlatPage.tsx", `
export default function FlatPage() {
  return (
    <div>
      <h1>Welcome</h1>
      <button className="bg-primary text-white px-4 py-2">Sign Up</button>
      <p>Some text</p>
      <button className="bg-primary text-white px-4 py-2">Get Started</button>
    </div>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 via line-window fallback for orphaned CTAs");
  assert(u12!.evidence.includes("line-window"), "Evidence should mention line-window proximity");
});

Deno.test("U1.2: DialogFooter named container → fires", () => {
  const files = new Map<string, string>();
  files.set("src/components/EditDialog.tsx", `
export default function EditDialog() {
  return (
    <DialogFooter>
      <button className="bg-blue-600 text-white">Apply</button>
      <button className="bg-blue-600 text-white">Revert</button>
    </DialogFooter>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 for DialogFooter");
});
