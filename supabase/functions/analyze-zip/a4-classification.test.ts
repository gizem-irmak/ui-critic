import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

/**
 * A4 Missing Semantic Structure — Refined Classification Tests
 *
 * Validates:
 * - A4.1: missing_h1 (Potential), skipped_levels (Potential), visual_heading_missing_semantics (Confirmed)
 * - A4.2: Only fires when keyboard support present but role missing (avoids A3 overlap)
 * - A4.3: Missing main landmark (Potential)
 * - A4.4: Tightened list heuristic — requires list-like intent, not just className repetition
 */

interface A4Finding {
  elementLabel: string;
  elementType: string;
  subCheck: 'A4.1' | 'A4.2' | 'A4.3' | 'A4.4';
  subCheckLabel: string;
  classification: 'confirmed' | 'potential';
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  correctivePrompt?: string;
  deduplicationKey: string;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

// Inline extractJsxOpeningTags (same logic as index.ts)
function extractJsxOpeningTags(content: string, tagPattern: string): Array<{tag: string; attrs: string; index: number; fullMatch: string}> {
  const results: Array<{tag: string; attrs: string; index: number; fullMatch: string}> = [];
  const openRegex = new RegExp(`<(${tagPattern})\\b`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = openRegex.exec(content)) !== null) {
    const startIdx = m.index;
    let i = startIdx + m[0].length;
    let depth = 0;
    let inString: string | null = null;
    let inTemplateLiteral = false;
    let found = false;
    while (i < content.length) {
      const ch = content[i];
      if (inString) { if (ch === inString && content[i - 1] !== '\\') inString = null; i++; continue; }
      if (inTemplateLiteral) { if (ch === '`' && content[i - 1] !== '\\') inTemplateLiteral = false; i++; continue; }
      if (ch === '"' || ch === "'") { inString = ch; i++; continue; }
      if (ch === '`') { inTemplateLiteral = true; i++; continue; }
      if (ch === '{') { depth++; i++; continue; }
      if (ch === '}') { depth--; i++; continue; }
      if (depth === 0 && ch === '>') {
        const fullMatch = content.slice(startIdx, i + 1);
        const attrs = content.slice(startIdx + m[0].length, i);
        results.push({ tag: m[1], attrs, index: startIdx, fullMatch });
        found = true; break;
      }
      if (depth === 0 && ch === '/' && i + 1 < content.length && content[i + 1] === '>') {
        const fullMatch = content.slice(startIdx, i + 2);
        const attrs = content.slice(startIdx + m[0].length, i);
        results.push({ tag: m[1], attrs, index: startIdx, fullMatch });
        found = true; break;
      }
      i++;
    }
    if (!found) continue;
  }
  return results;
}

/**
 * Minimal A4 detection mirroring refined edge function logic.
 */
