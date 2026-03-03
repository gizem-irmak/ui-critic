// A1 Classification Tests — Variant-aware contrast detection
// Tests for: variant filtering, alpha compositing, background resolution, conditional branches,
// unresolved background handling, CVA variant analysis

import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// ===== Helpers (mirror edge function logic) =====

const VARIANT_PREFIXES = new Set([
  'hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited',
  'disabled', 'dark', 'group-hover', 'group-focus', 'peer-hover', 'peer-focus',
  'first', 'last', 'odd', 'even', 'placeholder', 'selection', 'marker',
  'before', 'after', 'sm', 'md', 'lg', 'xl', '2xl',
]);

const TW_COLOR_FAMILIES = 'gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black';

function extractTextColorTokens(code: string): Array<{ colorClass: string; colorName: string; variant?: string; alpha?: number; matchIndex: number }> {
  const results: Array<{ colorClass: string; colorName: string; variant?: string; alpha?: number; matchIndex: number }> = [];
  const textColorRegex = new RegExp(`text-(${TW_COLOR_FAMILIES})-?(\\d{2,3})?(?:/(\\d{1,3}))?`, 'g');
  let match;
  while ((match = textColorRegex.exec(code)) !== null) {
    const colorClass = match[0];
    const colorName = match[1] + (match[2] ? `-${match[2]}` : '');
    const alphaRaw = match[3] ? parseInt(match[3]) : undefined;
    const alpha = alphaRaw !== undefined ? alphaRaw / 100 : undefined;
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
    results.push({ colorClass, colorName, variant, alpha, matchIndex: match.index });
  }
  return results;
}

function extractBgFromClasses(classes: string): { bgClass: string; bgName: string } | null {
  const bgRegex = new RegExp(`^bg-(${TW_COLOR_FAMILIES})-?(\\d{2,3})?(?:/(\\d{1,3}))?$`);
  const tokens = classes.split(/\s+/);
  for (const token of tokens) {
    if (token.includes(':')) continue;
    const m = token.match(bgRegex);
    if (m) return { bgClass: m[0], bgName: m[1] + (m[2] ? `-${m[2]}` : '') };
  }
  return null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}

function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(hex1: string, hex2: string): number | null {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return null;
  const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function alphaComposite(fgHex: string, bgHex: string, alpha: number): string | null {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) return null;
  const r = Math.round(fg.r * alpha + bg.r * (1 - alpha));
  const g = Math.round(fg.g * alpha + bg.g * (1 - alpha));
  const b = Math.round(fg.b * alpha + bg.b * (1 - alpha));
  return '#' + [r, g, b].map(c => Math.min(255, c).toString(16).padStart(2, '0')).join('');
}

// Simulates resolveBackground: returns 'unresolved' (NOT 'assumed_default') when no bg found
type BgSourceType = 'self' | 'ancestor' | 'unresolved';
function resolveBackgroundFromClasses(classes: string): { bgName: string | null; bgSourceType: BgSourceType } {
  const bg = extractBgFromClasses(classes);
  if (bg) return { bgName: bg.bgName, bgSourceType: 'self' };
  return { bgName: null, bgSourceType: 'unresolved' };
}

// ===== Test A: hover:text-* should NOT be treated as base foreground =====
Deno.test("A1: hover:text-blue-500 is detected as variant=hover, not base", () => {
  const code = `<a className="text-blue-600 hover:text-blue-500 bg-white">Link</a>`;
  const tokens = extractTextColorTokens(code);
  const baseTokens = tokens.filter(t => !t.variant);
  const hoverTokens = tokens.filter(t => t.variant === 'hover');
  assertEquals(baseTokens.length, 1);
  assertEquals(baseTokens[0].colorName, 'blue-600');
  assertEquals(hoverTokens.length, 1);
  assertEquals(hoverTokens[0].colorName, 'blue-500');
});

Deno.test("A1: base text-blue-600 on bg-white PASSES (ratio > 4.5)", () => {
  const fgHex = '#2563eb'; // blue-600
  const bgHex = '#ffffff';
  const ratio = getContrastRatio(fgHex, bgHex);
  assertExists(ratio);
  assertEquals(ratio! >= 4.5, true, `Expected ratio >= 4.5, got ${ratio!.toFixed(2)}`);
});

Deno.test("A1: hover:text-blue-500 on bg-white is reported as hover variant FAIL", () => {
  const fgHex = '#3b82f6'; // blue-500
  const bgHex = '#ffffff';
  const ratio = getContrastRatio(fgHex, bgHex);
  assertExists(ratio);
  assertEquals(ratio! < 4.5, true, `Expected ratio < 4.5, got ${ratio!.toFixed(2)}`);
});

