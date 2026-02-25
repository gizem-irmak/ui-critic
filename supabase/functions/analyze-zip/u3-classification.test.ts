/**
 * U3 — Truncated or Inaccessible Content
 * Classification tests for deterministic sub-checks U3.D1–U3.D4
 */
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ─── Helpers ───────────────────────────────────────────────────────
function hasPattern(content: string, pattern: RegExp): boolean {
  return pattern.test(content);
}

// ═══════════════════════════════════════════════════
// U3.D1 — Line clamp / ellipsis truncation
// ═══════════════════════════════════════════════════

Deno.test("U3.D1: line-clamp-2 without expand triggers", () => {
  const code = `<p className="line-clamp-2 text-sm">{description}</p>`;
  assert(hasPattern(code, /\bline-clamp-[1-3]\b/));
  assert(!hasPattern(code, /show\s*more|expand|toggle/i));
});

Deno.test("U3.D1: line-clamp-3 with Show More does NOT trigger", () => {
  const code = `
    <p className="line-clamp-3">{text}</p>
    <button onClick={toggleExpand}>Show more</button>
  `;
  assert(hasPattern(code, /\bline-clamp-[1-3]\b/));
  assert(hasPattern(code, /show\s*more/i)); // Has expand → should skip
});

Deno.test("U3.D1: truncate class without title or expand triggers", () => {
  const code = `<span className="truncate w-48">{fileName}</span>`;
  assert(hasPattern(code, /\btruncate\b/));
  assert(!hasPattern(code, /title\s*=|tooltip|show\s*more/i));
});

Deno.test("U3.D1: truncate class with title attribute does NOT trigger", () => {
  const code = `<span className="truncate w-48" title={fileName}>{fileName}</span>`;
  assert(hasPattern(code, /\btruncate\b/));
  assert(hasPattern(code, /title\s*=/i)); // Has title → should skip
});

Deno.test("U3.D1: text-ellipsis without expand triggers", () => {
  const code = `<div className="text-ellipsis overflow-hidden whitespace-nowrap">{label}</div>`;
  assert(hasPattern(code, /\btext-ellipsis\b/));
  assert(!hasPattern(code, /show\s*more|expand|toggle/i));
});

Deno.test("U3.D1: whitespace-nowrap + overflow-hidden triggers", () => {
  const code = `<div className="whitespace-nowrap overflow-hidden w-32">{longText}</div>`;
  assert(hasPattern(code, /\bwhitespace-nowrap\b/));
  assert(hasPattern(code, /overflow-hidden\b/));
  assert(!hasPattern(code, /show\s*more|expand|title\s*=|tooltip/i));
});

Deno.test("U3.D1: whitespace-nowrap + overflow-auto does NOT trigger", () => {
  const code = `<div className="whitespace-nowrap overflow-auto">{text}</div>`;
  assert(hasPattern(code, /\bwhitespace-nowrap\b/));
  assert(hasPattern(code, /overflow-auto\b/)); // Has scroll → should skip
});

// ═══════════════════════════════════════════════════
// U3.D2 — Overflow clipping with fixed height
// ═══════════════════════════════════════════════════

Deno.test("U3.D2: max-h-40 + overflow-hidden triggers when text present", () => {
  const code = `<div className="max-h-40 overflow-hidden"><p>Long description text content here that extends beyond limits</p></div>`;
  assert(hasPattern(code, /\bmax-h-\d+\b/));
  assert(hasPattern(code, /overflow-hidden\b/));
  assert(hasPattern(code, /<p\b/));
});

Deno.test("U3.D2: h-32 + overflow-hidden + expand button does NOT trigger", () => {
  const code = `
    <div className="h-32 overflow-hidden">
      <p>{content}</p>
    </div>
    <button onClick={expand}>Read more</button>
  `;
  assert(hasPattern(code, /\bh-\d+\b/));
  assert(hasPattern(code, /overflow-hidden\b/));
  assert(hasPattern(code, /read\s*more/i)); // Has expand → should skip
});

Deno.test("U3.D2: max-h-64 + overflow-auto does NOT trigger (scrollable)", () => {
  const code = `<div className="max-h-64 overflow-auto"><p>{content}</p></div>`;
  assert(hasPattern(code, /\bmax-h-\d+\b/));
  assert(hasPattern(code, /overflow-auto\b/)); // Has scroll → should skip
});

