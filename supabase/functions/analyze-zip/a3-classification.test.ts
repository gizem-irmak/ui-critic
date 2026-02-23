/**
 * A3 (Incomplete Keyboard Operability) Classification Tests
 * Tests the multiline JSX tag extractor and A3 detection logic.
 */

// Inline the helpers to test independently (same logic as in index.ts)

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
      if (inString) {
        if (ch === inString && content[i - 1] !== '\\') inString = null;
        i++; continue;
      }
      if (inTemplateLiteral) {
        if (ch === '`' && content[i - 1] !== '\\') inTemplateLiteral = false;
        i++; continue;
      }
      if (ch === '"' || ch === "'") { inString = ch; i++; continue; }
      if (ch === '`') { inTemplateLiteral = true; i++; continue; }
      if (ch === '{') { depth++; i++; continue; }
      if (ch === '}') { depth--; i++; continue; }
      if (depth === 0 && ch === '>') {
        const fullMatch = content.slice(startIdx, i + 1);
        const attrs = content.slice(startIdx + m[0].length, i);
        results.push({ tag: m[1], attrs, index: startIdx, fullMatch });
        found = true;
        break;
      }
      if (depth === 0 && ch === '/' && i + 1 < content.length && content[i + 1] === '>') {
        const fullMatch = content.slice(startIdx, i + 2);
        const attrs = content.slice(startIdx + m[0].length, i);
        results.push({ tag: m[1], attrs, index: startIdx, fullMatch });
        found = true;
        break;
      }
      i++;
    }
    if (!found) continue;
  }
  return results;
}

// ── Tests ──

Deno.test("extractJsxOpeningTags: single-line tag", () => {
  const content = `<div onClick={handleClick} className="foo">`;
  const tags = extractJsxOpeningTags(content, 'div');
  if (tags.length !== 1) throw new Error(`Expected 1 tag, got ${tags.length}`);
  if (!tags[0].attrs.includes('onClick')) throw new Error(`Attrs should contain onClick: ${tags[0].attrs}`);
});

Deno.test("extractJsxOpeningTags: multiline tag with arrow function", () => {
  const content = `<div
    onClick={() => {
      console.log("clicked");
    }}
    className="card"
  >`;
  const tags = extractJsxOpeningTags(content, 'div');
  if (tags.length !== 1) throw new Error(`Expected 1 tag, got ${tags.length}`);
  if (!tags[0].attrs.includes('onClick')) throw new Error(`Attrs should contain onClick`);
  if (!tags[0].attrs.includes('className')) throw new Error(`Attrs should contain className`);
});

Deno.test("extractJsxOpeningTags: self-closing tag", () => {
  const content = `<div onClick={handler} />`;
  const tags = extractJsxOpeningTags(content, 'div');
  if (tags.length !== 1) throw new Error(`Expected 1 tag, got ${tags.length}`);
});

Deno.test("extractJsxOpeningTags: nested braces with ternary containing >", () => {
  const content = `<span onClick={() => { return x > 0 ? "yes" : "no"; }} className="test">`;
  const tags = extractJsxOpeningTags(content, 'span');
  if (tags.length !== 1) throw new Error(`Expected 1 tag, got ${tags.length}`);
  if (!tags[0].attrs.includes('className="test"')) throw new Error(`Should capture className after the arrow fn`);
});