function detectA4(allFiles: Map<string, string>): A4Finding[] {
  const findings: A4Finding[] = [];
  const seenKeys = new Set<string>();

  let hasH1 = false;
  let hasMainLandmark = false;
  const headingLevelsUsed = new Set<number>();
  const headingIssues: A4Finding[] = [];
  const visualHeadingIssues: A4Finding[] = [];
  const clickableNonSemantics: A4Finding[] = [];
  const landmarkIssues: A4Finding[] = [];
  const listIssues: A4Finding[] = [];

  const NON_INTERACTIVE_TAGS = 'div|span|p|li|section|article|header|footer|main|aside|nav|figure|figcaption|dd|dt|dl';
  const POINTER_HANDLER_RE = /\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/;
  const HTML_CLICK_HANDLER_RE = /\b(onclick|onmousedown|onmouseup|onkeydown)\s*=/i;
  const INTERACTIVE_ROLES = /\brole\s*=\s*["'](button|link|menuitem|tab|option|checkbox|radio|switch|combobox|listbox|slider|treeitem|gridcell)["']/i;
  const KEY_HANDLER_RE = /\b(onKeyDown|onKeyUp|onKeyPress)\s*=/;
  const TABINDEX_GTE0_RE = /tabIndex\s*=\s*\{?\s*(?:0|[1-9])\s*\}?/i;
  const LARGE_FONT_RE = /\b(?:text-(?:xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)|text-lg)\b/;
  const BOLD_RE = /\b(?:font-bold|font-semibold|font-extrabold|font-black)\b/;
  const LIST_INTENT_RE = /^(?:\s*[•\-\*\d]+[\.\)]\s|\s*(?:item|card|entry|row|record)\b)/i;

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);

    // A4.1: Heading semantics
    if (/<h1\b/gi.test(content)) hasH1 = true;
    for (let i = 1; i <= 6; i++) {
      if (new RegExp(`<h${i}\\b`, 'i').test(content)) headingLevelsUsed.add(i);
    }

    // A4.1: Visual heading heuristic
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
      const dedupeKey = `A4.1|visual-heading|${filePath}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      visualHeadingIssues.push({
        elementLabel: `Visual heading: "${text.substring(0, 40)}"`, elementType: tag,
        subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
        classification: 'confirmed',
        detection: `visual_heading_missing_semantics: <${tag}> with large font + bold but no heading`,
        evidence: `<${tag} className="${cls.substring(0, 60)}"> at ${filePath}:${lineNumber}`,
        explanation: `Visual heading without semantic markup.`,
        confidence: 0.92,
        deduplicationKey: dedupeKey,
      });
    }

    // A4.2: Interactive semantics — only if keyboard support exists but role missing
    const a4Tags = extractJsxOpeningTags(content, NON_INTERACTIVE_TAGS);
    for (const { tag, attrs, index } of a4Tags) {
      if (!POINTER_HANDLER_RE.test(attrs) && !HTML_CLICK_HANDLER_RE.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      if (INTERACTIVE_ROLES.test(attrs)) continue;

      const hasKeyHandler = KEY_HANDLER_RE.test(attrs);
      const hasTabIndex = TABINDEX_GTE0_RE.test(attrs);
      // Suppress if keyboard support missing → A3-C1 territory
      if (!hasKeyHandler || !hasTabIndex) continue;

      const lineNumber = content.slice(0, index).split('\n').length;
      const dedupeKey = `A4.2|${filePath}|${tag}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      clickableNonSemantics.push({
        elementLabel: `Clickable <${tag}>`, elementType: tag,
        subCheck: 'A4.2', subCheckLabel: 'Interactive semantics',
        classification: 'confirmed',
        detection: `onClick on <${tag}> with keyboard support but missing semantic role`,
        evidence: `<${tag} onClick=... tabIndex onKeyDown=...> at ${filePath}:${lineNumber}`,
        explanation: `Has keyboard support but no semantic role.`,
        confidence: 0.93,
        deduplicationKey: dedupeKey,
      });
    }

    // A4.3: Landmark detection
    if (/<main\b/i.test(content) || /role\s*=\s*["']main["']/i.test(content)) hasMainLandmark = true;

    // A4.4: Lists — tightened heuristic
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
        elementLabel: `Repeated items (${count}x)`, elementType: 'div',
        subCheck: 'A4.4', subCheckLabel: 'List semantics',
        classification: 'potential',
        detection: `${count} elements with list-like intent, no <ul>/<ol>`,
        evidence: `Repeated class: "${cls.substring(0, 60)}"`,
        explanation: `List-like content without semantic list structure.`,
        confidence: 0.82,
        deduplicationKey: listDedupeKey,
      });
    }
  }

  // Post-scan: missing h1 → Potential
  if (!hasH1 && headingLevelsUsed.size > 0) {
    headingIssues.push({
      elementLabel: 'Missing <h1>', elementType: 'h1',
      subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
      classification: 'potential',
      detection: 'missing_h1: No <h1> found in any source file',
      evidence: `Heading levels: ${Array.from(headingLevelsUsed).sort().map(l => `h${l}`).join(', ')} — no h1`,
      explanation: 'No <h1> heading found.',
      confidence: 0.72,
      deduplicationKey: 'A4.1|no-h1',
    });
  }

  const sortedLevels = Array.from(headingLevelsUsed).sort();
  for (let i = 1; i < sortedLevels.length; i++) {
    if (sortedLevels[i] - sortedLevels[i - 1] > 1) {
      headingIssues.push({
        elementLabel: `Heading skip (h${sortedLevels[i - 1]} → h${sortedLevels[i]})`,
        elementType: `h${sortedLevels[i]}`,
        subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
        classification: 'potential',
        detection: `skipped_levels: Heading skips h${sortedLevels[i - 1]} to h${sortedLevels[i]}`,
        evidence: `Levels: ${sortedLevels.map(l => `h${l}`).join(', ')}`,
        explanation: `Heading level skip.`,
        confidence: 0.78,
        deduplicationKey: `A4.1|skip-h${sortedLevels[i - 1]}-h${sortedLevels[i]}`,
      });
      break;
    }
  }

  if (!hasMainLandmark) {
    landmarkIssues.push({
      elementLabel: 'Missing <main> landmark', elementType: 'main',
      subCheck: 'A4.3', subCheckLabel: 'Landmark regions',
      classification: 'potential',
      detection: 'No <main> or role="main" found',
      evidence: 'No main landmark detected',
      explanation: 'No <main> landmark found.',
      confidence: 0.75,
      deduplicationKey: 'A4.3|no-main',
    });
  }

  findings.push(...headingIssues, ...visualHeadingIssues, ...clickableNonSemantics, ...landmarkIssues, ...listIssues);
  return findings;
}