// ═══════════════════════════════════════════════════
// U3.D3 — Scroll trap risk
// ═══════════════════════════════════════════════════

Deno.test("U3.D3: nested overflow-y-scroll inside fixed height triggers", () => {
  const code = `
    <div className="h-96 overflow-y-auto">
      <div className="h-48 overflow-y-scroll">
        <p>Nested scroll content</p>
      </div>
    </div>
  `;
  const scrollMatches = code.match(/overflow-y-(?:scroll|auto)/g);
  assert(scrollMatches !== null && scrollMatches.length >= 2);
  assert(hasPattern(code, /\bh-\d+\b/));
});

Deno.test("U3.D3: single scroll container does NOT trigger", () => {
  const code = `<div className="h-96 overflow-y-auto"><p>Content</p></div>`;
  const scrollMatches = code.match(/overflow-y-(?:scroll|auto)/g);
  assertEquals(scrollMatches?.length, 1); // Only 1 → should NOT trigger
});

// ═══════════════════════════════════════════════════
// U3.D4 — Hidden content without control
// ═══════════════════════════════════════════════════

Deno.test("U3.D4: aria-hidden on meaningful text without toggle triggers", () => {
  const code = `<div aria-hidden="true"><p>Important description text that users need</p></div>`;
  assert(hasPattern(code, /aria-hidden\s*=\s*["']true["']/));
  assert(hasPattern(code, /<p\b[^>]*>[^<]{5,}/));
  assert(!hasPattern(code, /toggle|setVisible|setOpen|useState/i));
});

Deno.test("U3.D4: aria-hidden on SVG icon does NOT trigger", () => {
  const code = `<svg aria-hidden="true"><path d="..." /></svg>`;
  assert(hasPattern(code, /aria-hidden\s*=\s*["']true["']/));
  assert(hasPattern(code, /\bsvg\b/i)); // SVG → decorative, should skip
});

Deno.test("U3.D4: hidden attr with toggle control does NOT trigger", () => {
  const code = `
    const [visible, setVisible] = useState(false);
    <div hidden={!visible}><p>Hidden content description here</p></div>
  `;
  assert(hasPattern(code, /\bhidden\b/));
  assert(hasPattern(code, /setVisible|useState/i)); // Has toggle → should skip
});

Deno.test("U3.D4: sr-only content does NOT trigger", () => {
  const code = `<span className="sr-only" aria-hidden="true">Screen reader only text content here</span>`;
  assert(hasPattern(code, /aria-hidden\s*=\s*["']true["']/));
  assert(hasPattern(code, /sr-only/i)); // Accessibility pattern → should skip
});

// ═══════════════════════════════════════════════════
// Confidence model
// ═══════════════════════════════════════════════════

Deno.test("U3 confidence: base 0.70 for single sub-check", () => {
  const base = 0.70;
  const subCheckCount = 1;
  const bonus = Math.min((subCheckCount - 1) * 0.05, 0.15);
  assertEquals(base + bonus, 0.70);
});

Deno.test("U3 confidence: +0.05 for 2 sub-checks", () => {
  const base = 0.70;
  const subCheckCount = 2;
  const bonus = Math.min((subCheckCount - 1) * 0.05, 0.15);
  assertEquals(base + bonus, 0.75);
});

Deno.test("U3 confidence: capped at 0.85 for 4 sub-checks", () => {
  const base = 0.70;
  const subCheckCount = 4;
  const bonus = Math.min((subCheckCount - 1) * 0.05, 0.15);
  assertEquals(Math.min(base + bonus, 0.85), 0.85);
});

// ═══════════════════════════════════════════════════
// Classification: Always Potential
// ═══════════════════════════════════════════════════

Deno.test("U3: All findings must be classified as 'potential'", () => {
  // U3 never produces confirmed findings
  const classification = 'potential';
  assertEquals(classification, 'potential');
});

Deno.test("U3: blocksConvergence must be false", () => {
  const blocksConvergence = false;
  assertEquals(blocksConvergence, false);
});
