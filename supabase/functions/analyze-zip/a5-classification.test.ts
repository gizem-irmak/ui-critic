import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// Inline the detection function for testing

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

const A5_WRAPPER_NAMES = Object.keys(A5_WRAPPER_COMPONENT_MAP).join('|');

const A5_UI_IMPORT_PATTERNS = [
  /['"]@\/components\/ui\//,
  /['"]\.\.?\/components\/ui\//,
  /['"]@radix-ui\//,
  /['"]shadcn/,
  /['"]@headlessui\//,
];

const A5_NON_UI_IMPORT_PATTERNS = [
  /['"]react-router/,
  /['"]@remix-run/,
  /['"]next\/navigation/,
  /['"]wouter/,
];

function extractImportSources(content: string): Map<string, string> {
  const importMap = new Map<string, string>();
  const importRegex = /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+(['"][^'"]+['"])/g;
  let m;
  while ((m = importRegex.exec(content)) !== null) {
    const path = m[3];
    if (m[1]) {
      const names = m[1].split(',').map(n => {
        const parts = n.trim().split(/\s+as\s+/);
        return parts.length > 1 ? parts[1].trim() : parts[0].trim();
      }).filter(Boolean);
      for (const name of names) importMap.set(name, path);
    }
    if (m[2]) importMap.set(m[2], path);
  }
  return importMap;
}

function isUiControl(componentName: string, importMap: Map<string, string>, attrs: string): boolean {
  const importPath = importMap.get(componentName);
  if (importPath) {
    if (A5_NON_UI_IMPORT_PATTERNS.some(p => p.test(importPath))) return false;
    if (A5_UI_IMPORT_PATTERNS.some(p => p.test(importPath))) return true;
  }
  const FORM_CONTROL_ROLES = /role\s*=\s*["'](?:switch|combobox|checkbox|radio|slider|textbox|searchbox|spinbutton|listbox)["']/i;
  if (FORM_CONTROL_ROLES.test(attrs)) return true;
  if (!importPath) return true;
  return false;
}

function parseAriaLabelValue(attrs: string): string | null {
  const staticMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
  if (staticMatch) {
    const val = staticMatch[1] || staticMatch[2];
    if (val && val.trim().length > 0) return val;
  }
  const exprMatch = attrs.match(/aria-label\s*=\s*\{\s*(?:"([^"]+)"|'([^']+)')\s*\}/);
  if (exprMatch) {
    const val = exprMatch[1] || exprMatch[2];
    if (val && val.trim().length > 0) return val;
  }
  return null;
}

function hasAriaLabelPresent(attrs: string): boolean {
  return parseAriaLabelValue(attrs) !== null;
}

function parseAriaLabelledByValue(attrs: string): string | null {
  const staticMatch = attrs.match(/aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/);
  if (staticMatch) return staticMatch[1] || staticMatch[2] || null;
  const exprMatch = attrs.match(/aria-labelledby\s*=\s*\{\s*(?:"([^"]+)"|'([^']+)')\s*\}/);
  if (exprMatch) return exprMatch[1] || exprMatch[2] || null;
  return null;
}

interface A5Finding {
  elementKey: string;
  elementLabel: string;
  elementType: string;
  elementName?: string;
  controlType?: string;
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
  wcagCriteria: string[];
  correctivePrompt?: string;
  advisoryGuidance?: string;
  deduplicationKey: string;
  potentialSubtype?: 'accuracy' | 'borderline';
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function makeA5ElementKey(tag: string, id: string, name: string, type: string, filePath: string, lineNumber: number): string {
  return `a5:${tag}|${id}|${name}|${type}|${filePath}|${lineNumber}`;
}

function detectA5FormLabels(allFiles: Map<string, string>): A5Finding[] {
  const findings: A5Finding[] = [];
  const seenKeys = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;

    // Collect all id= attributes (exclude data-testid, data-id, etc.)
    const controlIds = new Set<string>();
    const controlIdRegex = /(?<![a-zA-Z-])id\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
    let idMatch;
    while ((idMatch = controlIdRegex.exec(content)) !== null) {
      const id = idMatch[1] || idMatch[2] || idMatch[3];
      if (id) controlIds.add(id);
    }

    const idCounts = new Map<string, number>();
    for (const id of controlIds) {
      const idRegex = new RegExp(`(?<![a-zA-Z-])id\\s*=\\s*(?:"|'|\\{["'])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:"|'|["']\\})`, 'g');
      const matches = content.match(idRegex);
      if (matches) idCounts.set(id, matches.length);
    }

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

    const EXCLUDED_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button']);
    // Native tags + React wrapper components
    const controlRegex = new RegExp(`(<(?:input|textarea|select)\\b([^>]*)(?:>|\\/>))|(<(?:${A5_WRAPPER_NAMES})\\b([^>]*)(?:>|\\/>))`, 'g');
    let match;
    while ((match = controlRegex.exec(content)) !== null) {
      const fullMatch = match[1] || match[3];
      const rawTag = fullMatch.match(/^<(\w+)/)?.[1] || '';
      const attrs = match[2] || match[4] || '';
      const isReactComponent = /^[A-Z]/.test(rawTag);
      const tag = isReactComponent ? rawTag : rawTag.toLowerCase();
      if (tag === 'Select') continue;

      // Import-aware control identification
      if (isReactComponent && A5_WRAPPER_COMPONENT_MAP[tag]) {
        if (!isUiControl(tag, importMap, attrs)) continue;
      }

      const tagLower = tag.toLowerCase();
      const wrapperInfo = isReactComponent ? A5_WRAPPER_COMPONENT_MAP[tag] : undefined;
      const controlTypeVal = wrapperInfo?.controlType || tagLower;
      const impliedRole = wrapperInfo?.impliedRole;
      const displayTag = isReactComponent && impliedRole
        ? `${tag} (role=${impliedRole})`
        : isReactComponent ? tag : tagLower;

      if (tagLower === 'input') {
        const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        const inputType = (typeMatch?.[1] || typeMatch?.[2] || 'text').toLowerCase();
        if (EXCLUDED_INPUT_TYPES.has(inputType)) continue;
      }
      if (/\bdisabled\b/.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;

      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;

      const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const inputSubtype = (controlTypeVal === 'input') ? (typeMatch?.[1] || typeMatch?.[2] || 'text') : undefined;

      const ariaLabelParsed = parseAriaLabelValue(attrs);
      const hasAriaLabel = ariaLabelParsed !== null;
      const ariaLabelledByParsed = parseAriaLabelledByValue(attrs);
      const hasAriaLabelledBy = ariaLabelledByParsed !== null;
      const controlIdMatch2 = attrs.match(/(?<![a-zA-Z-])id\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/);
      const controlId = controlIdMatch2?.[1] || controlIdMatch2?.[2] || controlIdMatch2?.[3];
      const hasExplicitLabel = controlId ? labelForTargets.has(controlId) : false;

      const beforeControl = content.slice(Math.max(0, match.index - 500), match.index);
      const lastLabelOpen = Math.max(beforeControl.lastIndexOf('<label'), beforeControl.lastIndexOf('<Label'));
      const lastLabelClose = Math.max(beforeControl.lastIndexOf('</label'), beforeControl.lastIndexOf('</Label'));
      const isWrappedInLabel = lastLabelOpen > lastLabelClose && lastLabelOpen !== -1;

      const isInFormControl = formControlRanges.some(r => match!.index >= r.start && match!.index <= r.end);

      const hasValidLabel = hasAriaLabel || hasAriaLabelledBy || hasExplicitLabel || isWrappedInLabel || isInFormControl;

      const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2];
      const hasPlaceholder = !!placeholder && placeholder.trim().length > 0;

      const nameMatch = attrs.match(/(?<![a-zA-Z-])(?:name)\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const elementName = nameMatch?.[1] || nameMatch?.[2] || controlId || '';
      const label = ariaLabelParsed || placeholder || elementName || `<${displayTag}> control`;

      if (hasValidLabel) continue;

      if (hasPlaceholder && !hasValidLabel) {
        const dedupeKey = `A5.2|${filePath}|${tag}|${label}|${lineNumber}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          findings.push({
            elementKey: makeA5ElementKey(tag, controlId || '', elementName, inputSubtype || tag, filePath, lineNumber),
            elementLabel: label, elementType: displayTag, sourceLabel: label, filePath,
            subCheck: 'A5.2', subCheckLabel: 'Placeholder used as label', classification: 'confirmed',
            detection: `<${tag}> placeholder-only`, evidence: `placeholder="${placeholder}"`,
            explanation: `Placeholder is the only label.`,
            wcagCriteria: ['1.3.1', '3.3.2'],
            deduplicationKey: dedupeKey,
          });
        }
        continue;
      }

      const dedupeKey = `A5.1|${filePath}|${tag}|${label}|${lineNumber}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        findings.push({
          elementKey: makeA5ElementKey(tag, controlId || '', elementName, inputSubtype || tag, filePath, lineNumber),
          elementLabel: label, elementType: displayTag, sourceLabel: label, filePath,
          subCheck: 'A5.1', subCheckLabel: 'Missing label association', classification: 'confirmed',
          detection: `<${tag}> no label`, evidence: `no label source`,
          explanation: `No accessible name.`,
          wcagCriteria: ['1.3.1', '3.3.2'],
          deduplicationKey: dedupeKey,
        });
      }
    }

    // ARIA input roles (including listbox)
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
      findings.push({
        elementKey: makeA5ElementKey(tag, '', '', role, filePath, lineNumber),
        elementLabel: label, elementType: tag, sourceLabel: label, filePath,
        subCheck: 'A5.1', subCheckLabel: 'Missing label association', classification: 'confirmed',
        detection: `<${tag} role="${role}"> no label`, evidence: `no programmatic label`,
        explanation: `Custom input (role="${role}") has no accessible name.`,
        wcagCriteria: ['1.3.1', '3.3.2', '4.1.2'],
        deduplicationKey: dedupeKey,
      });
    }

    // Contenteditable elements
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
      findings.push({
        elementKey: makeA5ElementKey(tag, '', '', 'contenteditable', filePath, lineNumber2),
        elementLabel: label2, elementType: tag, sourceLabel: label2, filePath,
        subCheck: 'A5.1', subCheckLabel: 'Missing label association', classification: 'confirmed',
        detection: `<${tag} contenteditable="true"> no label`, evidence: `no programmatic label`,
        explanation: `Contenteditable element has no accessible name.`,
        wcagCriteria: ['1.3.1', '3.3.2', '4.1.2'],
        deduplicationKey: dedupeKey,
      });
    }

    // A5.3: Orphan labels (run once per file, after control loop)
    for (const forTarget of labelForTargets) {
      if (!controlIds.has(forTarget)) {
        const dedupeKey = `A5.3|${filePath}|${forTarget}|missing`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          findings.push({
            elementKey: makeA5ElementKey('label', forTarget, '', 'label', filePath, 0),
            elementLabel: `label[for="${forTarget}"]`, elementType: 'label', sourceLabel: `Orphan label for="${forTarget}"`, filePath,
            subCheck: 'A5.3', subCheckLabel: 'Broken label association', classification: 'confirmed',
            detection: `<label for="${forTarget}"> references non-existent id`, evidence: `label for="${forTarget}" — no matching id`,
            explanation: `Label references non-existent id="${forTarget}".`,
            wcagCriteria: ['1.3.1', '3.3.2'],
            deduplicationKey: dedupeKey,
          });
        }
      }
    }
  }

  // Post-process: suppress A5.1 for controls in the same file where an A5.3 orphan label exists
  const a53Files = new Set(findings.filter(f => f.subCheck === 'A5.3').map(f => f.filePath));
  const deduped = findings.filter(f => {
    if (f.subCheck === 'A5.1' && a53Files.has(f.filePath)) return false;
    return true;
  });

  // ========== Potential sub-checks (A5.4, A5.5, A5.6) ==========
  const confirmedKeys = new Set(deduped.map(f => `${f.filePath}|${f.elementType}|${f.elementLabel}`));
  const potentialFindings: A5Finding[] = [];
  const GENERIC_LABELS = new Set(['input', 'field', 'value', 'text', 'enter here', 'type here', 'select', 'option']);
  const labelsByFile = new Map<string, Map<string, { tag: string; label: string; line: number; filePath: string; componentName: string }[]>>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|html|htm)$/i, '') || '';

    const labelForTargets2 = new Set<string>();
    const labelForRegex2 = /(?:htmlFor|for)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
    let lfm;
    while ((lfm = labelForRegex2.exec(content)) !== null) {
      const t = lfm[1] || lfm[2] || lfm[3];
      if (t) labelForTargets2.add(t);
    }

    const idTextMap = new Map<string, string>();
    const idTextRegex = /<(\w+)\b[^>]*id\s*=\s*["']([^"']+)["'][^>]*>([^<]*)</g;
    let itm;
    while ((itm = idTextRegex.exec(content)) !== null) {
      idTextMap.set(itm[2], itm[3].trim());
    }

    if (!labelsByFile.has(filePath)) labelsByFile.set(filePath, new Map());
    const fileLabels = labelsByFile.get(filePath)!;

    const EXCLUDED_INPUT_TYPES2 = new Set(['hidden', 'submit', 'reset', 'button']);
    const controlRegex2 = /(<(?:input|textarea|select)\b([^>]*)(?:>|\/>))|(<(?:Input|Textarea|SelectTrigger)\b([^>]*)(?:>|\/>))/g;
    let match2;
    while ((match2 = controlRegex2.exec(content)) !== null) {
      const fullMatch2 = match2[1] || match2[3];
      const rawTag2 = fullMatch2.match(/^<(\w+)/)?.[1] || '';
      const attrs = match2[2] || match2[4] || '';
      const tag = /^[A-Z]/.test(rawTag2) ? rawTag2 : rawTag2.toLowerCase();
      if (tag === 'Select') continue;
      const tagLower2 = tag.toLowerCase();

      if (tagLower2 === 'input') {
        const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        const inputType = (typeMatch?.[1] || typeMatch?.[2] || 'text').toLowerCase();
        if (EXCLUDED_INPUT_TYPES2.has(inputType)) continue;
      }
      if (/\bdisabled\b/.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;

      const linesBefore = content.slice(0, match2.index).split('\n');
      const lineNumber = linesBefore.length;

      const ariaLabelMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabelVal = ariaLabelMatch?.[1] || ariaLabelMatch?.[2] || '';
      const hasAriaLabel = ariaLabelVal.trim().length > 0;

      const ariaLabelledByMatch = attrs.match(/aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabelledByVal = ariaLabelledByMatch?.[1] || ariaLabelledByMatch?.[2] || '';
      const hasAriaLabelledBy = ariaLabelledByVal.trim().length > 0;

      const controlIdMatch3 = attrs.match(/(?:^|\s)id\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const controlId = controlIdMatch3?.[1] || controlIdMatch3?.[2];
      const hasExplicitLabel = controlId ? labelForTargets2.has(controlId) : false;

      const beforeControl = content.slice(Math.max(0, match2.index - 500), match2.index);
      const lastLabelOpen = beforeControl.lastIndexOf('<label');
      const lastLabelClose = beforeControl.lastIndexOf('</label');
      const isWrappedInLabel = lastLabelOpen > lastLabelClose && lastLabelOpen !== -1;

      const hasValidLabel = hasAriaLabel || hasAriaLabelledBy || hasExplicitLabel || isWrappedInLabel;

      const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2] || '';
      const nameMatch2 = attrs.match(/(?:name|id)\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const elementName = nameMatch2?.[1] || nameMatch2?.[2] || '';
      const label = ariaLabelVal || placeholder || elementName || `<${tag}> control`;

      const controlKey = `${filePath}|${tag}|${label}`;
      if (confirmedKeys.has(controlKey)) continue;

      if (!hasValidLabel) continue;

      let accessibleName = '';
      if (hasAriaLabel) {
        accessibleName = ariaLabelVal;
      } else if (hasAriaLabelledBy) {
        const ids = ariaLabelledByVal.split(/\s+/);
        accessibleName = ids.map(id => idTextMap.get(id) || '').join(' ').trim();
      } else if (isWrappedInLabel) {
        const labelStart = beforeControl.lastIndexOf('<label');
        const labelContent = beforeControl.slice(labelStart);
        const labelTextMatch = labelContent.match(/>([^<]*)</);
        accessibleName = labelTextMatch?.[1]?.trim() || '';
      } else if (hasExplicitLabel && controlId) {
        const labelTextRegex = new RegExp(`<label[^>]*(?:for|htmlFor)\\s*=\\s*["']${controlId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>([^<]*)`, 'i');
        const ltm = content.match(labelTextRegex);
        accessibleName = ltm?.[1]?.trim() || '';
      }

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
            explanation: `The label "${accessibleName}" is too generic.`,
            confidence: 0.88,
            wcagCriteria: ['1.3.1', '3.3.2'],
            advisoryGuidance: 'Use a descriptive label that explains the purpose of this control.',
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
              evidence: `Resolved text: "${accessibleName.slice(0, 80)}" at ${filePath}:${lineNumber}`,
              explanation: `The aria-labelledby resolves to noisy or overly long text.`,
              confidence: 0.82,
              wcagCriteria: ['1.3.1', '3.3.2'],
              advisoryGuidance: 'Simplify the referenced label text. Move hints to aria-describedby.',
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
      potentialFindings.push({
        elementKey: makeA5ElementKey(controls[0].tag, '', '', controls[0].tag, controls[0].filePath, controls[0].line),
        elementLabel: controls[0].label, elementType: controls[0].tag, sourceLabel: controls[0].label,
        filePath: controls[0].filePath, componentName: controls[0].componentName,
        subCheck: 'A5.5', subCheckLabel: 'Duplicate label text',
        classification: 'potential', potentialSubtype: 'borderline',
        detection: `${controls.length} controls share label "${controls[0].label}"`,
        evidence: `Duplicate label "${controls[0].label}"`,
        explanation: `Multiple controls share the same accessible name.`,
        confidence: 0.90,
        wcagCriteria: ['1.3.1', '3.3.2'],
        advisoryGuidance: 'Give each control a unique, descriptive label.',
        deduplicationKey: dedupeKey,
      });
    }
  }

  return [...deduped, ...potentialFindings];
}

// ===== CONFIRMED TESTS =====

Deno.test("A5.1: input with no label triggers missing label", () => {
  const files = new Map([["src/Form.tsx", `<input type="text" name="email" />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  assertEquals(results[0].subCheck, "A5.1");
  assertEquals(results[0].subCheckLabel, "Missing label association");
  assertEquals(results[0].classification, "confirmed");
  assert(results[0].confidence === undefined, "Confirmed findings must NOT have confidence");
  assert(results[0].elementKey.startsWith("a5:"), "Must have elementKey");
  assert(results[0].wcagCriteria.includes("1.3.1"), "Must include WCAG 1.3.1");
});

Deno.test("A5.2: input with placeholder only triggers placeholder-as-label", () => {
  const files = new Map([["src/Form.tsx", `<input type="text" placeholder="Enter email" />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  assertEquals(results[0].subCheck, "A5.2");
  assertEquals(results[0].subCheckLabel, "Placeholder used as label");
  assertEquals(results[0].classification, "confirmed");
  assert(results[0].confidence === undefined, "Confirmed findings must NOT have confidence");
});

Deno.test("A5.3: label for mismatch triggers broken association, suppresses A5.1", () => {
  const files = new Map([["src/Form.tsx", `
    <label for="nonexistent">Email</label>
    <input type="text" id="email-field" />
  `]]);
  const results = detectA5FormLabels(files);
  const a53 = results.find(r => r.subCheck === 'A5.3');
  assert(a53 !== undefined, "Should find A5.3 for orphan label");
  const a51 = results.find(r => r.subCheck === 'A5.1');
  assertEquals(a51, undefined, "A5.1 should be suppressed when A5.3 exists in same file");
});

Deno.test("No findings for correctly labeled input (label+id)", () => {
  const files = new Map([["src/Form.tsx", `
    <label htmlFor="email">Email</label>
    <input type="text" id="email" />
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("No findings for aria-label only", () => {
  const files = new Map([["src/Form.tsx", `<input type="text" aria-label="Search" />`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("No findings for aria-labelledby", () => {
  const files = new Map([["src/Form.tsx", `
    <span id="label-text">Search</span>
    <input type="text" aria-labelledby="label-text" />
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("Excludes hidden, submit, reset, button input types", () => {
  const files = new Map([["src/Form.tsx", `
    <input type="hidden" name="token" />
    <input type="submit" value="Go" />
    <input type="reset" value="Clear" />
    <input type="button" value="Click" />
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("Excludes disabled controls", () => {
  const files = new Map([["src/Form.tsx", `<input type="text" disabled />`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("Textarea without label triggers A5.1", () => {
  const files = new Map([["src/Form.tsx", `<textarea name="comment"></textarea>`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  assertEquals(results[0].subCheck, "A5.1");
});

Deno.test("Select without label triggers A5.1", () => {
  const files = new Map([["src/Form.tsx", `<select name="country"><option>US</option></select>`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  assertEquals(results[0].subCheck, "A5.1");
});

Deno.test("Wrapped in <label> is valid", () => {
  const files = new Map([["src/Form.tsx", `<label>Email <input type="text" /></label>`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("Plain HTML fixture: placeholder-only triggers A5.2", () => {
  const files = new Map([["index.html", `<input type="email" placeholder="Enter email" />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  const a52 = results.find(r => r.subCheck === 'A5.2');
  assert(a52 !== undefined, "Should find A5.2 for placeholder-only input");
});

Deno.test("Plain HTML fixture: unlabeled password triggers A5.1", () => {
  const files = new Map([["index.html", `<input type="password" name="pass" />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  const a51 = results.find(r => r.subCheck === 'A5.1');
  assert(a51 !== undefined, "Should find A5.1 for unlabeled password");
});

Deno.test("Plain HTML fixture: label for mismatch triggers A5.3, suppresses A5.1", () => {
  const files = new Map([["index.html", `
    <label for="country">Country</label>
    <select id="countrySelect"><option>US</option></select>
  `]]);
  const results = detectA5FormLabels(files);
  const a53 = results.find(r => r.subCheck === 'A5.3');
  assert(a53 !== undefined, "Should find A5.3 for label/id mismatch");
  const a51 = results.find(r => r.subCheck === 'A5.1');
  assertEquals(a51, undefined, "A5.1 should be suppressed when A5.3 exists in same file");
});

Deno.test("Contenteditable without label triggers A5.1", () => {
  const files = new Map([["index.html", `<div contenteditable="true" role="textbox"></div>`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  assertEquals(results[0].subCheck, "A5.1");
});

Deno.test("Contenteditable with aria-label is valid", () => {
  const files = new Map([["index.html", `<div contenteditable="true" role="textbox" aria-label="Notes"></div>`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("role=listbox without label triggers A5.1", () => {
  const files = new Map([["src/Dropdown.tsx", `<div role="listbox"></div>`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  assertEquals(results[0].subCheck, "A5.1");
  assertEquals(results[0].classification, "confirmed");
  assert(results[0].wcagCriteria.includes("4.1.2"), "ARIA roles should include 4.1.2");
});

Deno.test("role=listbox with aria-label is valid", () => {
  const files = new Map([["src/Dropdown.tsx", `<div role="listbox" aria-label="Country selector"></div>`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("Multi-control HTML fixture triggers findings with A5.1 suppressed by A5.3", () => {
  const files = new Map([["form.html", `
    <form>
      <input type="email" placeholder="Enter email" />
      <input type="password" name="pass" />
      <label for="country">Country</label>
      <select id="countrySelect"><option>US</option></select>
      <div contenteditable="true" role="textbox"></div>
    </form>
  `]]);
  const results = detectA5FormLabels(files);
  assert(results.some(r => r.subCheck === 'A5.2'), "Should have A5.2");
  assert(results.some(r => r.subCheck === 'A5.3'), "Should have A5.3");
  assertEquals(results.filter(r => r.subCheck === 'A5.1').length, 0, "A5.1 should be suppressed by A5.3 dedup");
});

Deno.test("HTML fixture file: a5_form_labels_fail.html triggers A5.1, A5.2, A5.3", () => {
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head><title>A5 Test Fixture</title></head>
<body>
  <form>
    <!-- A5.2: placeholder-only, no label -->
    <input type="email" placeholder="Enter your email" />

    <!-- A5.1: no label at all (separate file, no A5.3 interference) -->
    <textarea name="comments"></textarea>

    <!-- Correctly labeled: should NOT trigger -->
    <label for="username">Username</label>
    <input type="text" id="username" />

    <!-- Correctly labeled via aria-label: should NOT trigger -->
    <input type="search" aria-label="Search site" />

    <!-- Correctly labeled via wrapping: should NOT trigger -->
    <label>Phone <input type="tel" /></label>
  </form>
</body>
</html>`;

  const htmlWithBrokenLabel = `<!DOCTYPE html>
<html><body>
  <form>
    <!-- A5.3: label for="city" but control has id="citySelect" -->
    <label for="city">City</label>
    <select id="citySelect"><option>NYC</option></select>
  </form>
</body></html>`;

  // Test file WITHOUT orphan labels — A5.1 should fire
  const results1 = detectA5FormLabels(new Map([["a5_form_labels_fail.html", htmlContent]]));

  const a52 = results1.filter(r => r.subCheck === 'A5.2');
  assert(a52.length >= 1, "Should find A5.2 for email placeholder-only");
  assertEquals(a52[0].filePath, "a5_form_labels_fail.html");

  const a51 = results1.filter(r => r.subCheck === 'A5.1');
  assert(a51.length >= 1, "Should find A5.1 for textarea without label");

  assertEquals(results1.filter(r => r.subCheck === 'A5.3').length, 0, "No A5.3 expected in clean file");

  const usernameFindings = results1.filter(r => r.elementLabel === 'username');
  assertEquals(usernameFindings.length, 0, "Correctly labeled username should not trigger");

  // Test file WITH orphan label — A5.3 fires, A5.1 suppressed
  const results2 = detectA5FormLabels(new Map([["a5_broken_labels.html", htmlWithBrokenLabel]]));

  const a53 = results2.filter(r => r.subCheck === 'A5.3');
  assert(a53.length >= 1, "Should find A5.3 for broken label association");
  assertEquals(a53[0].filePath, "a5_broken_labels.html");

  const a51suppressed = results2.filter(r => r.subCheck === 'A5.1');
  assertEquals(a51suppressed.length, 0, "A5.1 should be suppressed when A5.3 exists");
});

// ===== TITLE-ONLY REMAINS A5.1 CONFIRMED =====

Deno.test("Title-only input triggers A5.1 Confirmed (not potential)", () => {
  const files = new Map([["src/Form.tsx", `<input type="text" title="Promo code" />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1, "Should have a finding for title-only input");
  assertEquals(results[0].subCheck, "A5.1", "Title-only should be A5.1 Confirmed");
  assertEquals(results[0].classification, "confirmed");
});

// ===== POTENTIAL SUB-CHECK TESTS (A5.4, A5.5, A5.6) =====

Deno.test("A5.4: Generic label text triggers potential finding", () => {
  const files = new Map([["src/Form.tsx", `<label for="f1">Input</label><input type="text" id="f1" />`]]);
  const results = detectA5FormLabels(files);
  const p1 = results.filter(r => r.subCheck === 'A5.4');
  assert(p1.length >= 1, "Should find A5.4 for generic label 'Input'");
  assertEquals(p1[0].classification, "potential");
  assertEquals(p1[0].subCheckLabel, "Generic label text");
  assert(p1[0].confidence! >= 0.80 && p1[0].confidence! <= 0.90, "Confidence should be 80-90%");
  assert(p1[0].potentialSubtype === 'borderline');
});

Deno.test("A5.4: Non-generic label does NOT trigger", () => {
  const files = new Map([["src/Form.tsx", `<label for="email">Email Address</label><input type="text" id="email" />`]]);
  const results = detectA5FormLabels(files);
  const p1 = results.filter(r => r.subCheck === 'A5.4');
  assertEquals(p1.length, 0, "Descriptive label should not trigger A5.4");
});

Deno.test("A5.5: Duplicate label text triggers potential finding", () => {
  const files = new Map([["src/Form.tsx", `
    <label for="n1">Name</label><input type="text" id="n1" />
    <label for="n2">Name</label><input type="text" id="n2" />
  `]]);
  const results = detectA5FormLabels(files);
  const p2 = results.filter(r => r.subCheck === 'A5.5');
  assert(p2.length >= 1, "Should find A5.5 for duplicate label 'Name'");
  assertEquals(p2[0].classification, "potential");
  assertEquals(p2[0].subCheckLabel, "Duplicate label text");
  assert(p2[0].confidence! >= 0.85 && p2[0].confidence! <= 0.95, "Confidence should be 85-95%");
});

Deno.test("A5.5: Unique labels do NOT trigger", () => {
  const files = new Map([["src/Form.tsx", `
    <label for="fn">First Name</label><input type="text" id="fn" />
    <label for="ln">Last Name</label><input type="text" id="ln" />
  `]]);
  const results = detectA5FormLabels(files);
  const p2 = results.filter(r => r.subCheck === 'A5.5');
  assertEquals(p2.length, 0, "Unique labels should not trigger A5.5");
});

Deno.test("A5.6: Noisy aria-labelledby triggers potential finding", () => {
  const files = new Map([["src/Form.tsx", `
    <span id="addr-label">Billing Address (optional) — used for invoices and shipping documentation that exceeds normal label length</span>
    <input type="text" aria-labelledby="addr-label" />
  `]]);
  const results = detectA5FormLabels(files);
  const p4 = results.filter(r => r.subCheck === 'A5.6');
  assert(p4.length >= 1, "Should find A5.6 for noisy aria-labelledby");
  assertEquals(p4[0].classification, "potential");
  assertEquals(p4[0].subCheckLabel, "Noisy aria-labelledby");
  assert(p4[0].confidence! >= 0.70 && p4[0].confidence! <= 0.85, "Confidence should be 70-85%");
});

Deno.test("A5.6: 'used for' token triggers noisy finding", () => {
  const files = new Map([["src/Form.tsx", `
    <span id="promo-label">Promo code used for discounts</span>
    <input type="text" aria-labelledby="promo-label" />
  `]]);
  const results = detectA5FormLabels(files);
  const p4 = results.filter(r => r.subCheck === 'A5.6');
  assert(p4.length >= 1, "Should find A5.6 for 'used for' token in aria-labelledby");
});

Deno.test("A5.6: Short clean aria-labelledby does NOT trigger", () => {
  const files = new Map([["src/Form.tsx", `
    <span id="addr-label">Billing Address</span>
    <input type="text" aria-labelledby="addr-label" />
  `]]);
  const results = detectA5FormLabels(files);
  const p4 = results.filter(r => r.subCheck === 'A5.6');
  assertEquals(p4.length, 0, "Short clean aria-labelledby should not trigger A5.6");
});

Deno.test("Potential findings do NOT fire for controls with confirmed findings", () => {
  const files = new Map([["src/Form.tsx", `<input type="text" placeholder="Input" />`]]);
  const results = detectA5FormLabels(files);
  const confirmed = results.filter(r => r.classification === 'confirmed');
  assert(confirmed.length >= 1, "Should have confirmed finding");
  const potential = results.filter(r => r.classification === 'potential');
  assertEquals(potential.length, 0, "Should not have potential findings for confirmed controls");
});

Deno.test("Existing confirmed tests still pass - mixed file", () => {
  const files = new Map([["src/Form.tsx", `<input type="text" name="email" />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  assertEquals(results[0].subCheck, "A5.1");
  assertEquals(results[0].classification, "confirmed");
});

// ===== ELEMENT KEY STABILITY TESTS =====

Deno.test("elementKey is stable and unique per element", () => {
  const files = new Map([["src/Form.tsx", `
    <input type="text" name="email" />
    <input type="password" name="pass" />
  `]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 2, "Should have 2 findings");
  assert(results[0].elementKey !== results[1].elementKey, "Each element must have a unique elementKey");
  // Run again — same keys
  const results2 = detectA5FormLabels(files);
  assertEquals(results[0].elementKey, results2[0].elementKey, "elementKey must be stable across runs");
});

Deno.test("Confirmed elementKey suppresses potential for same element", () => {
  // Input with placeholder "Input" — triggers A5.2 (confirmed), should NOT also trigger A5.4 (potential)
  const files = new Map([["src/Form.tsx", `<input type="text" placeholder="Input" />`]]);
  const results = detectA5FormLabels(files);
  const confirmed = results.filter(r => r.classification === 'confirmed');
  const potential = results.filter(r => r.classification === 'potential');
  assert(confirmed.length >= 1, "Should have confirmed A5.2");
  assertEquals(potential.length, 0, "Potential must be suppressed for same element with confirmed finding");
});

// ===== DATA-TESTID EXCLUSION TESTS =====

Deno.test("data-testid must NOT be treated as id for label association", () => {
  const files = new Map([["src/Form.tsx", `<input type="text" data-testid="email-input" />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1, "Should flag — data-testid is not a valid id");
  assertEquals(results[0].subCheck, "A5.1");
});

Deno.test("data-testid alongside real id — only real id counts", () => {
  const files = new Map([["src/Form.tsx", `
    <label htmlFor="email">Email</label>
    <input type="text" data-testid="email-input" id="email" />
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "Real id + matching label = labeled");
});

// ===== SHADCN FORM PATTERN TESTS =====

Deno.test("FormLabel + FormControl suppresses A5 for Input inside", () => {
  const files = new Map([["src/Login.tsx", `
    <FormItem>
      <FormLabel>Email</FormLabel>
      <FormControl>
        <Input type="email" placeholder="email@example.com" />
      </FormControl>
    </FormItem>
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "FormLabel/FormControl pattern = labeled");
});

Deno.test("FormControl without FormLabel still flags", () => {
  const files = new Map([["src/Form.tsx", `
    <FormItem>
      <FormControl>
        <Input type="text" placeholder="No label" />
      </FormControl>
    </FormItem>
  `]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1, "FormControl without FormLabel = still unlabeled");
});

// ===== LABEL (UPPERCASE) HTMLFOR TESTS =====

Deno.test("Label (uppercase) with htmlFor + id linkage = no violation", () => {
  const files = new Map([["src/Doctors.tsx", `
    <Label htmlFor="doc-specialty">Specialty</Label>
    <select id="doc-specialty">
      <option>Cardiology</option>
    </select>
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "Label htmlFor + matching id = labeled");
});

Deno.test("Wrapped in uppercase Label = no violation", () => {
  const files = new Map([["src/Form.tsx", `<Label>Name <input type="text" /></Label>`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "Wrapped in <Label> = valid");
});

// ===== SELECTTRIGGER TESTS =====

Deno.test("SelectTrigger with Label htmlFor + id linkage = no violation", () => {
  const files = new Map([["src/Doctors.tsx", `
    <Label htmlFor="doc-specialty">Specialty</Label>
    <Select>
      <SelectTrigger id="doc-specialty">
        <SelectValue placeholder="Select specialty" />
      </SelectTrigger>
    </Select>
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "Label htmlFor + SelectTrigger id = labeled");
});

Deno.test("SelectTrigger without any label = flagged", () => {
  const files = new Map([["src/Filter.tsx", `
    <Select>
      <SelectTrigger>
        <SelectValue placeholder="Filter..." />
      </SelectTrigger>
    </Select>
  `]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1, "SelectTrigger with no label should be flagged");
  assert(results[0].elementType.includes("SelectTrigger"), "Should report as SelectTrigger");
});

Deno.test("SelectTrigger with aria-label = no violation", () => {
  const files = new Map([["src/Filter.tsx", `
    <SelectTrigger aria-label="Filter by status" id="status-filter">
      <SelectValue placeholder="Status" />
    </SelectTrigger>
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "aria-label on SelectTrigger = labeled");
});

Deno.test("Uppercase <Select> wrapper is NOT matched as a control", () => {
  const files = new Map([["src/Form.tsx", `
    <Label htmlFor="my-select">Pick one</Label>
    <Select>
      <SelectTrigger id="my-select">
        <SelectValue placeholder="Choose" />
      </SelectTrigger>
    </Select>
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "<Select> wrapper should not be flagged");
});

Deno.test("Input with aria-label = no violation", () => {
  const files = new Map([["src/Search.tsx", `
    <Input type="search" aria-label="Search patients" placeholder="Search..." />
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "aria-label on Input = labeled");
});

// ===== WRAPPER COMPONENT TESTS =====

Deno.test("Input with aria-labelledby = no violation", () => {
  const files = new Map([["src/Search.tsx", `
    <span id="lbl1">Search</span>
    <Input aria-labelledby="lbl1" placeholder="Search..." />
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "aria-labelledby on Input = labeled");
});

Deno.test("Label htmlFor + Input id = no violation", () => {
  const files = new Map([["src/Form.tsx", `
    <Label htmlFor="foo">Name</Label>
    <Input id="foo" placeholder="Enter name" />
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "Label htmlFor + Input id = labeled");
});

Deno.test("SelectTrigger with aria-label = no violation", () => {
  const files = new Map([["src/Filter.tsx", `
    <SelectTrigger aria-label="Status filter">
      <SelectValue placeholder="Status" />
    </SelectTrigger>
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "aria-label on SelectTrigger = labeled");
});

Deno.test("Label htmlFor + SelectTrigger id = no violation", () => {
  const files = new Map([["src/Filter.tsx", `
    <Label htmlFor="s">Status</Label>
    <SelectTrigger id="s"><SelectValue /></SelectTrigger>
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "Label htmlFor + SelectTrigger id = labeled");
});

Deno.test("Switch without label = flagged", () => {
  const files = new Map([["src/Settings.tsx", `<Switch />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1, "Switch without label should be flagged");
  assert(results[0].elementType.includes("Switch"), "Should report as Switch");
});

Deno.test("Switch with aria-label = no violation", () => {
  const files = new Map([["src/Settings.tsx", `<Switch aria-label="Dark mode" />`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "aria-label on Switch = labeled");
});

Deno.test("Checkbox without label = flagged", () => {
  const files = new Map([["src/Form.tsx", `<Checkbox />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1, "Checkbox without label should be flagged");
});

Deno.test("Checkbox with aria-label = no violation", () => {
  const files = new Map([["src/Form.tsx", `<Checkbox aria-label="Agree to terms" />`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "aria-label on Checkbox = labeled");
});

Deno.test("RadioGroupItem without label = flagged", () => {
  const files = new Map([["src/Form.tsx", `<RadioGroupItem value="a" />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1, "RadioGroupItem without label should be flagged");
});

Deno.test("Slider without label = flagged", () => {
  const files = new Map([["src/Form.tsx", `<Slider />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1, "Slider without label should be flagged");
});

Deno.test("Slider with aria-label = no violation", () => {
  const files = new Map([["src/Form.tsx", `<Slider aria-label="Volume" />`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "aria-label on Slider = labeled");
});

// ===== IMPORT-AWARE CONTROL IDENTIFICATION TESTS =====

Deno.test("Switch from react-router-dom is NOT treated as a form control", () => {
  const files = new Map([["src/App.tsx", `
    import { Switch, Route } from "react-router-dom";
    function App() {
      return <Switch><Route path="/" /><Route path="/about" /></Switch>;
    }
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "Routing Switch should not be flagged");
});

Deno.test("Switch from @/components/ui/switch IS treated as a form control", () => {
  const files = new Map([["src/Settings.tsx", `
    import { Switch } from "@/components/ui/switch";
    function Settings() {
      return <Switch />;
    }
  `]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1, "UI Switch without label should be flagged");
});

Deno.test("Switch from @/components/ui/switch with aria-label = no violation", () => {
  const files = new Map([["src/Settings.tsx", `
    import { Switch } from "@/components/ui/switch";
    function Settings() {
      return <Switch aria-label="Dark mode" />;
    }
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "UI Switch with aria-label = labeled");
});

Deno.test("Switch from react-router is NOT flagged even without label", () => {
  const files = new Map([["src/Router.tsx", `
    import { Switch } from "react-router";
    export default function Router() {
      return <Switch><div /></Switch>;
    }
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "react-router Switch should be skipped");
});

Deno.test("Switch with explicit role=switch but unknown import IS flagged", () => {
  const files = new Map([["src/Toggle.tsx", `
    import { Switch } from "some-unknown-lib";
    function Toggle() {
      return <Switch role="switch" />;
    }
  `]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1, "Switch with explicit role=switch should be flagged as control");
});

// ===== JSX EXPRESSION SYNTAX TESTS =====

Deno.test("Input with aria-label={\"...\"} JSX expression = no violation", () => {
  const files = new Map([["src/Search.tsx", `
    <Input aria-label={"Search patients"} placeholder="Search..." />
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "JSX expression aria-label should be recognized");
});

Deno.test("Input with aria-label={'...'} single quote JSX expression = no violation", () => {
  const files = new Map([["src/Search.tsx", `
    <Input aria-label={'Search patients'} placeholder="Search..." />
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "Single-quote JSX expression aria-label should be recognized");
});

Deno.test("native input with aria-label={\"...\"} = no violation", () => {
  const files = new Map([["src/Form.tsx", `<input type="text" aria-label={"Email address"} />`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "JSX expression aria-label on native input should be recognized");
});

Deno.test("SelectTrigger with aria-labelledby={\"id1\"} = no violation", () => {
  const files = new Map([["src/Filter.tsx", `
    <span id="lbl">Status</span>
    <SelectTrigger aria-labelledby={"lbl"}>
      <SelectValue />
    </SelectTrigger>
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0, "JSX expression aria-labelledby should be recognized");
});
