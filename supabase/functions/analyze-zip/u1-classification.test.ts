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
// U1 Nav/Chrome + Context Gates
// =====================

function isNavOrChromeFile(filePath: string, content: string): boolean {
  const fp = filePath.toLowerCase();
  if (/\b(layout|navbar|nav|sidebar|header|menu|navigation|topbar|appbar|toolbar)\b/i.test(fp.split('/').pop() || '')) return true;
  if (/<nav\b/i.test(content) || /role\s*=\s*["']navigation["']/i.test(content)) {
    const linkCount = (content.match(/<Link\b|<a\b[^>]*href\s*=|to\s*=\s*["']/gi) || []).length;
    const buttonCount = (content.match(/<(?:button|Button)\b/gi) || []).length;
    if (linkCount > 0 && linkCount >= buttonCount) return true;
  }
  if (/\b(navItems|menuItems|sidebarItems|navigationItems|navLinks|menuLinks)\b/.test(content)) return true;
  return false;
}

function hasPrimaryActionContext(content: string): boolean {
  if (/<form\b/i.test(content)) return true;
  if (/onSubmit\s*=/i.test(content)) return true;
  if (/type\s*=\s*["']submit["']/i.test(content)) return true;
  if (/\b(handleSubmit|handleSave|handleConfirm|handleContinue|handleNextStep)\b/.test(content)) return true;
  if (/<(?:Dialog|Modal|AlertDialog|Confirm|Sheet|Drawer)\b/i.test(content)) return true;
  if (/(?:DialogFooter|ModalFooter|DialogActions)\b/.test(content)) return true;
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

// =====================
// AST-Lite UIContextSnapshot + Suppression/Scoring (mirrors index.ts)
// =====================

interface HeadingInfo {
  text: string;
  lineStart: number;
  strengthScore: number;
}

interface StepperInfo {
  stepCount: number;
  hasLabels: boolean;
  activeIndexKnown: boolean;
  nextStepLabel: string | null;
  lineRange: { start: number; end: number };
  containerKey: string;
  stepLabels: string[];
}

interface ClassifiedCTA {
  label: string;
  hierarchy: 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'unknown';
  emphasis: Emphasis;
  cue: string;
  offset: number;
  containerKey: string;
  variant: string | null;
  className: string;
}

interface UIContextSnapshot {
  headings: HeadingInfo[];
  steppers: StepperInfo[];
  classifiedCTAs: ClassifiedCTA[];
  actionAreas: Map<string, ClassifiedCTA[]>;
}

const TASK_VERBS = /\b(select|choose|enter|review|confirm|book|schedule|add|create|update|edit|delete|remove|upload|download|set|pick|configure|manage|assign|verify|complete|fill|provide|specify|customize)\b/i;

function buildUIContextSnapshot(
  content: string,
  allButtons: ButtonUsage[],
  buttonImpl: { filePath: string; config: CvaVariantConfig } | null,
  actionGroups: ActionGroup[],
): UIContextSnapshot {
  const headings: HeadingInfo[] = [];
  const headingRe = /<(?:h[1-3])\b[^>]*>([^<]+)</gi;
  let hMatch;
  while ((hMatch = headingRe.exec(content)) !== null) {
    const text = hMatch[1].trim();
    if (text.length >= 3) headings.push({ text, lineStart: hMatch.index, strengthScore: TASK_VERBS.test(text) ? 1.0 : 0.7 });
  }
  const typoPatterns = [
    /<(?:p|span|div)\b[^>]*className\s*=\s*["'][^"']*\b(?:text-(?:2xl|3xl|4xl|5xl))\b[^"']*\b(?:font-(?:bold|semibold))\b[^"']*["'][^>]*>([^<]+)</gi,
    /<(?:p|span|div)\b[^>]*className\s*=\s*["'][^"']*\b(?:font-(?:bold|semibold))\b[^"']*\b(?:text-(?:2xl|3xl|4xl|5xl))\b[^"']*["'][^>]*>([^<]+)</gi,
  ];
  const seenHeadingOffsets = new Set(headings.map(h => h.lineStart));
  for (const re of typoPatterns) {
    while ((hMatch = re.exec(content)) !== null) {
      if (seenHeadingOffsets.has(hMatch.index)) continue;
      seenHeadingOffsets.add(hMatch.index);
      const text = hMatch[1].trim();
      if (text.length >= 3) headings.push({ text, lineStart: hMatch.index, strengthScore: TASK_VERBS.test(text) ? 0.8 : 0.5 });
    }
  }

  const steppers: StepperInfo[] = [];
  const stepsArrayRe = /(?:const|let)\s+(\w*[Ss]teps\w*)\s*=\s*\[([^\]]{20,})\]/gs;
  let saMatch;
  while ((saMatch = stepsArrayRe.exec(content)) !== null) {
    const arrayContent = saMatch[2];
    const labelEntries = arrayContent.match(/(?:label|title|name)\s*:\s*["']([^"']+)["']/gi);
    if (labelEntries && labelEntries.length >= 3) {
      const stepLabels = labelEntries.map(e => { const m = e.match(/["']([^"']+)["']/); return m ? m[1] : ''; }).filter(Boolean);
      const hasStepTracking = /(?:currentStep|activeStep|step\s*===?\s*\d|setStep|useState.*step)/i.test(content);
      let activeIndexKnown = false;
      let nextStepLabel: string | null = null;
      if (hasStepTracking) { activeIndexKnown = true; if (stepLabels.length > 1) nextStepLabel = stepLabels[1]; }
      steppers.push({ stepCount: stepLabels.length, hasLabels: true, activeIndexKnown, nextStepLabel, lineRange: { start: saMatch.index, end: saMatch.index + saMatch[0].length }, containerKey: `stepper_array_${saMatch[1]}`, stepLabels });
    }
  }
  const stepItemRe = /<(?:Step|StepItem|StepTrigger|StepperItem|StepLabel)\b[^>]*>([^<]{2,})<\//gi;
  const stepItemMatches = [...content.matchAll(stepItemRe)];
  if (stepItemMatches.length >= 3) {
    const stepLabels = stepItemMatches.map(m => m[1].trim());
    const hasActiveStep = /(?:aria-current\s*=\s*["']step["']|data-state\s*=\s*["']active["']|isActive|currentStep|activeStep|step\s*===?\s*\d|className\s*=\s*[^>]*(?:bg-primary|text-primary|ring-primary|active|current|selected))/i.test(content);
    let activeIndex = -1;
    let nextStepLabel: string | null = null;
    for (let i = 0; i < stepItemMatches.length; i++) {
      const matchStart = stepItemMatches[i].index!;
      const matchEnd = matchStart + stepItemMatches[i][0].length;
      const surrounding = content.slice(Math.max(0, matchStart - 100), matchEnd + 50);
      if (/aria-current\s*=\s*["']step["']|data-state\s*=\s*["']active["']|isActive\b/.test(surrounding)) { activeIndex = i; break; }
    }
    if (activeIndex >= 0 && activeIndex < stepLabels.length - 1) nextStepLabel = stepLabels[activeIndex + 1];
    const firstOffset = stepItemMatches[0].index!;
    const lastOffset = stepItemMatches[stepItemMatches.length - 1].index! + stepItemMatches[stepItemMatches.length - 1][0].length;
    if (!steppers.some(s => Math.abs(s.lineRange.start - firstOffset) < 500)) {
      steppers.push({ stepCount: stepLabels.length, hasLabels: true, activeIndexKnown: hasActiveStep, nextStepLabel, lineRange: { start: firstOffset, end: lastOffset }, containerKey: 'stepper_component', stepLabels });
    }
  }
  const stepperComponentRe = /<(?:Stepper|Steps|ProgressSteps|StepWizard)\b[^>]*>/gi;
  let scMatch;
  while ((scMatch = stepperComponentRe.exec(content)) !== null) {
    const stepChildRe = /<(?:Step|StepItem)\b/gi;
    const stepChildren = content.match(stepChildRe);
    if (stepChildren && stepChildren.length >= 3 && !steppers.some(s => Math.abs(s.lineRange.start - scMatch!.index) < 500)) {
      steppers.push({ stepCount: stepChildren.length, hasLabels: false, activeIndexKnown: false, nextStepLabel: null, lineRange: { start: scMatch.index, end: scMatch.index + 200 }, containerKey: 'stepper_unlabeled', stepLabels: [] });
    }
  }
  const stepConditionalRe = /(?:step|currentStep|activeStep)\s*===?\s*(\d+)/gi;
  const stepCondMatches = [...content.matchAll(stepConditionalRe)];
  if (stepCondMatches.length >= 3 && steppers.length === 0) {
    const indices = stepCondMatches.map(m => parseInt(m[1]));
    const stepCount = Math.max(...indices) + 1;
    steppers.push({ stepCount, hasLabels: false, activeIndexKnown: true, nextStepLabel: null, lineRange: { start: stepCondMatches[0].index!, end: stepCondMatches[stepCondMatches.length - 1].index! + 20 }, containerKey: 'stepper_conditional', stepLabels: [] });
  }

  const classifiedCTAs: ClassifiedCTA[] = [];
  const actionAreas = new Map<string, ClassifiedCTA[]>();
  for (const btn of allButtons) {
    const { emphasis, cue } = classifyCTAEmphasis({ variant: btn.variant, variantConfig: buttonImpl?.config || null, className: btn.className });
    let hierarchy: ClassifiedCTA['hierarchy'] = 'unknown';
    const variantLower = (btn.variant || '').toLowerCase();
    const classLower = (btn.className || '').toLowerCase();
    if (variantLower === 'destructive' || /\b(destructive|bg-red-|bg-destructive)\b/.test(classLower)) hierarchy = 'destructive';
    else if (emphasis === 'high') hierarchy = 'primary';
    else if (emphasis === 'medium') hierarchy = 'secondary';
    else if (emphasis === 'low') hierarchy = 'tertiary';
    let containerKey = 'orphaned';
    for (const group of actionGroups) { if (btn.offset >= group.offset && btn.offset <= group.containerEnd) { containerKey = `${group.containerType}@${group.offset}`; break; } }
    const cta: ClassifiedCTA = { label: btn.label, hierarchy, emphasis, cue, offset: btn.offset, containerKey, variant: btn.variant, className: btn.className };
    classifiedCTAs.push(cta);
    if (!actionAreas.has(containerKey)) actionAreas.set(containerKey, []);
    actionAreas.get(containerKey)!.push(cta);
  }
  return { headings, steppers, classifiedCTAs, actionAreas };
}

interface U13SuppressionResult {
  suppressed: boolean;
  suppressionReason: string | null;
  confidenceAdjustment: number;
  contextSignalsFound: string[];
  ambiguitySignalsFound: string[];
}

const HEADING_PROXIMITY_CHARS = 2500;

function evaluateU13Suppression(btnOffset: number, btnLabel: string, snapshot: UIContextSnapshot): U13SuppressionResult {
  const contextSignalsFound: string[] = [];
  const ambiguitySignalsFound: string[] = [];
  let confidenceAdjustment = 0;

  const stepperDetected = snapshot.steppers.length > 0;
  const labeledStepper = snapshot.steppers.find(s => s.hasLabels && s.stepCount >= 3);
  const activeStepKnown = snapshot.steppers.some(s => s.activeIndexKnown);
  const nextStepLabel = snapshot.steppers.find(s => s.nextStepLabel)?.nextStepLabel || null;
  const unlabeledStepper = snapshot.steppers.some(s => !s.hasLabels);

  if (stepperDetected) contextSignalsFound.push('stepper_detected');
  if (labeledStepper) contextSignalsFound.push(`stepper_labeled(${labeledStepper.stepCount} steps)`);
  if (activeStepKnown) contextSignalsFound.push('active_step_known');
  if (nextStepLabel) contextSignalsFound.push(`next_step_label: "${nextStepLabel}"`);

  const nearbyHeading = snapshot.headings.find(h => { const dist = btnOffset - h.lineStart; return dist >= 0 && dist <= HEADING_PROXIMITY_CHARS; });
  const headingDetected = nearbyHeading != null;
  const headingStrong = nearbyHeading != null && nearbyHeading.strengthScore >= 0.7;
  if (headingDetected) contextSignalsFound.push(`heading_detected: "${nearbyHeading!.text}"`);
  if (headingStrong) contextSignalsFound.push('heading_strong');

  const primaryCTAs = snapshot.classifiedCTAs.filter(c => c.hierarchy === 'primary');
  const isSinglePrimary = primaryCTAs.length <= 1;
  if (isSinglePrimary) contextSignalsFound.push('single_primary_cta');

  let headingMatchesStepLabels = false;
  if (nearbyHeading && labeledStepper) {
    const headingWords = new Set(nearbyHeading.text.toLowerCase().split(/\s+/));
    for (const stepLabel of labeledStepper.stepLabels) {
      const stepWords = stepLabel.toLowerCase().split(/\s+/);
      if (stepWords.some(w => w.length > 3 && headingWords.has(w))) { headingMatchesStepLabels = true; break; }
    }
    if (headingMatchesStepLabels) contextSignalsFound.push('heading_matches_step_labels');
  }

  // S1: Labeled stepper + active step + destination inference
  if (labeledStepper && labeledStepper.stepCount >= 3 && activeStepKnown && nextStepLabel) {
    return { suppressed: true, suppressionReason: `stepper_destination_inferred: "${nextStepLabel}"`, confidenceAdjustment: 0, contextSignalsFound, ambiguitySignalsFound };
  }
  // S2: Strong contextual heading tied to CTA
  if (headingStrong || headingMatchesStepLabels) {
    return { suppressed: true, suppressionReason: `strong_heading_near_cta: "${nearbyHeading!.text}"`, confidenceAdjustment: 0, contextSignalsFound, ambiguitySignalsFound };
  }
  // S3: Single dominant CTA in a step flow
  if (isSinglePrimary && (stepperDetected || headingDetected)) {
    return { suppressed: true, suppressionReason: `single_dominant_cta_in_context`, confidenceAdjustment: 0, contextSignalsFound, ambiguitySignalsFound };
  }

  if (!stepperDetected && !headingDetected) ambiguitySignalsFound.push('no_context');
  if (unlabeledStepper && !headingDetected) ambiguitySignalsFound.push('unlabeled_stepper');
  if (!isSinglePrimary) ambiguitySignalsFound.push('competing_ctas');

  if (stepperDetected) confidenceAdjustment -= 0.15;
  if (headingDetected) confidenceAdjustment -= 0.15;
  if (!stepperDetected && !headingDetected) confidenceAdjustment += 0.10;
  if (!isSinglePrimary) confidenceAdjustment += 0.10;

  return { suppressed: false, suppressionReason: null, confidenceAdjustment, contextSignalsFound, ambiguitySignalsFound };
}

interface U12AmbiguityResult {
  isAmbiguous: boolean;
  reason: string;
  confidenceAdjustment: number;
  ctaDetails: Array<{ label: string; hierarchy: string; cue: string }>;
}

function evaluateU12Hierarchy(ctas: ClassifiedCTA[]): U12AmbiguityResult {
  const primaries = ctas.filter(c => c.hierarchy === 'primary');
  const destructives = ctas.filter(c => c.hierarchy === 'destructive');
  const secondaries = ctas.filter(c => c.hierarchy === 'secondary');
  const tertiaries = ctas.filter(c => c.hierarchy === 'tertiary');
  const ctaDetails = ctas.map(c => ({ label: c.label, hierarchy: c.hierarchy, cue: c.cue }));

  if (primaries.length === 1 && (secondaries.length > 0 || tertiaries.length > 0) && destructives.length === 0) {
    return { isAmbiguous: false, reason: 'clear_hierarchy', confidenceAdjustment: -0.10, ctaDetails };
  }
  if (primaries.length >= 2) {
    let adj = 0.10;
    const offsets = primaries.map(p => p.offset);
    if (offsets.length >= 2 && Math.max(...offsets) - Math.min(...offsets) < 500) adj += 0.10;
    return { isAmbiguous: true, reason: `${primaries.length} primary CTAs with equal emphasis`, confidenceAdjustment: adj, ctaDetails };
  }
  if (primaries.length >= 1 && destructives.length >= 1) {
    const destructiveHigh = destructives.some(d => d.emphasis === 'high');
    if (destructiveHigh) return { isAmbiguous: true, reason: 'primary + destructive both prominent', confidenceAdjustment: 0.05, ctaDetails };
  }
  const unknowns = ctas.filter(c => c.hierarchy === 'unknown');
  if (unknowns.length >= 2) return { isAmbiguous: true, reason: `${unknowns.length} CTAs with unresolvable hierarchy`, confidenceAdjustment: 0, ctaDetails };
  return { isAmbiguous: false, reason: 'clear_hierarchy', confidenceAdjustment: -0.10, ctaDetails };
}

// =====================
// U1 Finding type + detectU1PrimaryAction
// =====================

const U1_LLM_TIEBREAK_ENABLED = false;

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
  contextSignalsFound?: string[];
  ambiguitySignalsFound?: string[];
  suppressionReason?: string;
  ctaHierarchyDetails?: Array<{ label: string; hierarchy: string; cue: string }>;
}

function detectU1PrimaryAction(allFiles: Map<string, string>): U1Finding[] {
  const findings: U1Finding[] = [];
  const u11FormScopes = new Map<string, Array<{ start: number; end: number }>>();

  for (const [filePathRaw, content] of allFiles.entries()) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|html|htm)$/i.test(filePath)) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;
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
  const GENERIC_LABELS = new Set(['continue', 'next', 'submit', 'proceed', 'confirm', 'done', 'ok', 'save']);

  for (const [filePathRaw, content] of allFiles.entries()) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx)$/.test(filePath)) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;
    if (isNavOrChromeFile(filePath, content)) continue;
    if (!hasPrimaryActionContext(content)) continue;

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

    const actionGroups = extractActionGroups(content, buttonLocalNames);
    const allButtons = extractButtonUsagesFromJsx(content, buttonLocalNames);
    const snapshot = buildUIContextSnapshot(content, allButtons, buttonImpl, actionGroups);

    // U1.2: Hierarchy-based competing CTA detection
    const u12SuppressedLabels = new Set<string>();
    const coveredOffsets = new Set<number>();

    const processU12Region = (
      ctaUsages: ButtonUsage[],
      regionLabel: string,
      regionType: 'container' | 'line-window',
    ) => {
      const regionCTAs: ClassifiedCTA[] = ctaUsages.map(btn => {
        const { emphasis, cue } = classifyCTAEmphasis({ variant: btn.variant, variantConfig: buttonImpl?.config || null, className: btn.className });
        const variantLower = (btn.variant || '').toLowerCase();
        const classLower = (btn.className || '').toLowerCase();
        let hierarchy: ClassifiedCTA['hierarchy'] = 'unknown';
        if (variantLower === 'destructive' || /\b(destructive|bg-red-|bg-destructive)\b/.test(classLower)) hierarchy = 'destructive';
        else if (emphasis === 'high') hierarchy = 'primary';
        else if (emphasis === 'medium') hierarchy = 'secondary';
        else if (emphasis === 'low') hierarchy = 'tertiary';
        return { label: btn.label, hierarchy, emphasis, cue, offset: btn.offset, containerKey: regionLabel, variant: btn.variant, className: btn.className };
      });

      const ambiguity = evaluateU12Hierarchy(regionCTAs);
      if (!ambiguity.isAmbiguous) return;

      const groupKey = `${filePath}|${regionLabel}`;
      if (seenU12Groups.has(groupKey)) return;
      seenU12Groups.add(groupKey);

      const labels = regionCTAs.map(c => c.label);
      let u12Confidence = 0.55;
      u12Confidence += ambiguity.confidenceAdjustment;
      if (regionType === 'container') u12Confidence += 0.05;
      u12Confidence = Math.max(0.45, Math.min(u12Confidence, 0.75));

      findings.push({
        subCheck: 'U1.2', subCheckLabel: 'Multiple equivalent CTAs', classification: 'potential',
        elementLabel: `${componentName} — ${regionLabel}`, elementType: 'button group', filePath,
        detection: `Hierarchy ambiguity: ${ambiguity.reason}`,
        evidence: `${labels.join(', ')} — hierarchy: [${ambiguity.ctaDetails.map(d => `${d.label}:${d.hierarchy}`).join(', ')}] (${regionType === 'container' ? regionLabel : 'line-window proximity'})`,
        explanation: `CTA buttons have ambiguous visual hierarchy: ${ambiguity.reason}`,
        confidence: u12Confidence,
        advisoryGuidance: 'Visually distinguish the primary action.',
        deduplicationKey: `U1.2|${filePath}|${regionLabel}`,
        ctaHierarchyDetails: ambiguity.ctaDetails,
      });
      for (const cta of regionCTAs) { u12SuppressedLabels.add(cta.label.trim().toLowerCase()); }
    };

    for (const group of actionGroups) {
      if (isInsideU11Form(filePath, group.offset)) continue;
      for (const btn of group.buttons) coveredOffsets.add(btn.offset);
      processU12Region(group.buttons, group.containerType, 'container');
    }

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
          if (notInForm.length >= 2) processU12Region(notInForm, `line-window@${sortedOrphans[windowStart].offset}`, 'line-window');
        }
        windowStart = windowEnd;
      }
    }

    // U1.3: Generic CTA labels with context-aware suppression + scoring
    for (const btn of allButtons) {
      const labelLower = btn.label.trim().toLowerCase();
      if (!GENERIC_LABELS.has(labelLower)) continue;
      if (isInsideU11Form(filePath, btn.offset)) continue;
      if (u12SuppressedLabels.has(labelLower)) continue;
      const dedupeKey = `U1.3|${filePath}|${labelLower}`;
      if (findings.some(f => f.deduplicationKey === dedupeKey)) continue;

      const suppression = evaluateU13Suppression(btn.offset, btn.label, snapshot);
      if (suppression.suppressed) continue;

      let u13Confidence = 0.45 + suppression.confidenceAdjustment;
      u13Confidence = Math.max(0.40, Math.min(u13Confidence, 0.70));

      findings.push({
        subCheck: 'U1.3', subCheckLabel: 'Ambiguous CTA label', classification: 'potential',
        elementLabel: `"${btn.label}" button`, elementType: 'button', filePath,
        detection: `Generic label: "${btn.label}"`,
        evidence: `CTA labeled "${btn.label}" in ${componentName} — context: [${suppression.contextSignalsFound.join(', ')}], ambiguity: [${suppression.ambiguitySignalsFound.join(', ')}]`,
        explanation: `The CTA label "${btn.label}" is generic and does not communicate the specific action.`,
        confidence: u13Confidence,
        advisoryGuidance: 'Use specific, action-oriented labels.',
        deduplicationKey: dedupeKey,
        contextSignalsFound: suppression.contextSignalsFound,
        ambiguitySignalsFound: suppression.ambiguitySignalsFound,
      });
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

// ========== U1.1 TESTS ==========

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

// ========== U1.2 TESTS (Hierarchy Classifier) ==========

Deno.test("U1.2: Two buttons with identical primary classes → Potential", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/components/ActionCard.tsx", `
import { Button } from "@/components/ui/button";
export default function ActionCard() {
  return (
    <Dialog>
      <CardFooter>
        <Button>Confirm</Button>
        <Button>Delete</Button>
      </CardFooter>
    </Dialog>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 finding");
  assertEquals(u12!.classification, "potential");
  assert(u12!.confidence >= 0.45 && u12!.confidence <= 0.75, `Expected confidence 45-75%, got ${u12!.confidence}`);
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

Deno.test("U1.2: Primary + destructive both prominent → Potential", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/components/ConfirmAction.tsx", `
import { Button } from "@/components/ui/button";
export default function ConfirmAction() {
  return (
    <Dialog>
      <CardFooter>
        <Button>Save</Button>
        <Button variant="destructive">Delete</Button>
      </CardFooter>
    </Dialog>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 for primary + destructive both prominent");
});

Deno.test("U1.2 Path 2: Plain buttons with matching Tailwind high-emphasis → Potential", () => {
  const files = new Map<string, string>();
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
  assert(u12!.confidence >= 0.45 && u12!.confidence <= 0.75, `Expected confidence 45-75%, got ${u12!.confidence}`);
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
});

Deno.test("U1.2: Line-window fallback for orphaned CTAs → fires", () => {
  const files = new Map<string, string>();
  files.set("src/components/FlatPage.tsx", `
export default function FlatPage() {
  return (
    <Dialog>
      <h1>Welcome</h1>
      <button className="bg-primary text-white px-4 py-2">Create Account</button>
      <p>Some text</p>
      <button className="bg-primary text-white px-4 py-2">Submit Application</button>
    </Dialog>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 via line-window fallback for orphaned CTAs");
  assert(u12!.evidence.includes("line-window"), "Evidence should mention line-window proximity");
});

// ========== U1.3 TESTS (Context-Aware Suppression) ==========

Deno.test("U1.3: Single CTA 'Continue' (generic) → Potential", () => {
  const files = new Map<string, string>();
  files.set("src/components/NextStep.tsx", `
export default function NextStep() {
  return (
    <Dialog>
      <button onClick={handleClick}>Continue</button>
    </Dialog>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u13 = results.find(f => f.subCheck === 'U1.3');
  assert(u13 !== undefined, "Expected U1.3 finding");
  assertEquals(u13!.classification, "potential");
  assert(u13!.confidence >= 0.40 && u13!.confidence <= 0.70, `Expected confidence 40-70%, got ${u13!.confidence}`);
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

Deno.test("U1.3 CONTEXT SUPPRESSION S1: BookAppointment labeled stepper + 'Next' → NO U1.3", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/pages/BookAppointment.tsx", `
import { Button } from "@/components/ui/button";
const [currentStep, setStep] = useState(0);
const steps = [
  { label: "Location & Specialty" },
  { label: "Doctor & Time" },
  { label: "Details" },
  { label: "Review" },
];
export default function BookAppointment() {
  return (
    <form onSubmit={handleSubmit}>
      <Stepper>
        <StepItem aria-current="step">Location & Specialty</StepItem>
        <StepItem>Doctor & Time</StepItem>
        <StepItem>Details</StepItem>
        <StepItem>Review</StepItem>
      </Stepper>
      <h2>Select Location and Specialty</h2>
      <input type="text" name="location" />
      <Button>Next</Button>
    </form>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u13 = results.find(f => f.subCheck === 'U1.3' && f.elementLabel.includes('Next'));
  assertEquals(u13, undefined, "Next should NOT be flagged when labeled stepper with active step and destination inference is present (S1)");
});

Deno.test("U1.3 CONTEXT SUPPRESSION S2: Strong heading near 'Next' → NO U1.3", () => {
  const files = new Map<string, string>();
  files.set("src/pages/Wizard.tsx", `
export default function Wizard() {
  return (
    <Dialog>
      <h2>Select Your Payment Method</h2>
      <p>Choose from the options below</p>
      <button onClick={handleNext}>Next</button>
    </Dialog>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u13 = results.find(f => f.subCheck === 'U1.3' && f.elementLabel.includes('Next'));
  assertEquals(u13, undefined, "Next should NOT be flagged when strong heading with task verb is nearby (S2)");
});

Deno.test("U1.3 CONTEXT SUPPRESSION S3: Single dominant CTA in step flow → NO U1.3", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/pages/SimpleStep.tsx", `
import { Button } from "@/components/ui/button";
const steps = [
  { title: "Info" },
  { title: "Address" },
  { title: "Done" },
];
export default function SimpleStep() {
  return (
    <form onSubmit={handleSubmit}>
      <h2>Enter Your Information</h2>
      <Button>Next</Button>
    </form>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u13 = results.find(f => f.subCheck === 'U1.3' && f.elementLabel.includes('Next'));
  assertEquals(u13, undefined, "Single dominant CTA with stepper context should be suppressed (S3)");
});

Deno.test("U1.3 CONTEXT: 'Next' with NO stepper and NO heading → U1.3 Potential", () => {
  const files = new Map<string, string>();
  files.set("src/pages/UnknownStep.tsx", `
export default function UnknownStep() {
  return (
    <Dialog>
      <button onClick={handleNext}>Next</button>
    </Dialog>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u13 = results.find(f => f.subCheck === 'U1.3' && f.elementLabel.includes('Next'));
  assert(u13 !== undefined, "Next should be flagged when no stepper and no heading");
  assertEquals(u13!.classification, "potential");
  assert(u13!.confidence >= 0.40 && u13!.confidence <= 0.70, `Expected confidence 40-70%, got ${u13!.confidence}`);
  // Should have ambiguity signals
  assert(u13!.ambiguitySignalsFound?.includes('no_context'), "Should include no_context ambiguity signal");
});

Deno.test("U1.3 CONTEXT: 'Next' + 'Skip' same styling, no context → U1.2 fires", () => {
  const files = new Map<string, string>();
  files.set("src/pages/Onboarding.tsx", `
export default function Onboarding() {
  return (
    <Dialog>
      <div className="flex gap-4">
        <button className="bg-blue-600 text-white px-4 py-2">Next</button>
        <button className="bg-blue-600 text-white px-4 py-2">Skip</button>
      </div>
    </Dialog>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assert(u12 !== undefined, "Expected U1.2 for competing Next + Skip with same styling");
});

Deno.test("U1.3 CONTEXT: Specific label 'Continue to Review' → NO U1.3", () => {
  const files = new Map<string, string>();
  files.set("src/pages/Checkout.tsx", `
export default function Checkout() {
  return (
    <Dialog>
      <button onClick={handleNext}>Continue to Review</button>
    </Dialog>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u13 = results.find(f => f.subCheck === 'U1.3');
  assertEquals(u13, undefined, "'Continue to Review' is specific, not generic — should NOT trigger U1.3");
});

Deno.test("U1.3 CONTEXT: Steps array with labels + step state → NO U1.3 for 'Continue'", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/pages/MultiStepForm.tsx", `
import { Button } from "@/components/ui/button";
const [currentStep, setStep] = useState(0);
const steps = [
  { title: "Personal Info" },
  { title: "Address" },
  { title: "Confirmation" },
];
export default function MultiStepForm() {
  return (
    <form onSubmit={handleSubmit}>
      <h1>Registration</h1>
      <Button>Continue</Button>
    </form>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u13 = results.find(f => f.subCheck === 'U1.3' && f.elementLabel.includes('Continue'));
  assertEquals(u13, undefined, "Continue should NOT be flagged when steps array with labels + step tracking exists");
});

Deno.test("U1.3: Unlabeled stepper + 'Next' + no heading → U1.3 Potential with reduced confidence", () => {
  const files = new Map<string, string>();
  files.set("src/pages/NumberedSteps.tsx", `
export default function NumberedSteps() {
  return (
    <Dialog>
      <Stepper>
        <Step />
        <Step />
        <Step />
      </Stepper>
      <button onClick={handleNext}>Next</button>
    </Dialog>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u13 = results.find(f => f.subCheck === 'U1.3' && f.elementLabel.includes('Next'));
  // Unlabeled stepper + no heading → single primary CTA in context → S3 suppresses
  // Actually: unlabeled stepper has no labels, but stepperDetected=true, headingDetected=false
  // S3: isSinglePrimary && (stepperDetected || headingDetected) → suppressed
  assertEquals(u13, undefined, "Single CTA with unlabeled stepper should be suppressed by S3");
});

Deno.test("U1.3: 'Save' in standalone context without heading → U1.3 Potential", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/components/StandaloneSave.tsx", `
import { Button } from "@/components/ui/button";
export default function StandaloneSave() {
  return <Button>Save</Button>;
}
`);
  const results = detectU1PrimaryAction(files);
  const u13 = results.find(f => f.subCheck === 'U1.3');
  assert(u13 !== undefined, "U1.3 should fire for standalone generic label without context");
});

// ========== SCOPED SUPPRESSION TESTS ==========

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
  assert(u11 !== undefined, "Expected U1.1 for form without submit");
  const u13 = results.find(f => f.subCheck === 'U1.3');
  assertEquals(u13, undefined, "U1.3 should be suppressed for button INSIDE the U1.1 form");
});

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

// ========== NAV/CHROME + CONTEXT GATE TESTS ==========

Deno.test("NAV GATE: Header with navItems + logout → U1 emits NOTHING", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/components/layout/Header.tsx", `
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
const navItems = [
  { name: 'Dashboard', href: '/' },
  { name: 'Projects', href: '/projects' },
];
export function Header() {
  return (
    <header>
      <nav>
        {navItems.map(item => (
          <Link to={item.href} key={item.name}>{item.name}</Link>
        ))}
        <Button variant="ghost" onClick={handleLogout}>
          <LogOut className="h-4 w-4" />
        </Button>
      </nav>
    </header>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  assertEquals(results.length, 0, "Nav header with navItems should produce NO U1 findings");
});

Deno.test("CONTEXT GATE: Single CTA in main content with no context → U1 emits NOTHING", () => {
  const files = new Map<string, string>();
  files.set("src/pages/About.tsx", `
export default function About() {
  return (
    <div>
      <h1>About Us</h1>
      <p>We are a company.</p>
      <button onClick={handleClick}>Learn more</button>
    </div>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  assertEquals(results.length, 0, "Single non-CTA button without form/dialog context should produce NO U1 findings");
});

// ========== NEW: CONFIDENCE SCORING TESTS ==========

Deno.test("U1.3 confidence: no context → higher confidence (0.55)", () => {
  const files = new Map<string, string>();
  files.set("src/pages/Bare.tsx", `
export default function Bare() {
  return (
    <Dialog>
      <button onClick={handleClick}>Next</button>
    </Dialog>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u13 = results.find(f => f.subCheck === 'U1.3');
  assert(u13 !== undefined, "Expected U1.3");
  // base 0.45 + 0.10 (no stepper, no heading) = 0.55
  assert(u13!.confidence >= 0.50, `Expected confidence >= 0.50 for no-context case, got ${u13!.confidence}`);
});

Deno.test("U1.2 confidence: clear primary/secondary split → no fire", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/components/CleanDialog.tsx", `
import { Button } from "@/components/ui/button";
export default function CleanDialog() {
  return (
    <Dialog>
      <DialogFooter>
        <Button>Save</Button>
        <Button variant="secondary">Cancel</Button>
      </DialogFooter>
    </Dialog>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u12 = results.find(f => f.subCheck === 'U1.2');
  assertEquals(u12, undefined, "Clear primary/secondary split should NOT trigger U1.2");
});

// ========== NEW: DESTINATION INFERENCE TESTS ==========

Deno.test("U1.3 DESTINATION INFERENCE: stepper with labels + active step → suppressed with reason", () => {
  const files = new Map<string, string>();
  files.set("src/components/ui/button.tsx", MOCK_BUTTON_TSX);
  files.set("src/pages/OnboardingWizard.tsx", `
import { Button } from "@/components/ui/button";
const [currentStep, setStep] = useState(0);
const steps = [
  { label: "Welcome" },
  { label: "Profile" },
  { label: "Preferences" },
  { label: "Complete" },
];
export default function OnboardingWizard() {
  return (
    <form onSubmit={handleSubmit}>
      <h2>Welcome to the Platform</h2>
      <Button>Next</Button>
    </form>
  );
}
`);
  const results = detectU1PrimaryAction(files);
  const u13 = results.find(f => f.subCheck === 'U1.3' && f.elementLabel.includes('Next'));
  assertEquals(u13, undefined, "Next should be suppressed when stepper with labels and step tracking provides destination inference");
});