// ============================================================
// TESTS
// ============================================================

Deno.test("A4.1: Missing <h1> → Potential (not Confirmed)", () => {
  const files = new Map([["src/page.tsx", "<h2>Subtitle</h2><h3>Section</h3>"]]);
  const results = detectA4(files);
  const h1Finding = results.find(f => f.subCheck === 'A4.1' && f.detection.includes('missing_h1'));
  assertEquals(!!h1Finding, true, "Should find missing h1");
  assertEquals(h1Finding!.classification, 'potential', "Missing h1 should be Potential");
  assertEquals(h1Finding!.confidence <= 0.80, true, "Confidence should be moderate");
});

Deno.test("A4.1: Skipped heading levels → Potential", () => {
  const files = new Map([["src/page.tsx", "<h1>Title</h1><h3>Skipped</h3>"]]);
  const results = detectA4(files);
  const skipFinding = results.find(f => f.subCheck === 'A4.1' && f.detection.includes('skipped_levels'));
  assertEquals(!!skipFinding, true, "Should find heading skip");
  assertEquals(skipFinding!.classification, 'potential');
});

Deno.test("A4.1: Visual heading (large font+bold div) → Confirmed", () => {
  const files = new Map([["src/page.tsx", '<div className="text-2xl font-bold">Dashboard Overview</div>']]);
  const results = detectA4(files);
  const visual = results.find(f => f.subCheck === 'A4.1' && f.detection.includes('visual_heading'));
  assertEquals(!!visual, true, "Should detect visual heading");
  assertEquals(visual!.classification, 'confirmed');
  assertEquals(visual!.confidence >= 0.90, true);
});

Deno.test("A4.1: Visual heading with role='heading' → NOT flagged", () => {
  const files = new Map([["src/page.tsx", '<div role="heading" aria-level="2" className="text-2xl font-bold">Dashboard</div>']]);
  const results = detectA4(files);
  const visual = results.find(f => f.subCheck === 'A4.1' && f.detection.includes('visual_heading'));
  assertEquals(!!visual, false, "Should NOT flag with role=heading");
});

Deno.test("A4.2: div with onClick but NO keyboard support → NOT flagged (A3-C1 territory)", () => {
  const files = new Map([["src/comp.tsx", '<div onClick={handleClick}>Click me</div>']]);
  const results = detectA4(files);
  const a42 = results.find(f => f.subCheck === 'A4.2');
  assertEquals(!!a42, false, "Should NOT flag — missing keyboard support belongs to A3");
});

