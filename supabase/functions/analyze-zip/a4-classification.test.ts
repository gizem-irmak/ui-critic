import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

/**
 * A4 Missing Semantic Structure — Sub-check Classification Tests
 *
 * Extracts the A4 detection logic to validate that each sub-check
 * produces correct subCheck ID, subCheckLabel, severity, and confidence.
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

/**
 * Minimal A4 detection function mirroring the edge function logic.
 */
function detectA4(allFiles: Map<string, string>): A4Finding[] {
  const findings: A4Finding[] = [];
  const seenKeys = new Set<string>();

  let hasH1 = false;
  let hasMainLandmark = false;
  const headingLevelsUsed = new Set<number>();
  const clickableNonSemantics: A4Finding[] = [];
  const headingIssues: A4Finding[] = [];
  const landmarkIssues: A4Finding[] = [];
  const listIssues: A4Finding[] = [];

  const NON_INTERACTIVE_TAGS = 'div|span|p|li|section|article|header|footer|main|aside|nav|figure|figcaption|dd|dt|dl';
  const CLICK_HANDLER_RE = /\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/;
  const HTML_CLICK_HANDLER_RE = /\b(onclick|onmousedown|onmouseup|onkeydown)\s*=/i;
  const INTERACTIVE_ROLES = /\brole\s*=\s*["'](button|link|menuitem|tab|option|checkbox|radio|switch|combobox|listbox|slider|treeitem|gridcell)["']/i;

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);

    // A4.1: Heading semantics
    if (/<h1\b/gi.test(content)) hasH1 = true;
    for (let i = 1; i <= 6; i++) {
      if (new RegExp(`<h${i}\\b`, 'i').test(content)) headingLevelsUsed.add(i);
    }

    // A4.2: Interactive elements
    const tagRegex = new RegExp(`<(${NON_INTERACTIVE_TAGS})\\b([^>]*)>`, 'gi');
    let match;
    while ((match = tagRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (!CLICK_HANDLER_RE.test(attrs) && !HTML_CLICK_HANDLER_RE.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      if (INTERACTIVE_ROLES.test(attrs)) continue;

      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const handlerMatch = attrs.match(/\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/) || attrs.match(/\b(onclick|onmousedown|onmouseup|onkeydown)\s*=/i);
      const triggerHandler = handlerMatch?.[1] || 'onClick';

      const dedupeKey = `A4.2|${filePath}|${tag}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      clickableNonSemantics.push({
        elementLabel: `Clickable <${tag}>`, elementType: tag,
        subCheck: 'A4.2', subCheckLabel: 'Interactive semantics',
        classification: 'confirmed',
        detection: `${triggerHandler} on non-semantic <${tag}> without ARIA role`,
        evidence: `<${tag} ${triggerHandler}=...> at ${filePath}:${lineNumber}`,
        explanation: `Clickable <${tag}> with ${triggerHandler} but no semantic role.`,
        confidence: 0.95,
        correctivePrompt: `Replace clickable <${tag}> with <button> or add role="button", tabIndex="0".`,
        deduplicationKey: dedupeKey,
      });
    }

    // A4.3: Landmark detection
    if (/<main\b/i.test(content) || /role\s*=\s*["']main["']/i.test(content)) hasMainLandmark = true;

    // A4.4: Lists — repeated siblings
    const repeatedClassPattern = /className\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`})/g;
    const classCounts = new Map<string, number>();
    let classMatch;
    while ((classMatch = repeatedClassPattern.exec(content)) !== null) {
      const cls = classMatch[1] || classMatch[2] || classMatch[3] || '';
      if (cls.length > 10 && cls.length < 200) {
        classCounts.set(cls, (classCounts.get(cls) || 0) + 1);
      }
    }
    for (const [cls, count] of classCounts) {
      if (count >= 3) {
        const hasSemanticList = /<(?:ul|ol)\b/i.test(content) || /role\s*=\s*["']list["']/i.test(content);
        if (!hasSemanticList) {
          const listDedupeKey = `A4.4|${filePath}|${cls.substring(0, 30)}`;
          if (!seenKeys.has(listDedupeKey)) {
            seenKeys.add(listDedupeKey);
            listIssues.push({
              elementLabel: `Repeated items (${count}x)`, elementType: 'div',
              subCheck: 'A4.4', subCheckLabel: 'List semantics',
              classification: 'potential',
              detection: `${count} sibling elements with identical className, no <ul>/<ol> wrapper`,
              evidence: `Repeated class: "${cls.substring(0, 60)}"`,
              explanation: `${count} elements with same class but no semantic list structure.`,
              confidence: 0.88,
              deduplicationKey: listDedupeKey,
            });
          }
        }
      }
    }
  }

  // A4.1: Post-scan heading analysis
  if (!hasH1 && headingLevelsUsed.size > 0) {
    headingIssues.push({
      elementLabel: 'Missing <h1>', elementType: 'h1',
      subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
      classification: 'confirmed',
      detection: 'No <h1> found in any source file',
      evidence: `Heading levels: ${Array.from(headingLevelsUsed).sort().map(l => `h${l}`).join(', ')} — no h1`,
      explanation: 'No <h1> heading found.',
      confidence: 0.90,
      correctivePrompt: 'Add exactly one <h1> element for the page title.',
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
        detection: `Heading skips h${sortedLevels[i - 1]} to h${sortedLevels[i]}`,
        evidence: `Levels: ${sortedLevels.map(l => `h${l}`).join(', ')}`,
        explanation: `Heading level skip breaks document outline.`,
        confidence: 0.78,
        deduplicationKey: `A4.1|skip-h${sortedLevels[i - 1]}-h${sortedLevels[i]}`,
      });
      break;
    }
  }

  // A4.3: Missing landmarks
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

  findings.push(...headingIssues, ...clickableNonSemantics, ...landmarkIssues, ...listIssues);
  return findings;
}