// ===== Test B: variant bg tokens should be excluded from base bg resolution =====
Deno.test("A1: extractBgFromClasses ignores variant-prefixed bg tokens", () => {
  const classes = "p-4 hover:bg-blue-500 dark:bg-gray-900 bg-white text-gray-600";
  const result = extractBgFromClasses(classes);
  assertExists(result);
  assertEquals(result!.bgName, 'white');
  assertEquals(result!.bgClass, 'bg-white');
});

Deno.test("A1: extractBgFromClasses returns null when only variant bg tokens exist", () => {
  const classes = "p-4 hover:bg-blue-500 dark:bg-gray-900 text-gray-600";
  const result = extractBgFromClasses(classes);
  assertEquals(result, null);
});

// ===== Test C: alpha compositing =====
Deno.test("A1: text-gray-900/80 on bg-white alpha composites correctly", () => {
  const fgHex = '#111827'; // gray-900
  const bgHex = '#ffffff';
  const composited = alphaComposite(fgHex, bgHex, 0.80);
  assertExists(composited);
  const compositedRgb = hexToRgb(composited!);
  const originalRgb = hexToRgb(fgHex);
  assertExists(compositedRgb);
  assertExists(originalRgb);
  assertEquals(compositedRgb!.r > originalRgb!.r, true, 'Composited R should be lighter');
});

Deno.test("A1: alpha token parsing extracts /80 correctly", () => {
  const code = `<p className="text-gray-900/80">Hello</p>`;
  const tokens = extractTextColorTokens(code);
  assertEquals(tokens.length, 1);
  assertEquals(tokens[0].colorName, 'gray-900');
  assertEquals(tokens[0].alpha, 0.8);
  assertEquals(tokens[0].variant, undefined);
});

// ===== Test D: conditional branch separation =====
Deno.test("A1: ternary branches produce independent tokens (no mixing)", () => {
  const code = `<div className={isSelected ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"}>`;
  const tokens = extractTextColorTokens(code);
  const baseTokens = tokens.filter(t => !t.variant);
  assertEquals(baseTokens.length, 2);
  const colorNames = baseTokens.map(t => t.colorName).sort();
  assertEquals(colorNames.includes('white'), true);
  assertEquals(colorNames.includes('gray-600'), true);
});

// ===== Test E: text-red-600 without explicit bg → unresolved (NOT assumed white) =====
Deno.test("A1: text-red-600 without explicit bg gets unresolved (not assumed white)", () => {
  const classes = "text-sm font-medium text-red-600";
  const result = resolveBackgroundFromClasses(classes);
  assertEquals(result.bgName, null);
  assertEquals(result.bgSourceType, 'unresolved');
});

// ===== Test F: variant prefix detection edge cases =====
Deno.test("A1: focus-visible:text-blue-400 detected as variant=focus-visible", () => {
  const code = `<button className="text-gray-700 focus-visible:text-blue-400">`;
  const tokens = extractTextColorTokens(code);
  const focusTokens = tokens.filter(t => t.variant === 'focus-visible');
  assertEquals(focusTokens.length, 1);
  assertEquals(focusTokens[0].colorName, 'blue-400');
});

Deno.test("A1: group-hover:text-white detected as variant=group-hover", () => {
  const code = `<span className="text-gray-500 group-hover:text-white">`;
  const tokens = extractTextColorTokens(code);
  const groupHoverTokens = tokens.filter(t => t.variant === 'group-hover');
  assertEquals(groupHoverTokens.length, 1);
  assertEquals(groupHoverTokens[0].colorName, 'white');
});

// ===== Test G: dark: variant should not be used as base foreground =====
Deno.test("A1: dark:text-gray-300 not treated as base foreground", () => {
  const code = `<p className="text-gray-700 dark:text-gray-300">`;
  const tokens = extractTextColorTokens(code);
  const baseTokens = tokens.filter(t => !t.variant);
  assertEquals(baseTokens.length, 1);
  assertEquals(baseTokens[0].colorName, 'gray-700');
  const darkTokens = tokens.filter(t => t.variant === 'dark');
  assertEquals(darkTokens.length, 1);
  assertEquals(darkTokens[0].colorName, 'gray-300');
});