Deno.test("A4.2: div with onClick + tabIndex + onKeyDown but NO role → Confirmed", () => {
  const files = new Map([["src/comp.tsx", '<div onClick={handleClick} tabIndex={0} onKeyDown={handleKey}>Click me</div>']]);
  const results = detectA4(files);
  const a42 = results.find(f => f.subCheck === 'A4.2');
  assertEquals(!!a42, true, "Should detect: keyboard present but role missing");
  assertEquals(a42!.classification, 'confirmed');
});

Deno.test("A4.2: div with onClick + tabIndex + onKeyDown + role='button' → NOT flagged", () => {
  const files = new Map([["src/comp.tsx", '<div role="button" onClick={handleClick} tabIndex={0} onKeyDown={handleKey}>Click me</div>']]);
  const results = detectA4(files);
  const a42 = results.find(f => f.subCheck === 'A4.2');
  assertEquals(!!a42, false, "Should NOT flag — fully accessible");
});

Deno.test("A4.2: multiline JSX with keyboard support but no role → Confirmed", () => {
  const content = `<div
    onClick={() => handleClick()}
    tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter') handleClick(); }}
    className="card"
  >Click me</div>`;
  const files = new Map([["src/comp.tsx", content]]);
  const results = detectA4(files);
  const a42 = results.find(f => f.subCheck === 'A4.2');
  assertEquals(!!a42, true, "Should detect multiline JSX A4.2");
  assertEquals(a42!.classification, 'confirmed');
});

Deno.test("A4.3: No <main> landmark → Potential", () => {
  const files = new Map([["src/app.tsx", "<div><h1>Title</h1><p>Content</p></div>"]]);
  const results = detectA4(files);
  const a43 = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!a43, true, "Should detect missing main");
  assertEquals(a43!.classification, 'potential');
});

Deno.test("A4.3: Has <main> → NOT flagged", () => {
  const files = new Map([["src/app.tsx", "<main><h1>Title</h1></main>"]]);
  const results = detectA4(files);
  const a43 = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!a43, false);
});

Deno.test("A4.4: Repeated Tailwind-only className → NOT flagged (no list intent)", () => {
  const repeated = `
    <div className="p-4 rounded-lg border">Section A</div>
    <div className="p-4 rounded-lg border">Section B</div>
    <div className="p-4 rounded-lg border">Section C</div>
  `;
  const files = new Map([["src/list.tsx", repeated]]);
  const results = detectA4(files);
  const a44 = results.find(f => f.subCheck === 'A4.4');
  assertEquals(!!a44, false, "Should NOT flag pure Tailwind utility repetition without list intent");
});

Deno.test("A4.4: Repeated items with 'card-item' class → Potential (has list intent)", () => {
  const repeated = `
    <div className="card-item p-4 rounded">Item 1</div>
    <div className="card-item p-4 rounded">Item 2</div>
    <div className="card-item p-4 rounded">Item 3</div>
  `;
  const files = new Map([["src/list.tsx", repeated]]);
  const results = detectA4(files);
  const a44 = results.find(f => f.subCheck === 'A4.4');
  assertEquals(!!a44, true, "Should detect list-intent divs");
  assertEquals(a44!.classification, 'potential', "A4.4 should always be Potential");
});

Deno.test("A4.4: Repeated divs WITH <ul> → NOT flagged", () => {
  const content = `
    <ul>
      <div className="card-item p-4 rounded">Item 1</div>
      <div className="card-item p-4 rounded">Item 2</div>
      <div className="card-item p-4 rounded">Item 3</div>
    </ul>
  `;
  const files = new Map([["src/list.tsx", content]]);
  const results = detectA4(files);
  const a44 = results.find(f => f.subCheck === 'A4.4');
  assertEquals(!!a44, false, "Should NOT flag when <ul> exists");
});

Deno.test("A4: Detection includes trigger type in detection field", () => {
  const files = new Map([["src/page.tsx", "<h2>No h1</h2>"]]);
  const results = detectA4(files);
  const h1 = results.find(f => f.detection.includes('missing_h1'));
  assertEquals(!!h1, true, "Detection should include trigger type");
});