// ============================================================
// TESTS
// ============================================================

Deno.test("A4.1: Missing <h1> → Confirmed, subCheck A4.1, label 'Heading semantics'", () => {
  const files = new Map([["src/page.tsx", "<h2>Subtitle</h2><h3>Section</h3>"]]);
  const results = detectA4(files);
  const h1Finding = results.find(f => f.subCheck === 'A4.1' && f.detection.includes('No <h1>'));
  assertEquals(!!h1Finding, true, "Should find missing h1");
  assertEquals(h1Finding!.subCheck, 'A4.1');
  assertEquals(h1Finding!.subCheckLabel, 'Heading semantics');
  assertEquals(h1Finding!.classification, 'confirmed');
  assertEquals(h1Finding!.confidence >= 0.85, true, "Confidence should be >= 85%");
});

Deno.test("A4.1: Skipped heading levels → Potential, subCheck A4.1", () => {
  const files = new Map([["src/page.tsx", "<h1>Title</h1><h3>Skipped</h3>"]]);
  const results = detectA4(files);
  const skipFinding = results.find(f => f.subCheck === 'A4.1' && f.detection.includes('skip'));
  assertEquals(!!skipFinding, true, "Should find heading skip");
  assertEquals(skipFinding!.classification, 'potential');
  assertEquals(skipFinding!.subCheckLabel, 'Heading semantics');
});

Deno.test("A4.2: Clickable div (React onClick) → Confirmed, subCheck A4.2, label 'Interactive semantics'", () => {
  const files = new Map([["src/comp.tsx", '<div onClick={handleClick}>Click me</div>']]);
  const results = detectA4(files);
  const a42 = results.find(f => f.subCheck === 'A4.2');
  assertEquals(!!a42, true, "Should detect clickable div");
  assertEquals(a42!.subCheck, 'A4.2');
  assertEquals(a42!.subCheckLabel, 'Interactive semantics');
  assertEquals(a42!.classification, 'confirmed');
  assertEquals(a42!.confidence >= 0.95, true, "Confidence should be >= 95%");
});

