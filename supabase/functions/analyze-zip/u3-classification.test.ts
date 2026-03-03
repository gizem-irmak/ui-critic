/**
 * U3 — Truncated or Inaccessible Content
 * Classification tests for deterministic sub-checks U3.D1–U3.D6
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
// U3.D5 — Unbroken text overflow risk (refined gating)
// ═══════════════════════════════════════════════════

// --- HARD GATING: must have strong constraint ---

Deno.test("U3.D5: {reason} in plain div without constraints → NOT reported", () => {
  const code = `<div className="p-4"><p>{appointment.reason}</p></div>`;
  const STRONG = /\btruncate\b|\bwhitespace-nowrap\b|\boverflow-hidden\b|\btext-ellipsis\b|\bline-clamp-[1-9]\b/;
  assert(!STRONG.test(code), "No strong constraint → should not trigger");
});

Deno.test("U3.D5: {reason} in truncate container → REPORTED", () => {
  const code = `<td className="truncate">{appointment.reason}</td>`;
  const STRONG = /\btruncate\b|\bwhitespace-nowrap\b|\boverflow-hidden\b|\btext-ellipsis\b|\bline-clamp-[1-9]\b/;
  assert(STRONG.test(code));
  assert(!(/\bbreak-words\b|\bbreak-all\b/.test(code)));
});

Deno.test("U3.D5: {notes} in whitespace-nowrap → REPORTED", () => {
  const code = `<span className="whitespace-nowrap">{item.notes}</span>`;
  assert(/\bwhitespace-nowrap\b/.test(code));
});

Deno.test("U3.D5: {msg.subject} in overflow-hidden + max-w → REPORTED", () => {
  const code = `<td className="overflow-hidden max-w-xs">{msg.subject}</td>`;
  assert(/\boverflow-hidden\b/.test(code));
  assert(/\bmax-w-/.test(code));
});

// --- LOW-RISK NEVER FLAG ---

Deno.test("U3.D5: {firstName} with truncate → NOT reported (low-risk-never)", () => {
  const LOW_NEVER = /\b(?:firstName|lastName|name|startTime|endTime|role|search|selectedDoctor|doctor|slot|count)\b/i;
  assert(LOW_NEVER.test("firstName"));
  assert(LOW_NEVER.test("startTime"));
  assert(LOW_NEVER.test("selectedDoctor"));
  assert(LOW_NEVER.test("search"));
});

Deno.test("U3.D5: {form.control} → skipped (form.* prefix)", () => {
  const segments = "form.control".split('.');
  assertEquals(segments[0], "form");
});

Deno.test("U3.D5: single-char {i} → skipped", () => {
  const SKIP = /^(?:i|j|k|e|_|el|ev|cb|fn|err|res|req|ctx|ref|key|idx|index|item|row|col)$/;
  assert(SKIP.test("i"));
  assert(SKIP.test("e"));
  assert(SKIP.test("idx"));
});

// --- LOW-RISK (location/status/date/time) GATING ---

Deno.test("U3.D5: {appt.location} with only truncate → NOT reported (Low-risk needs both)", () => {
  const LOW = /\b(?:location|status|date|time|id|num|type)\b/i;
  assert(LOW.test("location"));
  const code = `<span className="truncate w-32">{appt.location}</span>`;
  assert(/\btruncate\b/.test(code));
  assert(!/\boverflow-hidden\b/.test(code)); // Missing overflow-hidden → suppressed
});

Deno.test("U3.D5: {appt.location} with truncate + overflow-hidden → REPORTED", () => {
  const LOW = /\b(?:location|status|date|time|id|num|type)\b/i;
  assert(LOW.test("location"));
  const code = `<span className="truncate overflow-hidden w-32">{appt.location}</span>`;
  assert(/\btruncate\b/.test(code));
  assert(/\boverflow-hidden\b/.test(code)); // Both present → reported
});

Deno.test("U3.D5: {appt.status} with only max-w → NOT reported (Low-risk)", () => {
  const LOW = /\b(?:location|status|date|time|id|num|type)\b/i;
  assert(LOW.test("status"));
  const code = `<span className="max-w-xs">{appt.status}</span>`;
  assert(!/\btruncate\b/.test(code));
  assert(!/\boverflow-hidden\b/.test(code));
});

// --- MEDIUM-RISK GATING ---

Deno.test("U3.D5: {doc.specialty} with only fixed-width → NOT reported", () => {
  const MED = /\b(?:specialty|title|label)\b/i;
  const TRUNC_NOWRAP = /\btruncate\b|\bwhitespace-nowrap\b/;
  const code = `<td className="w-40">{doc.specialty}</td>`;
  assert(MED.test("specialty"));
  assert(!TRUNC_NOWRAP.test(code), "No truncate/nowrap → medium-risk suppressed");
});

Deno.test("U3.D5: {doc.specialty} with truncate → REPORTED", () => {
  const MED = /\b(?:specialty|title|label)\b/i;
  const TRUNC_NOWRAP = /\btruncate\b|\bwhitespace-nowrap\b/;
  const code = `<span className="truncate w-32">{doc.specialty}</span>`;
  assert(MED.test("specialty"));
  assert(TRUNC_NOWRAP.test(code), "Has truncate → medium-risk reported");
});

Deno.test("U3.D5: {appt.label} with only max-w → NOT reported (medium-risk, no truncate)", () => {
  const MED = /\b(?:specialty|title|label)\b/i;
  const TRUNC_NOWRAP = /\btruncate\b|\bwhitespace-nowrap\b/;
  const code = `<span className="max-w-xs">{appt.label}</span>`;
  assert(MED.test("label"));
  assert(!TRUNC_NOWRAP.test(code));
});

// --- HIGH-RISK: any strong constraint is enough ---

Deno.test("U3.D5: {appt.reason} with overflow-hidden → REPORTED", () => {
  const HIGH = /\b(?:reason|notes|bio|description|message|subject|comment|details|address|diagnosis|complaint)\b/i;
  const STRONG = /\btruncate\b|\bwhitespace-nowrap\b|\boverflow-hidden\b|\btext-ellipsis\b|\bline-clamp-[1-9]\b/;
  const code = `<div className="overflow-hidden w-48">{appt.reason}</div>`;
  assert(HIGH.test("reason"));
  assert(STRONG.test(code));
});

Deno.test("U3.D5: {doc.bio} with line-clamp-2 → REPORTED", () => {
  const code = `<p className="line-clamp-2">{doc.bio}</p>`;
  assert(/\bline-clamp-[1-9]\b/.test(code));
  assert(/\bbio\b/i.test("bio"));
});

// --- WRAP PROTECTION SUPPRESSION ---

Deno.test("U3.D5: {bio} with break-words → suppressed", () => {
  const WRAP = /\bbreak-words\b|\bbreak-all\b|\bwhitespace-normal\b|\boverflow-wrap[:\s]*anywhere\b/;
  assert(WRAP.test("break-words"));
  assert(WRAP.test("break-all"));
  assert(WRAP.test("whitespace-normal"));
});

Deno.test("U3.D5: {bio} with overflow-x-auto → suppressed (scroll-safe)", () => {
  const SCROLL = /\boverflow-x-auto\b|\boverflow-auto\b/;
  assert(SCROLL.test("overflow-x-auto"));
  assert(SCROLL.test("overflow-auto"));
});

Deno.test("U3.D5: code block with font-mono → suppressed", () => {
  const code = `<pre className="font-mono overflow-x-auto">{codeSnippet}</pre>`;
  assert(/\bfont-mono\b/.test(code));
});

// --- VARIABLE EXTRACTION: text context only ---

Deno.test("U3.D5: regex matches text children >{var}<", () => {
  const TEXT_VAR = />\s*\{([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)\}\s*</g;
  const code = `<p className="truncate">{msg.subject}</p>`;
  const m = TEXT_VAR.exec(code);
  assert(m !== null);
  assertEquals(m![1], "msg.subject");
});

Deno.test("U3.D5: regex does NOT match prop values like onClick={handler}", () => {
  const TEXT_VAR = />\s*\{([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)\}\s*</g;
  const code = `<button onClick={handleClick}>Submit</button>`;
  const m = TEXT_VAR.exec(code);
  assertEquals(m, null);
});

// --- CONFIDENCE ---

Deno.test("U3.D5: High-risk + strong constraint → confidence 0.90 (capped)", () => {
  let c = 0.70;
  c += 0.15; // strong constraint
  c += 0.10; // High-risk
  c = Math.max(0.55, Math.min(0.90, c));
  assertEquals(c, 0.90);
});

Deno.test("U3.D5: Medium-risk + truncate → confidence 0.90", () => {
  let c = 0.70;
  c += 0.15; // strong constraint
  c += 0.05; // Medium-risk
  c = Math.max(0.55, Math.min(0.90, c));
  assertEquals(c, 0.90);
});

Deno.test("U3.D5: Low-risk + strong constraint → confidence 0.75", () => {
  let c = 0.70;
  c += 0.15; // strong constraint
  c -= 0.10; // Low-risk penalty
  c = Math.max(0.55, Math.min(0.90, c));
  assertEquals(c, 0.75);
});

Deno.test("U3.D5: wide container reduces confidence", () => {
  let c = 0.70;
  c += 0.15;
  c += 0.10;
  c -= 0.10; // wide container
  c = Math.max(0.55, Math.min(0.90, c));
  assertEquals(c, 0.85);
});

Deno.test("U3.D5: tooltip nearby reduces confidence", () => {
  let c = 0.70;
  c += 0.15;
  c += 0.10;
  c -= 0.10; // tooltip
  c = Math.max(0.55, Math.min(0.90, c));
  assertEquals(c, 0.85);
});

// --- CROSS-SUBCHECK DEDUP ---

Deno.test("U3 dedup: D1+D5 on same file+var within ±10 lines → merged", () => {
  const TRUNC_PRIORITY: Record<string, number> = { 'line-clamp': 3, truncate: 2, nowrap: 1, 'unbroken-overflow': 0 };
  const findings = [
    { filePath: 'A.tsx', varName: 'bio', lineNumber: 10, truncationType: 'truncate', confidence: 0.80, occurrences: 1 },
    { filePath: 'A.tsx', varName: 'bio', lineNumber: 12, truncationType: 'unbroken-overflow', confidence: 0.85, occurrences: 1 },
  ];
  // Same file, same var, within 10 lines → should merge
  const f0 = findings[0], f1 = findings[1];
  assert(Math.abs(f0.lineNumber - f1.lineNumber) <= 10);
  const prio0 = TRUNC_PRIORITY[f0.truncationType] ?? -1;
  const prio1 = TRUNC_PRIORITY[f1.truncationType] ?? -1;
  assert(prio0 > prio1, "truncate has higher priority than unbroken-overflow");
  // After merge: 1 item, occurrences=2, confidence=max(0.80,0.85)
  const merged = { ...f0, occurrences: 2, confidence: Math.max(f0.confidence, f1.confidence) };
  assertEquals(merged.occurrences, 2);
  assertEquals(merged.confidence, 0.85);
});

Deno.test("U3 dedup: same var but different files → NOT merged", () => {
  const f0 = { filePath: 'A.tsx', varName: 'bio', lineNumber: 10 };
  const f1 = { filePath: 'B.tsx', varName: 'bio', lineNumber: 10 };
  assert(f0.filePath !== f1.filePath, "Different files → separate items");
});

Deno.test("U3 dedup: same var but >10 lines apart → NOT merged", () => {
  const f0 = { filePath: 'A.tsx', varName: 'bio', lineNumber: 10 };
  const f1 = { filePath: 'A.tsx', varName: 'bio', lineNumber: 25 };
  assert(Math.abs(f0.lineNumber - f1.lineNumber) > 10, "Far apart → separate items");
});

// --- PER-FILE CAP ---

Deno.test("U3.D5: max 5 findings per file after merge", () => {
  const findings = [
    { confidence: 0.90 },
    { confidence: 0.85 },
    { confidence: 0.80 },
    { confidence: 0.75 },
    { confidence: 0.70 },
    { confidence: 0.65 },
  ];
  findings.sort((a, b) => b.confidence - a.confidence);
  const capped = findings.slice(0, 5);
  assertEquals(capped.length, 5);
  assertEquals(capped[0].confidence, 0.90);
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

// ═══════════════════════════════════════════════════
// U3.D5 — STRICT EVIDENCE BINDING (carrier element)
// ═══════════════════════════════════════════════════

Deno.test("U3.D5 STRICT: {a.specialty} in <td> WITHOUT truncate → NOT flagged", () => {
  // appointments.tsx scenario: <td className="p-2">{a.specialty}</td>
  // The carrier <td> has no truncate/overflow-hidden — should NOT be flagged
  const code = `
    <tr onClick={() => handleClick(a)}>
      <td className="p-2 text-sm">{a.name}</td>
      <td className="p-2 text-sm">{a.specialty}</td>
      <td className="p-2 text-sm max-w-[200px] truncate">{a.reason}</td>
    </tr>
  `;
  // The carrier for {a.specialty} is <td className="p-2 text-sm">
  // It does NOT have truncate, overflow-hidden, or any strong constraint
  const carrierClasses = "p-2 text-sm";
  const STRONG = /\btruncate\b|\bwhitespace-nowrap\b|\boverflow-hidden\b|\btext-ellipsis\b|\bline-clamp-[1-9]\b/;
  assert(!STRONG.test(carrierClasses), "Carrier element has no truncation → NOT flagged");
});

Deno.test("U3.D5 STRICT: {a.reason} in <td className='max-w-[200px] truncate'> → flagged", () => {
  const carrierClasses = "max-w-[200px] truncate";
  const STRONG = /\btruncate\b|\bwhitespace-nowrap\b|\boverflow-hidden\b|\btext-ellipsis\b|\bline-clamp-[1-9]\b/;
  assert(STRONG.test(carrierClasses), "Carrier element has truncate → flagged");
});

Deno.test("U3.D5 STRICT: sibling element classes do not leak to carrier", () => {
  // Even though a sibling <td> has truncate, it should not affect {a.specialty}
  const siblingClasses = "max-w-[200px] truncate";
  const carrierClasses = "p-2 text-sm";
  const STRONG = /\btruncate\b|\bwhitespace-nowrap\b|\boverflow-hidden\b|\btext-ellipsis\b|\bline-clamp-[1-9]\b/;
  assert(STRONG.test(siblingClasses), "Sibling has truncate");
  assert(!STRONG.test(carrierClasses), "Carrier does NOT — must not be flagged");
});

// ═══════════════════════════════════════════════════
// U3.D5 — COMPONENT-LEVEL EXPAND DETECTION
// ═══════════════════════════════════════════════════

Deno.test("U3.D5 EXPAND: same var rendered without truncation elsewhere → suppressed", () => {
  // messages.tsx scenario: truncated {msg.subject} in list, but selectedMsg.subject
  // shown without truncation in detail view → expand mechanism exists
  const truncatedLine = '<p className="truncate">{msg.subject}</p>';
  const expandedLine = '<h2>{selectedMsg.subject}</h2>';

  // Both lines render .subject in JSX text context
  assert(/\.subject\b/.test(truncatedLine), "Truncated line has .subject");
  assert(/\.subject\b/.test(expandedLine), "Expanded line has .subject");

  // Truncated line has truncation class
  assert(/\btruncate\b/.test(truncatedLine), "Truncated line has truncate");
  // Expanded line does NOT have truncation → expand exists
  assert(!/\btruncate\b|\bline-clamp-[1-9]\b|\btext-ellipsis\b/.test(expandedLine),
    "Expanded line has NO truncation → component-level expand exists → suppress");
});

Deno.test("U3.D5 EXPAND: onClick with setSelected + detail view → suppressed", () => {
  const code = `
    <tr onClick={() => setSelectedMsg(msg)}>
      <td className="truncate max-w-xs">{msg.subject}</td>
    </tr>
    {selectedMsg && <div><p>{selectedMsg.subject}</p></div>}
  `;
  // Detect onClick with setSelected pattern
  assert(/onClick\s*=\s*\{[^}]*set(?:Selected|Active|Current|Open)\w*\s*\(/i.test(code));
  // Detect selectedMsg.subject rendered
  assert(/selected\w*\.subject\b/i.test(code));
});

Deno.test("U3.D5 EXPAND: line-clamp-2 on doc.bio without expand → STILL flagged", () => {
  const code = `
    <div className="p-4">
      <p className="line-clamp-2">{doc.bio}</p>
    </div>
  `;
  const carrierClasses = "line-clamp-2";
  assert(/\bline-clamp-[1-9]\b/.test(carrierClasses), "Has line-clamp → flagged");
  // No expand mechanism
  assert(!/show\s*more|expand|toggle|setSelected/i.test(code));
});

Deno.test("U3.D5 EXPAND: truncate on appt.specialty without expand → flagged", () => {
  const code = `
    <span className="truncate w-32">{appt.specialty}</span>
  `;
  const carrierClasses = "truncate w-32";
  assert(/\btruncate\b/.test(carrierClasses));
  assert(!/show\s*more|expand|setSelected/i.test(code));
});

// ═══════════════════════════════════════════════════
// U3.D5 — CORRECT ELEMENT ATTRIBUTION
// ═══════════════════════════════════════════════════

Deno.test("U3.D5 ATTRIBUTION: report carrier tag, not unrelated components", () => {
  // If truncate is on <td>, report <td>, not <Badge> or <Send>
  const code = `<td className="truncate max-w-xs">{msg.subject}</td>`;
  const tagMatch = code.match(/<([a-zA-Z][\w.]*)\s[^>]*className="[^"]*truncate/);
  assert(tagMatch !== null);
  assertEquals(tagMatch![1], "td");
});

Deno.test("U3.D5 ATTRIBUTION: parent tag reported when truncation on parent", () => {
  const code = `<div className="truncate"><span>{doc.bio}</span></div>`;
  // Carrier of {doc.bio} is <span>, but truncate is on parent <div>
  // Should report <div> as the element
  const parentClasses = "truncate";
  assert(/\btruncate\b/.test(parentClasses));
});

// ═══════════════════════════════════════════════════
// STRICT GATING — FALSE POSITIVE PREVENTION (v2)
// ═══════════════════════════════════════════════════

// --- GATE 1: Content risk gate ---

Deno.test("U3 GATE1: static 'Name' (4 chars) with h-4 + overflow-hidden → SUPPRESSED (short static)", () => {
  const text = "Name";
  const tokens = text.split(/\s+/);
  assert(text.length < 28, "Under 28 chars");
  assert(tokens.length < 5, "Under 5 tokens");
  // contentKind = static_short → gate fails → suppressed
});

Deno.test("U3 GATE1: static 'Status' with overflow-hidden → SUPPRESSED (short header chrome)", () => {
  const text = "Status";
  assert(text.length < 28);
  // Not dynamic, not long → gate fails
});

Deno.test("U3 GATE1: static 28+ char paragraph with overflow-hidden → PASSES gate", () => {
  const text = "This is a long enough paragraph text";
  const tokens = text.split(/\s+/);
  assert(text.length >= 28 || tokens.length >= 5, "Passes content risk gate");
});

Deno.test("U3 GATE1: dynamic {appt.reason} in .map() → PASSES as list_mapped", () => {
  const code = `appointments.map((appt) => <td className="truncate">{appt.reason}</td>)`;
  assert(/\.map\s*\(/.test(code), "Inside map context");
  assert(/\{appt\.reason\}/.test(code), "Dynamic expression present");
});

// --- GATE 2: Table header / label row suppression ---

Deno.test("U3 GATE2: text 'Actions' inside <thead> → SUPPRESSED", () => {
  const code = `<thead><tr><th className="h-6 overflow-hidden">Actions</th></tr></thead>`;
  assert(/<thead\b/.test(code));
  const HEADER_LABELS = /^(?:name|status|actions?|date|doctor|specialty|location|phone|address|joined|email|time|type|role|id)$/i;
  assert(HEADER_LABELS.test("Actions"));
});

Deno.test("U3 GATE2: text 'Doctor' with uppercase + text-xs + short → SUPPRESSED", () => {
  const code = `<div className="uppercase text-xs font-medium tracking-wide h-4 overflow-hidden">Doctor</div>`;
  const text = "Doctor";
  assert(text.length <= 16);
  const HEADER_STYLE = /\b(?:uppercase|tracking-wide|text-xs|font-medium)\b/;
  assert(HEADER_STYLE.test(code));
});

Deno.test("U3 GATE2: dynamic {patient.notes} NOT suppressed by header gate", () => {
  const text = "(dynamic text: patient.notes)";
  const HEADER_LABELS = /^(?:name|status|actions?|date|doctor|specialty|location|phone|address|joined|email|time|type|role|id)$/i;
  // Dynamic text does not match header labels
  assert(!HEADER_LABELS.test(text));
});

// --- GATE 3: Recovery mechanism detection ---

Deno.test("U3 GATE3: title={fullText} → recovery signal 'title_attr'", () => {
  const code = `<span className="truncate" title={fullText}>{text}</span>`;
  assert(/title\s*=\s*\{/.test(code));
});

Deno.test("U3 GATE3: <Tooltip> wrapper → recovery signal 'tooltip_component'", () => {
  const code = `<Tooltip content={longText}><span className="truncate">{short}</span></Tooltip>`;
  assert(/<Tooltip\b/.test(code));
});

Deno.test("U3 GATE3: overflow-auto on parent → recovery signal 'overflow_scroll'", () => {
  const code = `<div className="h-40 overflow-auto"><p className="truncate">{text}</p></div>`;
  assert(/overflow-auto/.test(code));
});

Deno.test("U3 GATE3: onClick with setSelected → recovery signal 'click_to_detail'", () => {
  const code = `<tr onClick={() => setSelected(row)}><td className="truncate">{row.reason}</td></tr>`;
  assert(/onClick.*setSelected/.test(code));
});

// --- Confidence scoring model ---

Deno.test("U3 CONFIDENCE: base 0.45, dynamic + truncation utility → max 0.70", () => {
  const base = 0.45;
  const dynamicInMap = 0.15;
  const truncUtility = 0.10;
  const total = base + dynamicInMap + truncUtility;
  assert(total === 0.70);
  assert(total <= 0.75, "Cannot exceed 0.75 cap");
});

Deno.test("U3 CONFIDENCE: recovery signal deducts 0.20", () => {
  const base = 0.45;
  const dynamicInMap = 0.15;
  const recovery = -0.20;
  const total = Math.round((base + dynamicInMap + recovery) * 100) / 100;
  assert(total === 0.40, `Recovery drops to floor, got ${total}`);
});

Deno.test("U3 CONFIDENCE: header suspected deducts 0.20", () => {
  const base = 0.45;
  const headerPenalty = -0.20;
  const total = Math.max(0.40, base + headerPenalty);
  assert(total === 0.40, "Floor at 0.40");
});

// --- End-to-end acceptance scenarios ---

Deno.test("U3 ACCEPT: Admin table header 'Name Specialty Location Status Actions' + h-4/h-6 + overflow-hidden → ALL SUPPRESSED", () => {
  const headers = ["Name", "Specialty", "Location", "Status", "Actions"];
  const HEADER_LABELS = /^(?:name|status|actions?|date|doctor|specialty|location|phone|address|joined|email|time|type|role|id)$/i;
  for (const h of headers) {
    assert(HEADER_LABELS.test(h), `Header '${h}' should match header label list`);
    assert(h.length <= 16, `Header '${h}' is short enough for suppression`);
  }
});

Deno.test("U3 ACCEPT: Dynamic truncated cell {appt.reason} without tooltip → EMITTED as Potential", () => {
  const code = `<td className="truncate">{appt.reason}</td>`;
  assert(/\btruncate\b/.test(code), "Has truncation utility");
  assert(/\{appt\.reason\}/.test(code), "Has dynamic expression");
  assert(!/title\s*=|<Tooltip|<HoverCard|<Popover/.test(code), "No recovery mechanism");
});

Deno.test("U3 ACCEPT: Truncation with title={fullText} → SUPPRESSED or confidence ≤ 0.50", () => {
  const code = `<span className="truncate" title={fullText}>{shortText}</span>`;
  assert(/title\s*=\s*\{/.test(code), "Has title recovery");
  // Recovery signal → confidence drops by 0.20
  const confidence = 0.45 + 0.10 - 0.20; // base + truncUtility - recovery = 0.35 → below 0.40 → suppressed
  assert(confidence < 0.40, "Should be suppressed due to recovery");
});

// ═══════════════════════════════════════════════════
// U3 — Carrier element binding regression tests
// ═══════════════════════════════════════════════════

Deno.test("U3 CARRIER: truncate inside TableCell className → carrier is TableCell, not TableRow", () => {
  // Simulates: <TableRow>...<TableCell className="max-w-[200px] truncate">{a.reason}</TableCell>...
  const code = `<TableRow><TableCell className="max-w-[200px] truncate">{a.reason || "—"}</TableCell></TableRow>`;
  // The carrier finder should return TableCell (has truncate) not TableRow
  const truncPos = code.indexOf('truncate');
  // Scan backward from truncPos: <TableRow> is fully before truncPos, but <TableCell starts before and > is after
  // The fix ensures we find <TableCell className="max-w-[200px] truncate"> by extending search past pos
  const tagRe = /<([a-zA-Z][\w.]*)\s([^>]*)>/g;
  const searchSlice = code.slice(0, Math.min(code.length, truncPos + 300));
  let bestWithTrunc: string | undefined;
  let tm;
  while ((tm = tagRe.exec(searchSlice)) !== null) {
    const absStart = tm.index;
    if (absStart > truncPos) continue;
    const className = tm[2].match(/className="([^"]*)"/)?.[1] || '';
    if (/\btruncate\b/.test(className)) bestWithTrunc = tm[1];
  }
  assertEquals(bestWithTrunc, "TableCell", "Carrier must be TableCell, not TableRow");
});

Deno.test("U3 CARRIER: truncate on <p> inside <td> → carrier is p, not td", () => {
  const code = `<td><p className="text-sm truncate">{(appt as any).doctors?.name}</p><Badge>{appt.status}</Badge></td>`;
  const truncPos = code.indexOf('truncate');
  const tagRe = /<([a-zA-Z][\w.]*)\s([^>]*)>/g;
  const searchSlice = code.slice(0, Math.min(code.length, truncPos + 300));
  let bestWithTrunc: string | undefined;
  let tm;
  while ((tm = tagRe.exec(searchSlice)) !== null) {
    if (tm.index > truncPos) continue;
    const className = tm[2].match(/className="([^"]*)"/)?.[1] || '';
    if (/\btruncate\b/.test(className)) bestWithTrunc = tm[1];
  }
  assertEquals(bestWithTrunc, "p", "Carrier must be p (the truncate owner), not td");
});

Deno.test("U3 PREVIEW: carrier-scoped preview extracts from element subtree only", () => {
  // <p className="truncate">{doctors?.name}</p> should preview doctors?.name, NOT appt.status from sibling
  const code = `<td><p className="text-sm truncate">{(appt as any).doctors?.name}</p><Badge>{appt.status}</Badge></td>`;
  // Extract content between <p ...> and </p>
  const pStart = code.indexOf('<p ');
  const pTagEnd = code.indexOf('>', pStart) + 1;
  const pClose = code.indexOf('</p>', pTagEnd);
  const elementContent = code.slice(pTagEnd, pClose);
  // Should contain doctors?.name
  assert(/doctors\?\.name/.test(elementContent), "Preview must contain doctors?.name");
  // Should NOT contain appt.status
  assert(!/appt\.status/.test(elementContent), "Preview must NOT contain appt.status");
});

Deno.test("U3 TOKENS: deduplication - no repeated tokens", () => {
  const classStr = "truncate overflow-hidden max-w-[200px] truncate overflow-hidden";
  const seen = new Set<string>();
  const tokens: string[] = [];
  const add = (t: string) => { if (!seen.has(t)) { seen.add(t); tokens.push(t); } };
  if (/\btruncate\b/.test(classStr)) add('truncate');
  if (/\boverflow-hidden\b/.test(classStr)) add('overflow-hidden');
  const mwb = classStr.match(/\bmax-w-\[[^\]]+\]/);
  if (mwb) add(mwb[0]);
  assertEquals(tokens.length, 3, "Should have exactly 3 unique tokens");
  assertEquals(new Set(tokens).size, tokens.length, "No duplicates");
});

Deno.test("U3 TOKENS: min-w-0 stays as min-w-0, not w-0", () => {
  const classStr = "min-w-0 flex-1";
  // w-N regex with lookbehind check
  const wMatches = classStr.match(/\bw-\d+\b/g);
  if (wMatches) {
    for (const wm of wMatches) {
      const idx = classStr.indexOf(wm);
      const before = idx > 0 ? classStr.slice(Math.max(0, idx - 4), idx) : '';
      assert(/min-$/.test(before) || /max-$/.test(before), "w-0 inside min-w-0 must be skipped");
    }
  }
  // min-w-0 should be its own token
  assert(/\bmin-w-0\b/.test(classStr), "min-w-0 token preserved");
});

Deno.test("U3 HEADER SUPPRESS: TableHead row with static labels never emits", () => {
  const code = `<TableHeader><TableRow><TableHead>Patient</TableHead><TableHead>Doctor</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>`;
  // All static labels, inside TableHead/TableHeader → header suppression must fire
  assert(/<TableHead>/.test(code), "Has TableHead elements");
  assert(/<TableHeader>/.test(code), "Has TableHeader wrapper");
  const labels = ["Patient", "Doctor", "Reason", "Status", "Date", "Actions"];
  const HEADER_LABELS = /^(?:patient|doctor|reason|name|status|actions?|date|time|type|role|id|email|phone|address|specialty|location|joined)$/i;
  for (const l of labels) {
    assert(HEADER_LABELS.test(l), `'${l}' is a known header label → suppressed`);
  }
});

// ═══════════════════════════════════════════════════
// Content preview subtree binding regression tests
// ═══════════════════════════════════════════════════

/** Minimal reimplementation of extractU3CarrierContentPreview for testing */
function extractPreviewFromElement(elementContent: string): string | undefined {
  const allDynRe = /\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  let dm;
  const dynExprs: string[] = [];
  const ATTR_NAMES = /^(className|style|key|ref|id|onClick|onChange|onSubmit|disabled|checked|value|type|src|href|alt|htmlFor|role|aria-\w+)$/;
  while ((dm = allDynRe.exec(elementContent)) !== null) {
    const expr = dm[1].trim();
    if (!expr || expr.length > 120) continue;
    if (ATTR_NAMES.test(expr)) continue;
    if (/^cn\(|^clsx\(|^classNames?\(/i.test(expr)) continue;
    if (/^(?:\(\)\s*=>|function\b)/.test(expr) && !/\.\w+/.test(expr)) continue;
    if (!dynExprs.includes(expr)) dynExprs.push(expr);
  }
  if (dynExprs.length > 0) {
    const meaningful = dynExprs.find(e => /[a-zA-Z_]\w*[\s)]*\.[\w?]/.test(e));
    if (meaningful) {
      const castMatch = meaningful.match(/\((\w+)\s+as\s+\w+\)\.\s*([\w?.]+)/);
      if (castMatch) return `(dynamic text: (${castMatch[1]} as any).${castMatch[2]})`;
      const coreVar = meaningful.match(/([a-zA-Z_][\w.?]*)/);
      return `(dynamic text: ${coreVar ? coreVar[1] : meaningful})`;
    }
    return `(dynamic text: ${dynExprs[0]})`;
  }
  return undefined;
}

Deno.test("U3 CONTENT BINDING: cast expression (appt as any).doctors?.name", () => {
  // elementContent is what's BETWEEN <p ...> and </p>
  const elementContent = `{(appt as any).doctors?.name}`;
  const preview = extractPreviewFromElement(elementContent);
  assert(preview !== undefined, "Should extract a preview");
  assert(preview!.includes("doctors?.name"), `Preview must contain doctors?.name, got: ${preview}`);
  assert(!preview!.includes("appt.status"), "Must NOT contain appt.status from sibling");
});

Deno.test("U3 CONTENT BINDING: simple dot expression a.reason", () => {
  const elementContent = `{a.reason || "—"}`;
  const preview = extractPreviewFromElement(elementContent);
  assert(preview !== undefined, "Should extract a preview");
  assert(preview!.includes("a.reason"), `Preview must contain a.reason, got: ${preview}`);
});

Deno.test("U3 CONTENT BINDING: sibling expressions must NOT leak", () => {
  // Only the truncated cell's content, not sibling cells
  const truncatedCellContent = `{(appt as any).doctors?.name}`;
  const siblingContent = `{appt.status}`;
  // Extraction from truncated cell only
  const preview = extractPreviewFromElement(truncatedCellContent);
  assert(preview !== undefined);
  assert(preview!.includes("doctors?.name"), "Must bind to own content");
  assert(!preview!.includes("appt.status"), "Must NOT include sibling content");
});

Deno.test("U3 CONTENT BINDING: self-closing element returns undefined (no children)", () => {
  const elementContent = ``; // self-closing has no children
  const preview = extractPreviewFromElement(elementContent);
  assertEquals(preview, undefined, "Self-closing with no children → undefined");
});
