import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

/**
 * A4 Missing Semantic Structure — Page-Level Classification Tests
 *
 * Validates:
 * - A4.1: Page-level h1 analysis (no repo-wide counting)
 * - A4.1: Visual heading detection
 * - A4.2: Interactive semantics (keyboard present but role missing)
 * - A4.3: Layout-aware <main> detection
 * - A4.4: List heuristic
 */

interface A4Finding {
  elementLabel: string;
  elementType: string;
  filePath?: string;
  componentName?: string;
  sourceLabel?: string;
  subCheck: 'A4.1' | 'A4.2' | 'A4.3' | 'A4.4';
  subCheckLabel: string;
  classification: 'confirmed' | 'potential';
  detection: string;
  evidence: string;
  explanation: string;
  confidence: number;
  correctivePrompt?: string;
  deduplicationKey: string;
  potentialSubtype?: 'borderline' | 'accuracy';
  startLine?: number | null;
  endLine?: number | null;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

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

// --- Helpers mirroring the edge function ---

function identifyPageFiles(allFiles: Map<string, string>): Set<string> {
  const pageFiles = new Set<string>();
  const PAGE_PATH_RE = /(?:^|\/)(?:pages|routes|app|views)\/[^/]+\.(tsx|jsx|ts|js)$/i;
  for (const filePath of allFiles.keys()) {
    const norm = normalizePath(filePath);
    if (PAGE_PATH_RE.test(norm)) pageFiles.add(norm);
  }
  for (const [, content] of allFiles) {
    const routeElementRe = /element\s*[:=]\s*(?:\{?\s*)?<(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = routeElementRe.exec(content)) !== null) {
      const compName = m[1];
      for (const [fp, fc] of allFiles) {
        const norm = normalizePath(fp);
        if (pageFiles.has(norm)) continue;
        const exportRe = new RegExp(`export\\s+(?:default\\s+)?(?:function|const)\\s+${compName}\\b`);
        if (exportRe.test(fc)) pageFiles.add(norm);
      }
    }
  }
  return pageFiles;
}

function resolveImportedComponent(
  importSource: string, currentFile: string, allFiles: Map<string, string>
): { filePath: string; content: string } | null {
  let resolved = importSource.replace(/^@\//, 'src/');
  if (resolved.startsWith('.')) {
    const dir = currentFile.replace(/\/[^/]+$/, '');
    const parts = dir.split('/');
    for (const seg of resolved.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    resolved = parts.join('/');
  }
  const candidates = [resolved, `${resolved}.tsx`, `${resolved}.ts`, `${resolved}.jsx`, `${resolved}.js`, `${resolved}/index.tsx`, `${resolved}/index.ts`];
  for (const cand of candidates) {
    const norm = normalizePath(cand);
    if (allFiles.has(norm)) return { filePath: norm, content: allFiles.get(norm)! };
  }
  return null;
}

function layoutProvidesMain(pageContent: string, pageFilePath: string, allFiles: Map<string, string>): boolean {
  const returnMatch = pageContent.match(/\breturn\s*\(\s*</);
  if (!returnMatch) return false;
  const afterReturn = pageContent.slice(returnMatch.index!);
  const wrapperMatch = afterReturn.match(/^\s*return\s*\(\s*<([A-Z]\w*)/);
  if (!wrapperMatch) return false;
  const wrapperName = wrapperMatch[1];
  const importRe = new RegExp(`import\\s+(?:\\{[^}]*\\b${wrapperName}\\b[^}]*\\}|${wrapperName})\\s+from\\s+["']([^"']+)["']`);
  const importMatch = pageContent.match(importRe);
  if (!importMatch) return false;
  const resolved = resolveImportedComponent(importMatch[1], pageFilePath, allFiles);
  if (!resolved) return false;
  return /<main\b/i.test(resolved.content) || /role\s*=\s*["']main["']/i.test(resolved.content);
}

function detectA4(allFiles: Map<string, string>): A4Finding[] {
  const findings: A4Finding[] = [];
  const seenKeys = new Set<string>();

  // Global pre-pass: scan ALL files for <main> or role="main" (no directory filter)
  let hasMainLandmark = false;
  for (const [, content] of allFiles) {
    if (/<main\b/i.test(content) || /role\s*=\s*["']main["']/i.test(content)) {
      hasMainLandmark = true;
      break;
    }
  }
  const headingLevelsUsed = new Set<number>();
  const headingIssues: A4Finding[] = [];
  const visualHeadingIssues: A4Finding[] = [];
  const clickableNonSemantics: A4Finding[] = [];
  const landmarkIssues: A4Finding[] = [];
  const listIssues: A4Finding[] = [];

  const pageFiles = identifyPageFiles(allFiles);
  const pageH1Counts = new Map<string, number[]>();

  const NON_INTERACTIVE_TAGS = 'div|span|p|li|section|article|header|footer|main|aside|nav|figure|figcaption|dd|dt|dl';
  const POINTER_HANDLER_RE = /\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/;
  const HTML_CLICK_HANDLER_RE = /\b(onclick|onmousedown|onmouseup|onkeydown)\s*=/i;
  const INTERACTIVE_ROLES = /\brole\s*=\s*["'](button|link|menuitem|tab|option|checkbox|radio|switch|combobox|listbox|slider|treeitem|gridcell)["']/i;
  const KEY_HANDLER_RE = /\b(onKeyDown|onKeyUp|onKeyPress)\s*=/;
  const TABINDEX_GTE0_RE = /tabIndex\s*=\s*\{?\s*(?:0|[1-9])\s*\}?/i;
  const LARGE_FONT_RE = /(?:^|\s)(?:(?:sm|md|lg|xl|2xl):)?(?:text-(?:lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)|text-\[\d+(?:px|rem|em)\])\b/;
  const BOLD_RE = /(?:^|\s)(?:(?:sm|md|lg|xl|2xl):)?(?:font-bold|font-semibold|font-extrabold|font-black)\b/;
  const LIST_INTENT_RE = /^(?:\s*[•\-\*\d]+[\.\)]\s|\s*(?:item|card|entry|row|record)\b)/i;

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);

    const isPage = pageFiles.has(filePath);
    if (isPage) {
      const h1LineNumbers: number[] = [];
      const h1Re = /<h1\b/gi;
      let h1Match;
      while ((h1Match = h1Re.exec(content)) !== null) {
        h1LineNumbers.push(content.slice(0, h1Match.index).split('\n').length);
      }
      pageH1Counts.set(filePath, h1LineNumbers);
    }

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
        startLine: lineNumber,
      });
    }

    // A4.2: Interactive semantics
    const a4Tags = extractJsxOpeningTags(content, NON_INTERACTIVE_TAGS);
    for (const { tag, attrs, index } of a4Tags) {
      if (!POINTER_HANDLER_RE.test(attrs) && !HTML_CLICK_HANDLER_RE.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      if (INTERACTIVE_ROLES.test(attrs)) continue;
      const hasKeyHandler = KEY_HANDLER_RE.test(attrs);
      const hasTabIndex = TABINDEX_GTE0_RE.test(attrs);
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
        startLine: lineNumber,
      });
    }

    // A4.3: Nav landmark detection (main handled by pre-pass)

    // A4.4: Lists
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

  // Page-level multiple h1 — per-occurrence with line numbers
  for (const [pagePath, h1Lines] of pageH1Counts) {
    if (h1Lines.length > 1) {
      for (const h1Line of h1Lines) {
        const dedupeKey = `A4.1|multiple-h1|${pagePath}|${h1Line}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);
        headingIssues.push({
          elementLabel: `<h1> at line ${h1Line}`, elementType: 'h1',
          subCheck: 'A4.1', subCheckLabel: 'Heading semantics',
          classification: 'potential',
          detection: `multiple_h1: ${h1Lines.length} <h1> elements in the same page file`,
          evidence: `<h1> at ${pagePath}:${h1Line} (${h1Lines.length} total in file)`,
          explanation: `This page file has ${h1Lines.length} <h1> elements.`,
          confidence: 0.70,
          deduplicationKey: dedupeKey,
          startLine: h1Line,
        });
      }
    }
  }

  // Skipped heading levels
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

  // A4.3: Missing main — layout-aware
  if (!hasMainLandmark) {
    let layoutProvidesIt = false;
    for (const pagePath of pageFiles) {
      const pageContent = allFiles.get(pagePath);
      if (pageContent && layoutProvidesMain(pageContent, pagePath, allFiles)) {
        layoutProvidesIt = true;
        break;
      }
    }
    if (!layoutProvidesIt) {
      landmarkIssues.push({
        elementLabel: 'Missing <main> landmark', elementType: 'main',
        subCheck: 'A4.3', subCheckLabel: 'Landmark regions',
        classification: 'potential',
        detection: 'No <main> or role="main" found in any source or layout file',
        evidence: 'No <main> element or role="main" found across scanned UI source files.',
        explanation: 'No <main> landmark found.',
        confidence: 0.75,
        deduplicationKey: 'A4.3|no-main',
        startLine: 1,
      });
    }
  }

  findings.push(...headingIssues, ...visualHeadingIssues, ...clickableNonSemantics, ...landmarkIssues, ...listIssues);
  return findings;
}

// ============================================================
// TESTS
// ============================================================

// --- TEST 1: Many pages each with one <h1> -> NO multiple h1 issue ---
Deno.test("A4.1: Many pages each with one <h1> → NO heading issue", () => {
  const files = new Map([
    ["src/pages/Home.tsx", "<h1>Home</h1><h2>Welcome</h2>"],
    ["src/pages/About.tsx", "<h1>About Us</h1><p>Info</p>"],
    ["src/pages/Contact.tsx", "<h1>Contact</h1><p>Form</p>"],
  ]);
  const results = detectA4(files);
  const multipleH1 = results.find(f => f.detection.includes('multiple_h1'));
  assertEquals(!!multipleH1, false, "Should NOT flag multiple h1 when each page has exactly one");
});

// --- TEST 2: Page has no <h1> but has visual heading div → emits A4-H1-1 ---
Deno.test("A4.1: Page has no <h1> but visual heading div → Confirmed visual heading", () => {
  const files = new Map([
    ["src/pages/Dashboard.tsx", '<div className="text-2xl font-bold">Dashboard Overview</div><p>Content</p>'],
  ]);
  const results = detectA4(files);
  const visual = results.find(f => f.subCheck === 'A4.1' && f.detection.includes('visual_heading'));
  assertEquals(!!visual, true, "Should detect visual heading without semantic markup");
  assertEquals(visual!.classification, 'confirmed');
});

// --- TEST 3: Layout file contains <main>, page uses that layout → NO "missing main" ---
Deno.test("A4.3: Layout provides <main> via import → NO missing main finding", () => {
  const files = new Map([
    ["src/components/AppLayout.tsx", `
      export function AppLayout({ children }) {
        return (<div><nav>Nav</nav><main>{children}</main></div>);
      }
    `],
    ["src/pages/Home.tsx", `
      import { AppLayout } from "@/components/AppLayout";
      export default function Home() {
        return (<AppLayout><h1>Home</h1></AppLayout>);
      }
    `],
  ]);
  const results = detectA4(files);
  const missingMain = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!missingMain, false, "Should NOT flag missing main when layout provides it");
});

// --- TEST 4: No file contains <main> or role="main" → emit global missing main ---
Deno.test("A4.3: No <main> anywhere → emit missing main", () => {
  const files = new Map([
    ["src/pages/Home.tsx", "<div><h1>Title</h1><p>Content</p></div>"],
    ["src/components/Header.tsx", "<header><nav>Nav</nav></header>"],
  ]);
  const results = detectA4(files);
  const missingMain = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!missingMain, true, "Should detect missing main landmark");
  assertEquals(missingMain!.classification, 'potential');
});

// --- TEST 5: Page has two <h1> in same file → emits multiple h1 (Potential) ---
Deno.test("A4.1: Page with two <h1> in same file → Potential multiple h1", () => {
  const files = new Map([
    ["src/pages/Dashboard.tsx", "<h1>Dashboard</h1><section><h1>Stats</h1></section>"],
  ]);
  const results = detectA4(files);
  const multipleH1 = results.find(f => f.detection.includes('multiple_h1'));
  assertEquals(!!multipleH1, true, "Should detect multiple h1 in same page");
  assertEquals(multipleH1!.classification, 'potential');
  assertEquals(multipleH1!.confidence, 0.70);
});

// --- TEST 6: Has <main> directly → NOT flagged ---
Deno.test("A4.3: Has <main> → NOT flagged", () => {
  const files = new Map([["src/pages/Home.tsx", "<main><h1>Title</h1></main>"]]);
  const results = detectA4(files);
  const a43 = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!a43, false);
});

// --- TEST 7: Visual heading with role='heading' → NOT flagged ---
Deno.test("A4.1: Visual heading with role='heading' → NOT flagged", () => {
  const files = new Map([["src/pages/Home.tsx", '<div role="heading" aria-level="2" className="text-2xl font-bold">Dashboard</div>']]);
  const results = detectA4(files);
  const visual = results.find(f => f.subCheck === 'A4.1' && f.detection.includes('visual_heading'));
  assertEquals(!!visual, false, "Should NOT flag with role=heading");
});

// --- TEST 8: A4.2 div with onClick but NO keyboard support → NOT flagged ---
Deno.test("A4.2: div with onClick but NO keyboard support → NOT flagged (A3 territory)", () => {
  const files = new Map([["src/comp.tsx", '<div onClick={handleClick}>Click me</div>']]);
  const results = detectA4(files);
  const a42 = results.find(f => f.subCheck === 'A4.2');
  assertEquals(!!a42, false);
});

// --- TEST 9: A4.2 div with onClick + tabIndex + onKeyDown but NO role → Confirmed ---
Deno.test("A4.2: div with onClick + tabIndex + onKeyDown but NO role → Confirmed", () => {
  const files = new Map([["src/comp.tsx", '<div onClick={handleClick} tabIndex={0} onKeyDown={handleKey}>Click me</div>']]);
  const results = detectA4(files);
  const a42 = results.find(f => f.subCheck === 'A4.2');
  assertEquals(!!a42, true);
  assertEquals(a42!.classification, 'confirmed');
});

// --- TEST 10: Repeated Tailwind-only className → NOT flagged ---
Deno.test("A4.4: Repeated Tailwind-only className → NOT flagged", () => {
  const repeated = `
    <div className="p-4 rounded-lg border">A</div>
    <div className="p-4 rounded-lg border">B</div>
    <div className="p-4 rounded-lg border">C</div>
  `;
  const files = new Map([["src/list.tsx", repeated]]);
  const results = detectA4(files);
  const a44 = results.find(f => f.subCheck === 'A4.4');
  assertEquals(!!a44, false);
});

// --- TEST 11: Repeated items with list-intent class → Potential ---
Deno.test("A4.4: Repeated items with 'card-item' class → Potential", () => {
  const repeated = `
    <div className="card-item p-4 rounded">Item 1</div>
    <div className="card-item p-4 rounded">Item 2</div>
    <div className="card-item p-4 rounded">Item 3</div>
  `;
  const files = new Map([["src/list.tsx", repeated]]);
  const results = detectA4(files);
  const a44 = results.find(f => f.subCheck === 'A4.4');
  assertEquals(!!a44, true);
  assertEquals(a44!.classification, 'potential');
});

// --- TEST 12: Repo-wide h1 count is NOT emitted ---
Deno.test("A4.1: Repo-wide h1 count no longer emitted", () => {
  // 5 pages, each with 1 h1 — old logic would say "5 h1 across files"
  const files = new Map([
    ["src/pages/A.tsx", "<h1>A</h1>"],
    ["src/pages/B.tsx", "<h1>B</h1>"],
    ["src/pages/C.tsx", "<h1>C</h1>"],
    ["src/pages/D.tsx", "<h1>D</h1>"],
    ["src/pages/E.tsx", "<h1>E</h1>"],
  ]);
  const results = detectA4(files);
  const repoWide = results.find(f => f.detection.includes('found across source files'));
  assertEquals(!!repoWide, false, "Should NOT emit repo-wide h1 count");
});

// --- TEST 13: Layout wrapper inference resolves @/ alias ---
Deno.test("A4.3: Layout wrapper with @/ alias resolved → NO missing main", () => {
  const files = new Map([
    ["src/components/layout/MainLayout.tsx", `
      export const MainLayout = ({ children }) => (
        <div><main>{children}</main></div>
      );
    `],
    ["src/pages/Settings.tsx", `
      import { MainLayout } from "@/components/layout/MainLayout";
      export default function Settings() {
        return (<MainLayout><h1>Settings</h1></MainLayout>);
      }
    `],
  ]);
  const results = detectA4(files);
  const missingMain = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!missingMain, false, "Should resolve @/ alias and find <main> in layout");
});

// ============================================================
// LINE NUMBER TESTS
// ============================================================

Deno.test("A4 LINE: Multiple <h1> at lines 10 and 25 → separate findings with startLine", () => {
  const content = Array(9).fill("").join("\n") + "\n<h1>Title One</h1>\n" + Array(14).fill("").join("\n") + "\n<h1>Title Two</h1>";
  const files = new Map([["src/pages/Multi.tsx", content]]);
  const results = detectA4(files);
  const h1Findings = results.filter(f => f.detection.includes('multiple_h1'));
  assertEquals(h1Findings.length, 2, "Should emit two separate findings for two <h1>");
  assertEquals(h1Findings[0].startLine, 10, "First <h1> should be at line 10");
  assertEquals(h1Findings[1].startLine, 25, "Second <h1> should be at line 25");
});

Deno.test("A4 LINE: Missing <main> landmark → startLine = 1", () => {
  const files = new Map([["src/pages/NoMain.tsx", "<h1>Hello</h1><p>No main here</p>"]]);
  const results = detectA4(files);
  const mainFinding = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!mainFinding, true, "Should flag missing main");
  assertEquals(mainFinding!.startLine, 1, "Missing main should have startLine=1");
});

Deno.test("A4 LINE: Visual heading → startLine matches line number", () => {
  const content = "\n\n\n\n" + '<div className="text-3xl font-bold">My Title</div>';
  const files = new Map([["src/pages/Heading.tsx", content]]);
  const results = detectA4(files);
  const vh = results.find(f => f.detection.includes('visual_heading'));
  assertEquals(!!vh, true, "Should detect visual heading");
  assertEquals(vh!.startLine, 5, "Visual heading should be at line 5");
});

// ============================================================
// GLOBAL MAIN LANDMARK PRE-PASS TESTS
// ============================================================

// Test A: layout file (outside pages/) contains <main> → NO A4 landmark trigger
Deno.test("A4.3 GLOBAL: Layout file outside pages/ with <main> → NO missing main", () => {
  const files = new Map([
    ["src/pages/Home.tsx", "<div><h1>Home</h1></div>"],
    ["src/layout/RootLayout.tsx", "<div><main>{children}</main></div>"],
  ]);
  const results = detectA4(files);
  const missingMain = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!missingMain, false, "Should NOT flag missing main when layout file has <main>");
});

// Test B: only role="main" exists → NO trigger
Deno.test("A4.3 GLOBAL: Only role='main' exists → NO missing main", () => {
  const files = new Map([
    ["src/pages/Home.tsx", "<div><h1>Home</h1></div>"],
    ["src/components/Shell.tsx", '<div role="main">{children}</div>'],
  ]);
  const results = detectA4(files);
  const missingMain = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!missingMain, false, "Should NOT flag when role='main' exists");
});

// Test C: no files contain <main> or role="main" → global trigger emitted
Deno.test("A4.3 GLOBAL: No <main> anywhere → emit global trigger", () => {
  const files = new Map([
    ["src/pages/Home.tsx", "<div><h1>Title</h1><p>Content</p></div>"],
    ["src/components/Header.tsx", "<header><nav>Nav</nav></header>"],
  ]);
  const results = detectA4(files);
  const missingMain = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!missingMain, true, "Should flag missing main");
  assertEquals(missingMain!.classification, 'potential');
});

// Test D: <main> in node_modules-like excluded path but also in a real file → no trigger
// (allFiles should not contain node_modules in practice, but test that a non-standard path works)
Deno.test("A4.3 GLOBAL: <main> in non-standard directory → NO missing main", () => {
  const files = new Map([
    ["src/pages/Home.tsx", "<div><h1>Home</h1></div>"],
    ["lib/wrappers/AppShell.tsx", "<main><div>{children}</div></main>"],
  ]);
  const results = detectA4(files);
  const missingMain = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!missingMain, false, "Should find <main> even in non-standard directories");
});

// Test: components/ui/ file with <main> → still suppresses (pre-pass has no directory filter)
Deno.test("A4.3 GLOBAL: <main> in components/ui/ → NO missing main", () => {
  const files = new Map([
    ["src/pages/Home.tsx", "<div><h1>Home</h1></div>"],
    ["src/components/ui/layout.tsx", "<main>{children}</main>"],
  ]);
  const results = detectA4(files);
  const missingMain = results.find(f => f.subCheck === 'A4.3');
  assertEquals(!!missingMain, false, "Pre-pass should find <main> even in components/ui/");
});