Deno.test("A3-C1: detect multiline div with onClick, missing role/tabIndex/keyHandler", () => {
  const content = `export default function Card() {
  return (
    <div
      onClick={() => {
        navigate("/details");
      }}
      className="card-item"
    >
      Card content
    </div>
  );
}`;
  const tags = extractJsxOpeningTags(content, 'div');
  // Should find the div with onClick
  const clickable = tags.filter(t => /onClick/i.test(t.attrs));
  if (clickable.length === 0) throw new Error("Should detect multiline div with onClick");
  
  const attrs = clickable[0].attrs;
  const hasRole = /\brole\s*=\s*["'](button|link)/i.test(attrs);
  const hasTabIndex = /tabIndex\s*=\s*\{?\s*\d+/i.test(attrs);
  const hasKeyHandler = /\b(onKeyDown|onKeyUp|onKeyPress)\s*=/.test(attrs);
  
  if (hasRole || hasTabIndex || hasKeyHandler) {
    throw new Error("This div should be missing role, tabIndex, and keyHandler");
  }
});

Deno.test("A3-C1: exempt element with role + tabIndex + onKeyDown", () => {
  const content = `<div
    role="button"
    tabIndex={0}
    onClick={handleClick}
    onKeyDown={(e) => { if (e.key === 'Enter') handleClick(); }}
  >Click me</div>`;
  const tags = extractJsxOpeningTags(content, 'div');
  const clickable = tags.filter(t => /onClick/i.test(t.attrs));
  if (clickable.length === 0) throw new Error("Should find the div");
  
  const attrs = clickable[0].attrs;
  const hasRole = /\brole\s*=\s*["'](button|link)/i.test(attrs);
  const hasTabIndex = /tabIndex\s*=\s*\{?\s*0/i.test(attrs);
  const hasKeyHandler = /onKeyDown/i.test(attrs);
  
  if (!hasRole || !hasTabIndex || !hasKeyHandler) {
    throw new Error("This div has role, tabIndex, and keyHandler — should be exempt");
  }
});

Deno.test("A3-C1: confirmed when only role is present (missing tabIndex + keyHandler)", () => {
  const content = `<div role="button" onClick={handleClick}>Click</div>`;
  const tags = extractJsxOpeningTags(content, 'div');
  const attrs = tags[0].attrs;
  const hasRole = /\brole\s*=\s*["'](button|link)/i.test(attrs);
  const hasTabIndex = /tabIndex\s*=\s*\{?\s*\d+/i.test(attrs);
  const hasKeyHandler = /\b(onKeyDown|onKeyUp|onKeyPress)\s*=/.test(attrs);
  
  // Has role but missing tabIndex and keyHandler → should be confirmed
  if (!hasRole) throw new Error("Should have role");
  if (hasTabIndex) throw new Error("Should NOT have tabIndex");
  if (hasKeyHandler) throw new Error("Should NOT have keyHandler");
  // OR logic: missing tabIndex OR missing keyHandler → confirmed
});

Deno.test("A3-C2: detect tabIndex={-1} on button", () => {
  const content = `<button tabIndex={-1} onClick={doSomething}>Submit</button>`;
  const tags = extractJsxOpeningTags(content, 'button');
  if (tags.length !== 1) throw new Error(`Expected 1 tag, got ${tags.length}`);
  const attrs = tags[0].attrs;
  const hasNegTabIndex = /tabIndex\s*=\s*\{?\s*-1/i.test(attrs);
  if (!hasNegTabIndex) throw new Error("Should detect tabIndex={-1}");
});

Deno.test("A3-C2: skip disabled button with tabIndex={-1}", () => {
  const content = `<button tabIndex={-1} disabled onClick={doSomething}>Submit</button>`;
  const tags = extractJsxOpeningTags(content, 'button');
  const attrs = tags[0].attrs;
  const isDisabled = /\bdisabled\b/i.test(attrs);
  if (!isDisabled) throw new Error("Should detect disabled attribute");
  // disabled → exemption from A3-C2
});

Deno.test("A3-P1: role=button + tabIndex but no key handler → potential", () => {
  const content = `<span role="button" tabIndex={0} onClick={handleClick}>Action</span>`;
  const tags = extractJsxOpeningTags(content, 'span');
  const attrs = tags[0].attrs;
  const hasRole = /\brole\s*=\s*["']button["']/i.test(attrs);
  const hasTabIndex = /tabIndex\s*=\s*\{?\s*0/i.test(attrs);
  const hasKeyHandler = /\b(onKeyDown|onKeyUp|onKeyPress)\s*=/.test(attrs);
  
  if (!hasRole) throw new Error("Should have role");
  if (!hasTabIndex) throw new Error("Should have tabIndex");
  if (hasKeyHandler) throw new Error("Should NOT have keyHandler → this is P1");
});

Deno.test("Multiple handlers detected on multiline JSX", () => {
  const content = `<div
    onClick={() => handleClick()}
    onMouseDown={(e) => e.preventDefault()}
    className="interactive"
  >`;
  const tags = extractJsxOpeningTags(content, 'div');
  if (tags.length !== 1) throw new Error("Expected 1 tag");
  const attrs = tags[0].attrs;
  const handlers: string[] = [];
  const matches = attrs.matchAll(/\b(onClick|onMouseDown|onPointerDown|onTouchStart)\s*=/g);
  for (const m of matches) handlers.push(m[1]);
  if (handlers.length !== 2) throw new Error(`Expected 2 handlers, got ${handlers.length}: ${handlers}`);
  if (!handlers.includes('onClick')) throw new Error("Missing onClick");
  if (!handlers.includes('onMouseDown')) throw new Error("Missing onMouseDown");
});