Deno.test("A4.2: HTML onclick attribute (case-insensitive) → Confirmed", () => {
  const files = new Map([["src/page.html", '<div onclick="doSomething()">Click</div>']]);
  const results = detectA4(files);
  const a42 = results.find(f => f.subCheck === 'A4.2');
  assertEquals(!!a42, true, "Should detect HTML onclick");
  assertEquals(a42!.classification, 'confirmed');
  assertEquals(a42!.subCheckLabel, 'Interactive semantics');
});

Deno.test("A4.2: HTML onmousedown attribute → Confirmed", () => {
  const files = new Map([["src/page.html", '<span onmousedown="handler()">Press</span>']]);
  const results = detectA4(files);
  const a42 = results.find(f => f.subCheck === 'A4.2');
  assertEquals(!!a42, true, "Should detect HTML onmousedown");
  assertEquals(a42!.classification, 'confirmed');
});

Deno.test("A4.2: Div with role='button' → NOT flagged", () => {
  const files = new Map([["src/comp.tsx", '<div role="button" onClick={handleClick}>OK</div>']]);
  const results = detectA4(files);
  const a42 = results.find(f => f.subCheck === 'A4.2');
  assertEquals(!!a42, false, "Should NOT flag div with role=button");
});

Deno.test("A4.3: No <main> landmark → Potential, subCheck A4.3, label 'Landmark regions'", () => {
  const files = new Map([["src/app.tsx", "<div><h1>Title</h1><p>Content</p></div>"]]);
  const results = detectA4(files);
  const a43 = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!a43, true, "Should detect missing main landmark");
  assertEquals(a43!.subCheck, 'A4.3');
  assertEquals(a43!.subCheckLabel, 'Landmark regions');
  assertEquals(a43!.classification, 'potential');
  assertEquals(a43!.confidence >= 0.75, true);
  assertEquals(a43!.confidence <= 0.90, true);
});

Deno.test("A4.3: Has <main> → NOT flagged", () => {
  const files = new Map([["src/app.tsx", "<main><h1>Title</h1></main>"]]);
  const results = detectA4(files);
  const a43 = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!a43, false, "Should NOT flag when <main> exists");
});

Deno.test("A4.4: Repeated divs without <ul> → Potential, subCheck A4.4, label 'List semantics'", () => {
  const repeated = `
    <div className="card-item p-4 rounded">Item 1</div>
    <div className="card-item p-4 rounded">Item 2</div>
    <div className="card-item p-4 rounded">Item 3</div>
  `;
  const files = new Map([["src/list.tsx", repeated]]);
  const results = detectA4(files);
  const a44 = results.find(f => f.subCheck === 'A4.4');
  assertEquals(!!a44, true, "Should detect list-like divs");
  assertEquals(a44!.subCheck, 'A4.4');
  assertEquals(a44!.subCheckLabel, 'List semantics');
  assertEquals(a44!.classification, 'potential');
  assertEquals(a44!.confidence >= 0.85, true, "Confidence should be >= 85%");
  assertEquals(a44!.confidence <= 0.95, true, "Confidence should be <= 95%");
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

Deno.test("A4: Multiple sub-checks coexist in same file", () => {
  const content = `
    <h2>No h1 here</h2>
    <div onClick={handleClick}>Clickable div</div>
    <div className="repeated-item card">A</div>
    <div className="repeated-item card">B</div>
    <div className="repeated-item card">C</div>
  `;
  const files = new Map([["src/page.tsx", content]]);
  const results = detectA4(files);

  const subChecks = new Set(results.map(f => f.subCheck));
  assertEquals(subChecks.has('A4.1'), true, "Should have A4.1 (missing h1)");
  assertEquals(subChecks.has('A4.2'), true, "Should have A4.2 (clickable div)");
  assertEquals(subChecks.has('A4.3'), true, "Should have A4.3 (missing main)");
  assertEquals(subChecks.has('A4.4'), true, "Should have A4.4 (repeated items)");
  assertEquals(results.length >= 4, true, "Should have at least 4 findings");
});
