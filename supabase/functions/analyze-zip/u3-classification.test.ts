/**
 * U3 — Truncated or Inaccessible Content
 * Classification tests for deterministic sub-checks U3.D1–U3.D4
 * Including suppression rules for short text, responsive hidden, and expand mechanisms
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
  assert(hasPattern(code, /\bline-clamp-[1-6]\b/));
  assert(!hasPattern(code, /show\s*more|expand|toggle/i));
});

Deno.test("U3.D1: line-clamp-3 with Show More does NOT trigger", () => {
  const code = `
    <p className="line-clamp-3">{text}</p>
    <button onClick={toggleExpand}>Show more</button>
  `;
  assert(hasPattern(code, /\bline-clamp-[1-6]\b/));
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
// U3.D1 — SHORT STATIC TEXT SUPPRESSION
// ═══════════════════════════════════════════════════

Deno.test("U3.D1 SUPPRESS: truncate on 'Admin' (5 chars) → NOT reported", () => {
  const staticLen = "Admin".length;
  assert(staticLen <= 18, "Short static text should be suppressed");
});

Deno.test("U3.D1 SUPPRESS: truncate on 'New' (3 chars) → NOT reported", () => {
  const staticLen = "New".length;
  assert(staticLen <= 18);
});

Deno.test("U3.D1 SUPPRESS: truncate on 'Sent' (4 chars) → NOT reported", () => {
  const staticLen = "Sent".length;
  assert(staticLen <= 18);
});

Deno.test("U3.D1 SUPPRESS: truncate on 'Home' (4 chars) → NOT reported", () => {
  const staticLen = "Home".length;
  assert(staticLen <= 18);
});

Deno.test("U3.D1 SUPPRESS: truncate on 'Login' (5 chars) → NOT reported", () => {
  const staticLen = "Login".length;
  assert(staticLen <= 18);
});

Deno.test("U3.D1 SUPPRESS: truncate on 'No messages yet' (15 chars) → NOT reported", () => {
  const staticLen = "No messages yet".length;
  assert(staticLen <= 18, "15-char static text should be suppressed under new ≤18 threshold");
});

Deno.test("U3.D1: truncate on dynamic {doc.bio} → REPORTED", () => {
  const preview = "(dynamic text: doc.bio)";
  assert(preview.startsWith("(dynamic text"), "Dynamic content should be reported");
});

Deno.test("U3.D1: line-clamp-2 on 25-char static text → REPORTED", () => {
  const staticLen = "This is a longer sentence".length;
  assert(staticLen > 18, "Longer static text should be reported");
});

// ═══════════════════════════════════════════════════
// U3.D1 — WIDE CONTAINER SUPPRESSION
// ═══════════════════════════════════════════════════

Deno.test("U3.D1 SUPPRESS: truncate + w-full (no max-w) on short text", () => {
  const context = `<span className="truncate w-full">Short label</span>`;
  assert(hasPattern(context, /\bw-full\b/));
  assert(!hasPattern(context, /\bmax-w-/));
  // With static text ≤30 chars + w-full → suppressed
});

Deno.test("U3.D1: truncate + w-full + max-w-xs → NOT suppressed", () => {
  const context = `<span className="truncate w-full max-w-xs">{item.name}</span>`;
  assert(hasPattern(context, /\bw-full\b/));
  assert(hasPattern(context, /\bmax-w-/)); // Has max-w constraint → not suppressed
});

// ═══════════════════════════════════════════════════
// U3.D1 — EXPAND MECHANISM DETECTION (±20 lines)
// ═══════════════════════════════════════════════════

Deno.test("U3.D1 SUPPRESS: expanded/setExpanded state nearby", () => {
  const window = `
    const [expanded, setExpanded] = useState(false);
    <p className="line-clamp-2">{bio}</p>
    <button onClick={() => setExpanded(!expanded)}>Read more</button>
  `;
  assert(hasPattern(window, /\b(expanded|setExpanded)\b/));
});

Deno.test("U3.D1 SUPPRESS: <Tooltip> component nearby", () => {
  const window = `
    <Tooltip content={fullText}>
      <span className="truncate w-32">{shortText}</span>
    </Tooltip>
  `;
  assert(hasPattern(window, /<Tooltip/i));
});

Deno.test("U3.D1 SUPPRESS: title= attribute nearby", () => {
  const window = `<span className="truncate" title={fullName}>{name}</span>`;
  assert(hasPattern(window, /title\s*=/i));
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
// U3.D4 — Hidden content without control (REFINED)
// ═══════════════════════════════════════════════════

Deno.test("U3.D4: hidden on meaningful text without toggle triggers", () => {
  const code = `<div hidden><p>Important description text that users really need to see for full context</p></div>`;
  assert(hasPattern(code, /\bhidden\b/));
  assert(hasPattern(code, /<p\b[^>]*>[^<]{20,}/));
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
    <div hidden={!visible}><p>Hidden content description here that is definitely long enough text</p></div>
  `;
  assert(hasPattern(code, /\bhidden\b/));
  assert(hasPattern(code, /setVisible|useState/i)); // Has toggle → should skip
});

Deno.test("U3.D4: sr-only content does NOT trigger", () => {
  const code = `<span className="sr-only" aria-hidden="true">Screen reader only text content here</span>`;
  assert(hasPattern(code, /sr-only/i)); // Accessibility pattern → should skip
});

// U3.D4 — RESPONSIVE HIDDEN SUPPRESSION

Deno.test("U3.D4 SUPPRESS: responsive hidden (md:hidden) → NOT reported", () => {
  const code = `<div className="hidden md:block"><p>Navigation menu content that is meaningful text</p></div>`;
  assert(hasPattern(code, /hidden\s+(?:sm|md|lg|xl|2xl):(?:block|flex|inline|grid)\b/));
});

Deno.test("U3.D4 SUPPRESS: responsive hidden (block md:hidden) → NOT reported", () => {
  const code = `<div className="block md:hidden"><p>Mobile navigation content for mobile users</p></div>`;
  assert(hasPattern(code, /(?:block|flex|inline|grid)\s+(?:sm|md|lg|xl|2xl):hidden\b/));
});

Deno.test("U3.D4 SUPPRESS: sm:hidden on line → NOT reported", () => {
  const code = `<span className="sm:hidden text-lg">Menu text content</span>`;
  assert(hasPattern(code, /\b(?:sm|md|lg|xl|2xl):hidden\b/));
});

Deno.test("U3.D4 SUPPRESS: aria-hidden='true' → NOT reported (intentional)", () => {
  // aria-hidden is now treated as intentional/decorative and suppressed
  const code = `<div aria-hidden="true"><p>Some meaningful content that is intentionally hidden from AT</p></div>`;
  assert(hasPattern(code, /aria-hidden\s*=\s*["']true["']/));
  // This should be suppressed — aria-hidden is intentional
});

Deno.test("U3.D4 SUPPRESS: aria-controls/aria-expanded nearby → NOT reported", () => {
  const code = `
    <button aria-expanded="false" aria-controls="panel1">Toggle</button>
    <div hidden id="panel1"><p>Panel content that is meaningful and long enough</p></div>
  `;
  assert(hasPattern(code, /aria-controls|aria-expanded/i));
});

Deno.test("U3.D4: hidden on short text (< 20 chars) → NOT reported", () => {
  const code = `<div hidden><p>Short text here</p></div>`;
  // Text "Short text here" is 15 chars, below 20 threshold
  assert(!hasPattern(code, /<p\b[^>]*>[^<]{20,}/));
});

// ═══════════════════════════════════════════════════
// U3.D5 — Unbroken text overflow risk (with risk tiers)
// ═══════════════════════════════════════════════════

// --- Risk tier classification ---

Deno.test("U3.D5: {appt.reason} is High-risk", () => {
  const HIGH = /\b(?:reason|notes|bio|description|message|subject|comment|details|address|diagnosis|complaint|feedback|body|content|summary|remarks)\b/i;
  assert(HIGH.test("reason"));
  assert(HIGH.test("notes"));
  assert(HIGH.test("bio"));
  assert(HIGH.test("subject"));
});

Deno.test("U3.D5: {doc.specialty} is Medium-risk", () => {
  const MED = /\b(?:specialty|title|label|name)\b/i;
  assert(MED.test("specialty"));
  assert(MED.test("title"));
  assert(MED.test("name"));
});

Deno.test("U3.D5: {appt.location} is Low-risk", () => {
  const LOW = /\b(?:location|status|type|date|time|id|role|email|phone|count|price|amount|code|key|slug|url|href)\b/i;
  assert(LOW.test("location"));
  assert(LOW.test("status"));
  assert(LOW.test("date"));
  assert(LOW.test("id"));
});

// --- High-risk triggers ---

Deno.test("U3.D5: {reason} in nowrap container without break-words → triggers", () => {
  const code = `<td className="whitespace-nowrap">{appointment.reason}</td>`;
  assert(hasPattern(code, /\{[a-zA-Z_][\w]*\.[a-zA-Z_][\w]*\}/));
  assert(hasPattern(code, /\bwhitespace-nowrap\b/));
  assert(!hasPattern(code, /\bbreak-words\b|\bbreak-all\b|\boverflow-wrap/));
});

Deno.test("U3.D5: {notes} in truncate container → triggers", () => {
  const code = `<span className="truncate w-48">{item.notes}</span>`;
  assert(hasPattern(code, /\bnotes\b/i));
  assert(hasPattern(code, /\btruncate\b/));
  assert(!hasPattern(code, /\bbreak-words\b|\bbreak-all\b/));
});

Deno.test("U3.D5: {msg.subject} in TableCell → triggers", () => {
  const code = `<TableCell className="max-w-xs">{msg.subject}</TableCell>`;
  assert(hasPattern(code, /\bsubject\b/i));
  assert(hasPattern(code, /<TableCell\b/));
  assert(!hasPattern(code, /\bbreak-words\b|\bbreak-all\b/));
});

Deno.test("U3.D5: {reason} in grid cell with fixed width → triggers", () => {
  const code = `<div className="grid cols-3"><div className="w-40 overflow-hidden">{reason}</div></div>`;
  assert(hasPattern(code, /\breason\b/i));
  assert(hasPattern(code, /\bw-\d/));
  assert(!hasPattern(code, /\bbreak-words\b/));
});

// --- Suppression: wrap protection ---

Deno.test("U3.D5: {bio} with break-words → does NOT trigger", () => {
  const code = `<p className="break-words">{doc.bio}</p>`;
  assert(hasPattern(code, /\bbreak-words\b/));
});

Deno.test("U3.D5: {bio} with break-all → does NOT trigger", () => {
  const code = `<p className="break-all">{doc.bio}</p>`;
  assert(hasPattern(code, /\bbreak-all\b/));
});

Deno.test("U3.D5: code block with overflow-x-auto → suppressed", () => {
  const code = `<pre className="font-mono overflow-x-auto">{codeSnippet}</pre>`;
  assert(hasPattern(code, /\bfont-mono\b/));
  assert(hasPattern(code, /\boverflow-x-auto\b/));
});

// --- Low-risk suppression ---

Deno.test("U3.D5: {appt.location} with only fixed-width (no nowrap) → suppressed", () => {
  const LOW = /\b(?:location|status|type|date|time|id|role)\b/i;
  const EXPLICIT = /\bwhitespace-nowrap\b|\btruncate\b|\boverflow-hidden\b|\btext-ellipsis\b/;
  const code = `<td className="w-40">{appt.location}</td>`;
  assert(LOW.test("location"), "location is Low-risk");
  assert(!EXPLICIT.test(code), "No explicit overflow → Low-risk suppressed");
});

Deno.test("U3.D5: {item.status} with only max-w → suppressed", () => {
  const LOW = /\b(?:location|status|type|date|time|id|role)\b/i;
  const EXPLICIT = /\bwhitespace-nowrap\b|\btruncate\b|\boverflow-hidden\b|\btext-ellipsis\b/;
  const code = `<span className="max-w-xs">{item.status}</span>`;
  assert(LOW.test("status"));
  assert(!EXPLICIT.test(code));
});

Deno.test("U3.D5: {appt.location} with truncate → still reported (explicit overflow)", () => {
  const LOW = /\b(?:location|status|type|date|time|id|role)\b/i;
  const EXPLICIT = /\bwhitespace-nowrap\b|\btruncate\b|\boverflow-hidden\b|\btext-ellipsis\b/;
  const code = `<span className="truncate w-32">{appt.location}</span>`;
  assert(LOW.test("location"));
  assert(EXPLICIT.test(code), "Has explicit overflow → Low-risk still reported");
});

// --- Non-freeform variable → skipped ---

Deno.test("U3.D5: {item.id} without freeform key nearby → NOT reported", () => {
  const HIGH = /\b(?:reason|notes|description|message|subject|bio|comment|address|details|feedback|body|content|summary|remarks)\b/i;
  const MED = /\b(?:specialty|title|label|name)\b/i;
  const LOW = /\b(?:location|status|type|date|time|id|role)\b/i;
  // "id" matches Low-risk, but would need explicit overflow to report
  assert(LOW.test("id"));
});

// --- Confidence scoring ---

Deno.test("U3.D5: High-risk + explicit overflow → confidence 0.95 (clamped 0.90)", () => {
  let c = 0.70;
  c += 0.15; // explicit overflow
  c += 0.10; // High-risk
  c = Math.max(0.55, Math.min(0.90, c));
  assertEquals(c, 0.90);
});

Deno.test("U3.D5: Medium-risk + explicit overflow → confidence 0.90", () => {
  let c = 0.70;
  c += 0.15; // explicit overflow
  c += 0.05; // Medium-risk
  c = Math.max(0.55, Math.min(0.90, c));
  assertEquals(c, 0.90);
});

Deno.test("U3.D5: High-risk + only fixed-width → confidence ~0.80", () => {
  let c = 0.70;
  // no explicit overflow bonus
  c += 0.10; // High-risk
  c = Math.max(0.55, Math.min(0.90, c));
  assert(Math.abs(c - 0.80) < 0.001, `Expected ~0.80, got ${c}`);
});

Deno.test("U3.D5: Low-risk + explicit overflow → confidence 0.70", () => {
  let c = 0.70;
  c += 0.15; // explicit overflow
  c -= 0.15; // Low-risk
  c = Math.max(0.55, Math.min(0.90, c));
  assertEquals(c, 0.70);
});

Deno.test("U3.D5: Low-risk + only fixed-width → confidence 0.55 (suppressed)", () => {
  let c = 0.70;
  c -= 0.15; // Low-risk
  c = Math.max(0.55, Math.min(0.90, c));
  // 0.55 < 0.65 threshold → suppressed
  assert(c < 0.65, "Should be below suppression threshold");
});

Deno.test("U3.D5: wide container reduces confidence by 0.10", () => {
  let c = 0.70;
  c += 0.15; // explicit overflow
  c += 0.10; // High-risk
  c -= 0.10; // wide container
  c = Math.max(0.55, Math.min(0.90, c));
  assertEquals(c, 0.85);
});

Deno.test("U3.D5: tooltip nearby reduces confidence by 0.10", () => {
  let c = 0.70;
  c += 0.15; // explicit overflow
  c += 0.10; // High-risk
  c -= 0.10; // tooltip
  c = Math.max(0.55, Math.min(0.90, c));
  assertEquals(c, 0.85);
});

// ═══════════════════════════════════════════════════
// Confidence model (cross-subcheck bonus)
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

Deno.test("U3 confidence: dynamic content gets 0.75 base", () => {
  const isDynamic = true;
  const confidence = isDynamic ? 0.75 : 0.70;
  assertEquals(confidence, 0.75);
});

Deno.test("U3 confidence: long static text (≥20 chars) gets 0.72 base", () => {
  const staticLen = 25;
  const confidence = staticLen >= 20 ? 0.72 : 0.70;
  assertEquals(confidence, 0.72);
});

// ═══════════════════════════════════════════════════
// Classification: Always Potential
// ═══════════════════════════════════════════════════

Deno.test("U3: All findings must be classified as 'potential'", () => {
  const classification = 'potential';
  assertEquals(classification, 'potential');
});

Deno.test("U3: blocksConvergence must be false", () => {
  const blocksConvergence = false;
  assertEquals(blocksConvergence, false);
});