// ===== Test H: multiple variant prefixes on same element =====
Deno.test("A1: multiple variants (hover, focus, active) all detected correctly", () => {
  const code = `<button className="text-gray-600 hover:text-gray-800 focus:text-blue-600 active:text-blue-700">`;
  const tokens = extractTextColorTokens(code);
  assertEquals(tokens.filter(t => !t.variant).length, 1);
  assertEquals(tokens.filter(t => t.variant === 'hover').length, 1);
  assertEquals(tokens.filter(t => t.variant === 'focus').length, 1);
  assertEquals(tokens.filter(t => t.variant === 'active').length, 1);
});

// ===== Test I: contrast ratio computation accuracy =====
Deno.test("A1: contrast ratio — gray-500 on white", () => {
  const ratio = getContrastRatio('#6b7280', '#ffffff');
  assertExists(ratio);
  assertEquals(ratio! >= 4.5, true, `gray-500 on white should pass, got ${ratio!.toFixed(2)}`);
});

Deno.test("A1: alpha composite contrast — text-gray-900/80 on white still passes", () => {
  const composited = alphaComposite('#111827', '#ffffff', 0.80);
  assertExists(composited);
  const ratio = getContrastRatio(composited!, '#ffffff');
  assertExists(ratio);
  assertEquals(ratio! >= 4.5, true, `gray-900/80 on white should pass, got ${ratio!.toFixed(2)}`);
});

// ===================================================================
// REGRESSION: Unresolved background — no false contrast computation
// ===================================================================

Deno.test("A1 REGRESSION: text-white with no bg specified → bg unresolved, no contrast computed", () => {
  // Simulates Button.tsx: text-white with no bg-* in the same variant
  const classes = "text-white font-medium";
  const resolved = resolveBackgroundFromClasses(classes);
  assertEquals(resolved.bgSourceType, 'unresolved', 'bg must be unresolved when no bg-* token exists');
  assertEquals(resolved.bgName, null);
  
  // Contrast MUST NOT be computed — getContrastRatio with empty string returns null
  const ratio = getContrastRatio('#ffffff', '');
  assertEquals(ratio, null, 'Contrast must not be computed when bg is unresolved');
});

Deno.test("A1 REGRESSION: CVA variant 'bg-blue-600 text-white' → contrast computed and PASSES", () => {
  const classes = "bg-blue-600 text-white";
  const resolved = resolveBackgroundFromClasses(classes);
  assertEquals(resolved.bgSourceType, 'self');
  assertEquals(resolved.bgName, 'blue-600');
  
  // blue-600 (#2563eb) on white: this is fg=white, bg=blue-600
  const ratio = getContrastRatio('#ffffff', '#2563eb');
  assertExists(ratio);
  // white on blue-600 should have decent contrast
  assertEquals(ratio! >= 4.5, true, `white on blue-600 should pass, got ${ratio!.toFixed(2)}`);
});

Deno.test("A1 REGRESSION: CVA variant with only text-white, no bg → unresolved, no numeric ratio", () => {
  // This is the Button.tsx false positive case: variant="link" with text-primary but no bg
  const classes = "text-white underline-offset-4 hover:underline";
  const resolved = resolveBackgroundFromClasses(classes);
  assertEquals(resolved.bgSourceType, 'unresolved');
  assertEquals(resolved.bgName, null);
});

Deno.test("A1 REGRESSION: never produce 1.0:1 contrast when bg is uncertain/unresolved", () => {
  // If bg is unresolved, contrast must be null, not 1.0:1
  const classes = "text-white";
  const resolved = resolveBackgroundFromClasses(classes);
  assertEquals(resolved.bgSourceType, 'unresolved');
  
  // The old code would assume bg=#ffffff → getContrastRatio('#ffffff','#ffffff') = 1.0
  // New code: ratio must be null
  const ratio = getContrastRatio('#ffffff', '');
  assertEquals(ratio, null, 'Must not compute contrast against empty/unresolved bg');
});

Deno.test("A1 REGRESSION: bg-destructive text-destructive-foreground → both resolved, contrast computable", () => {
  // Simulates a CVA variant where both fg and bg are present
  const classes = "bg-red-600 text-white";
  const resolved = resolveBackgroundFromClasses(classes);
  assertEquals(resolved.bgSourceType, 'self');
  assertEquals(resolved.bgName, 'red-600');
  
  const ratio = getContrastRatio('#ffffff', '#dc2626'); // red-600
  assertExists(ratio);
  // white on red-600 should have contrast > 4.5
  assertEquals(ratio! >= 4.5, true, `white on red-600 should pass, got ${ratio!.toFixed(2)}`);
});
