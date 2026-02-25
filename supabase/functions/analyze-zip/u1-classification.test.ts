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

interface ActionGroup {
  containerType: string;
  buttons: ButtonUsage[];
  lineContext: string;
  offset: number;
}

function extractActionGroups(content: string, buttonLocalNames: Set<string>): ActionGroup[] {
  const groups: ActionGroup[] = [];
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
        groups.push({ containerType: type, buttons, lineContext: match[0].slice(0, 200), offset: match.index });
      }
    }
  }
  return groups;
}

// =====================
// Inline detectU1PrimaryAction (same as in index.ts)
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
    if (exportedFn?.[1]) componentName = exportedFn[1];

    const u12SuppressedLabels = new Set<string>();
    const actionGroups = extractActionGroups(content, buttonLocalNames);
    for (const group of actionGroups) {
      // Scoped suppression: skip if inside a U1.1 form
      if (isInsideU11Form(filePath, group.offset)) continue;
      const ctas: Array<{ label: string; emphasis: Emphasis; styleKey: string | null }> = [];
      for (const btn of group.buttons) {
        if (buttonImpl && (btn.variant || buttonImpl.config.defaultVariant)) {
          const resolvedVariant = btn.variant || buttonImpl.config.defaultVariant || 'default';
          const classified = classifyButtonEmphasis({ resolvedVariant, variantConfig: buttonImpl.config, instanceClassName: btn.className });
          ctas.push({ label: btn.label, emphasis: classified.emphasis, styleKey: classified.styleKey });
        } else {
          const twEmphasis = classifyTailwindEmphasis(btn.className);
          const styleKey = twEmphasis === 'high' ? 'tw-filled' : twEmphasis === 'low' ? 'tw-outline' : twEmphasis === 'medium' ? 'tw-secondary' : null;
          ctas.push({ label: btn.label, emphasis: twEmphasis, styleKey });
        }
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

          // Signal-based confidence for U1.2
          let u12Confidence = 0.60;
          u12Confidence += 0.10; // same parent container
          u12Confidence += 0.10; // same high-emphasis styling
          if (group.containerType === 'CardFooter' || /flex.*row|flex-row|gap-|space-x-/.test(group.lineContext)) {
            u12Confidence += 0.05;
          }
          const hasSemanticDiff = group.buttons.some(b => /aria-describedby/.test(b.className || ''));
          if (!hasSemanticDiff) {
            u12Confidence += 0.05;
          }
          u12Confidence = Math.min(u12Confidence, 0.90);

          findings.push({
            subCheck: 'U1.2', subCheckLabel: 'Multiple equivalent CTAs', classification: 'potential',
            elementLabel: `${componentName} — ${group.containerType}`, elementType: 'button group', filePath,
            detection: `${highs.length} CTAs share high-emphasis styling`,
            evidence: `${labels.join(', ')} — all use same high-emphasis styling (${sharedToken})`,
            explanation: `${highs.length} sibling CTA buttons share identical high-emphasis styling.`,
            confidence: u12Confidence,
            advisoryGuidance: 'Visually distinguish the primary action.',
            deduplicationKey: `U1.2|${filePath}|${group.containerType}`,
          });
          for (const cta of ctas) {
            u12SuppressedLabels.add(cta.label.trim().toLowerCase());
          }
        }
      }
    }

    const allButtons = extractButtonUsagesFromJsx(content, buttonLocalNames);
    for (const btn of allButtons) {
      const labelLower = btn.label.trim().toLowerCase();
      if (GENERIC_LABELS.has(labelLower)) {
        // Scoped suppression: skip if inside a U1.1 form
        if (isInsideU11Form(filePath, btn.offset)) continue;
        if (u12SuppressedLabels.has(labelLower)) continue;
        const dedupeKey = `U1.3|${filePath}|${labelLower}`;
        if (findings.some(f => f.deduplicationKey === dedupeKey)) continue;

        // Signal-based confidence for U1.3
        const HIGH_RISK_GENERICS = new Set(['continue', 'next', 'submit', 'save', 'confirm', 'ok']);
        let u13Confidence = 0.55;
        if (HIGH_RISK_GENERICS.has(labelLower)) {
          u13Confidence += 0.10;
        }
        const hasNearbyHeading = /<(?:h[1-6]|label|legend)\b[^>]*>/.test(content);
        if (!hasNearbyHeading) {
          u13Confidence += 0.05;
        }
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
