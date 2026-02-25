import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// Inline the detection function for testing
interface A6Finding {
  elementLabel: string;
  elementType: string;
  role?: string;
  sourceLabel: string;
  filePath: string;
  componentName?: string;
  subCheck: 'A6.1' | 'A6.2';
  subCheckLabel: string;
  classification: 'confirmed';
  detection: string;
  evidence: string;
  explanation: string;
  wcagCriteria: string[];
  correctivePrompt?: string;
  deduplicationKey: string;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function detectA6AccessibleNames(allFiles: Map<string, string>): A6Finding[] {
  const findings: A6Finding[] = [];
  const seenKeys = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;
    if (filePath.includes('node_modules/')) continue;
    if (filePath.includes('components/ui/')) continue;
    if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) continue;

    let componentName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|html|htm)$/i, '') || '';
    const exportedFn = content.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
    const exportedConst = content.match(/export\s+(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]*)/);
    if (exportedFn?.[1]) componentName = exportedFn[1];
    else if (exportedConst?.[1]) componentName = exportedConst[1];

    // Collect all IDs and their text content for aria-labelledby resolution
    const idTextMap = new Map<string, string>();
    const idTextRegex = /<(\w+)\b[^>]*id\s*=\s*["']([^"']+)["'][^>]*>([^<]*)</g;
    let itm;
    while ((itm = idTextRegex.exec(content)) !== null) {
      idTextMap.set(itm[2], itm[3].trim());
    }

    function checkElement(tag: string, attrs: string, matchIndex: number) {
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) return;
      if (/\bhidden\b/.test(attrs) && !/hidden\s*=\s*["']false["']/i.test(attrs)) return;
      if (/\bdisabled\b/.test(attrs)) return;
      if (/aria-disabled\s*=\s*["']true["']/i.test(attrs)) return;
      if (/role\s*=\s*["'](presentation|none)["']/i.test(attrs)) return;
      if (tag.toLowerCase() === 'a' && !/href\s*=/.test(attrs)) return;

      const linesBefore = content.slice(0, matchIndex).split('\n');
      const lineNumber = linesBefore.length;
      const fileName = filePath.split('/').pop() || filePath;

      // 1. aria-labelledby
      const ariaLabelledByMatch = attrs.match(/aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabelledByVal = ariaLabelledByMatch?.[1] || ariaLabelledByMatch?.[2] || '';

      if (ariaLabelledByVal.trim()) {
        const ids = ariaLabelledByVal.trim().split(/\s+/);
        const resolvedText = ids.map(id => idTextMap.get(id) || '').join(' ').trim();
        const missingIds = ids.filter(id => !idTextMap.has(id));

        if (missingIds.length > 0 || resolvedText === '') {
          const roleMatch = attrs.match(/role\s*=\s*["']([^"']+)["']/i);
          const role = roleMatch?.[1] || tag.toLowerCase();
          const label = `<${tag}> aria-labelledby="${ariaLabelledByVal}"`;
          const dedupeKey = `A6.2|${filePath}|${tag}|${ariaLabelledByVal}|${lineNumber}`;
          if (seenKeys.has(dedupeKey)) return;
          seenKeys.add(dedupeKey);

          findings.push({
            elementLabel: label, elementType: tag.toLowerCase(), role, sourceLabel: label, filePath, componentName,
            subCheck: 'A6.2', subCheckLabel: 'Broken aria-labelledby reference', classification: 'confirmed',
            detection: `aria-labelledby references ${missingIds.length > 0 ? 'missing ID(s): ' + missingIds.join(', ') : 'empty text'}`,
            evidence: `<${tag} aria-labelledby="${ariaLabelledByVal}"> at ${filePath}:${lineNumber}`,
            explanation: `aria-labelledby references ${missingIds.length > 0 ? 'non-existent ID(s) (' + missingIds.join(', ') + ')' : 'IDs that resolve to empty text'}, so no accessible name is exposed.`,
            wcagCriteria: ['4.1.2'],
            correctivePrompt: `[${label}] — ${fileName}\n\nIssue reason:\naria-labelledby references ${missingIds.length > 0 ? 'missing' : 'empty'} IDs.\n\nRecommended fix:\nEnsure aria-labelledby references existing element IDs with label text, or use aria-label.`,
            deduplicationKey: dedupeKey,
          });
          return;
        }
        return;
      }

      // 2. aria-label
      const ariaLabelMatch = attrs.match(/aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const ariaLabelVal = (ariaLabelMatch?.[1] || ariaLabelMatch?.[2] || '').trim();
      if (ariaLabelVal.length > 0) return;

      // 3. Text content / child text / img[alt]
      const afterTag = content.slice(matchIndex + tag.length + attrs.length + 2, Math.min(content.length, matchIndex + tag.length + attrs.length + 500));
      const closingTagRegex = new RegExp(`</${tag}\\s*>`, 'i');
      const closingMatch = afterTag.match(closingTagRegex);
      const innerContent = closingMatch ? afterTag.slice(0, closingMatch.index) : afterTag.slice(0, 200);

      const visibleText = innerContent.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
      if (visibleText.length > 0) return;

      const imgAltMatch = innerContent.match(/<img\b[^>]*alt\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/i);
      const imgAlt = (imgAltMatch?.[1] || imgAltMatch?.[2] || '').trim();
      if (imgAlt.length > 0) return;

      const srOnlyMatch = innerContent.match(/<span\b[^>]*class(?:Name)?\s*=\s*(?:"[^"]*(?:sr-only|visually-hidden)[^"]*"|'[^']*(?:sr-only|visually-hidden)[^']*')[^>]*>([^<]*)</i);
      const srOnlyText = (srOnlyMatch?.[1] || '').trim();
      if (srOnlyText.length > 0) return;

      if (tag.toLowerCase() === 'input') {
        const altMatch = attrs.match(/alt\s*=\s*(?:"([^"]+)"|'([^']+)')/);
        const altVal = (altMatch?.[1] || altMatch?.[2] || '').trim();
        if (altVal.length > 0) return;
      }

      // A6.1
      const roleMatch = attrs.match(/role\s*=\s*["']([^"']+)["']/i);
      const role = roleMatch?.[1] || tag.toLowerCase();
      const label = `<${tag.toLowerCase()}${role !== tag.toLowerCase() ? ` role="${role}"` : ''}>`;
      const dedupeKey = `A6.1|${filePath}|${tag}|${role}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);

      const nameSources = ['text content', 'aria-label', 'aria-labelledby'];
      if (tag.toLowerCase() === 'a' || tag.toLowerCase() === 'button') {
        nameSources.push('child img[alt]');
      }

      findings.push({
        elementLabel: label, elementType: tag.toLowerCase(), role, sourceLabel: label, filePath, componentName,
        subCheck: 'A6.1', subCheckLabel: 'Missing accessible name', classification: 'confirmed',
        detection: `<${tag.toLowerCase()}> has no accessible name`,
        evidence: `<${tag.toLowerCase()}> at ${filePath}:${lineNumber} — checked: ${nameSources.join(', ')}`,
        explanation: `Interactive element <${tag.toLowerCase()}>${role !== tag.toLowerCase() ? ' (role="' + role + '")' : ''} has no programmatic accessible name. Screen readers cannot identify its purpose.`,
        wcagCriteria: ['4.1.2'],
        correctivePrompt: `[${label}] — ${fileName}\n\nIssue reason:\nNo accessible name.\n\nRecommended fix:\nAdd visible text, aria-label, or aria-labelledby.`,
        deduplicationKey: dedupeKey,
      });
    }

    // Scan native <button> and <a href>
    let match;
    const buttonAnchorRegex = /<(button|a)\b([^>]*)>/gi;
    while ((match = buttonAnchorRegex.exec(content)) !== null) {
      checkElement(match[1], match[2], match.index);
    }

    // Scan <input type="button|submit|reset|image">
    const inputInteractiveRegex = /<input\b([^>]*type\s*=\s*["'](button|submit|reset|image)["'][^>]*)>/gi;
    while ((match = inputInteractiveRegex.exec(content)) !== null) {
      const inputType = match[2].toLowerCase();
      if (inputType === 'submit' || inputType === 'reset') continue;
      checkElement('input', match[1], match.index);
    }

    // Scan ARIA interactive roles on non-form elements
    const ariaInteractiveRegex = new RegExp(`<(div|span|li|a|section|article|header|footer|nav|td|th|p)\\b([^>]*role\\s*=\\s*["'](?:button|link|tab|menuitem|switch|checkbox|radio|combobox|option)["'][^>]*)>`, 'gi');
    while ((match = ariaInteractiveRegex.exec(content)) !== null) {
      checkElement(match[1], match[2], match.index);
    }
  }

  return findings;
}

// ========== TESTS ==========

Deno.test("A6.1: Icon-only button without aria-label → Confirmed", () => {
  const files = new Map<string, string>();
  files.set("src/components/IconButton.tsx", `
export default function IconButton() {
  return <button><svg viewBox="0 0 24 24"><path d="M12 0L24 24H0z"/></svg></button>;
}
`);
  const results = detectA6AccessibleNames(files);
  assert(results.length >= 1, `Expected at least 1 finding, got ${results.length}`);
  const finding = results.find(f => f.subCheck === 'A6.1');
  assert(finding !== undefined, "Expected A6.1 finding");
  assertEquals(finding!.classification, "confirmed");
});

Deno.test("A6.1: Icon-only link without label → Confirmed", () => {
  const files = new Map<string, string>();
  files.set("src/components/IconLink.tsx", `
export default function IconLink() {
  return <a href="#"><svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg></a>;
}
`);
  const results = detectA6AccessibleNames(files);
  assert(results.length >= 1, `Expected at least 1 finding, got ${results.length}`);
  const finding = results.find(f => f.subCheck === 'A6.1');
  assert(finding !== undefined, "Expected A6.1 finding");
  assertEquals(finding!.classification, "confirmed");
});

Deno.test("A6.1: role=button div without label → Confirmed", () => {
  const files = new Map<string, string>();
  files.set("src/components/FakeButton.tsx", `
export default function FakeButton() {
  return <div role="button"></div>;
}
`);
  const results = detectA6AccessibleNames(files);
  assert(results.length >= 1, `Expected at least 1 finding, got ${results.length}`);
  const finding = results.find(f => f.subCheck === 'A6.1');
  assert(finding !== undefined, "Expected A6.1 finding");
  assertEquals(finding!.classification, "confirmed");
  assertEquals(finding!.role, "button");
});

Deno.test("A6.2: Broken aria-labelledby → Confirmed, suppresses A6.1", () => {
  const files = new Map<string, string>();
  files.set("src/components/BrokenRef.tsx", `
export default function BrokenRef() {
  return <button aria-labelledby="missingId"></button>;
}
`);
  const results = detectA6AccessibleNames(files);
  assert(results.length >= 1, `Expected at least 1 finding, got ${results.length}`);
  const a62 = results.find(f => f.subCheck === 'A6.2');
  assert(a62 !== undefined, "Expected A6.2 finding");
  assertEquals(a62!.classification, "confirmed");
  // A6.1 should NOT exist for the same element (suppressed by A6.2)
  const a61 = results.filter(f => f.subCheck === 'A6.1' && f.filePath.includes('BrokenRef'));
  assertEquals(a61.length, 0, "A6.2 should suppress A6.1 for same element");
});

Deno.test("PASS: button with aria-label → no A6 issue", () => {
  const files = new Map<string, string>();
  files.set("src/components/LabeledButton.tsx", `
export default function LabeledButton() {
  return <button aria-label="Close"></button>;
}
`);
  const results = detectA6AccessibleNames(files);
  assertEquals(results.length, 0, `Expected 0 findings, got ${results.length}`);
});

Deno.test("PASS: button with sr-only text → no A6 issue", () => {
  const files = new Map<string, string>();
  files.set("src/components/SrOnlyButton.tsx", `
export default function SrOnlyButton() {
  return <button><span className="sr-only">Close</span><svg viewBox="0 0 24 24"/></button>;
}
`);
  const results = detectA6AccessibleNames(files);
  assertEquals(results.length, 0, `Expected 0 findings, got ${results.length}`);
});

Deno.test("PASS: link with visible text → no A6 issue", () => {
  const files = new Map<string, string>();
  files.set("src/components/TextLink.tsx", `
export default function TextLink() {
  return <a href="#">Learn more</a>;
}
`);
  const results = detectA6AccessibleNames(files);
  assertEquals(results.length, 0, `Expected 0 findings, got ${results.length}`);
});

Deno.test("PASS: aria-hidden button is excluded", () => {
  const files = new Map<string, string>();
  files.set("src/components/HiddenButton.tsx", `
export default function HiddenButton() {
  return <button aria-hidden="true"><svg/></button>;
}
`);
  const results = detectA6AccessibleNames(files);
  assertEquals(results.length, 0, `Expected 0 findings for aria-hidden element`);
});

Deno.test("PASS: disabled button is excluded", () => {
  const files = new Map<string, string>();
  files.set("src/components/DisabledButton.tsx", `
export default function DisabledButton() {
  return <button disabled><svg/></button>;
}
`);
  const results = detectA6AccessibleNames(files);
  assertEquals(results.length, 0, `Expected 0 findings for disabled element`);
});

Deno.test("PASS: role=presentation is excluded", () => {
  const files = new Map<string, string>();
  files.set("src/components/PresentationDiv.tsx", `
export default function PresentationDiv() {
  return <div role="presentation"></div>;
}
`);
  const results = detectA6AccessibleNames(files);
  assertEquals(results.length, 0, `Expected 0 findings for role=presentation`);
});

Deno.test("PASS: button with img[alt] child → no A6 issue", () => {
  const files = new Map<string, string>();
  files.set("src/components/ImgButton.tsx", `
export default function ImgButton() {
  return <button><img src="icon.png" alt="Edit profile"/></button>;
}
`);
  const results = detectA6AccessibleNames(files);
  assertEquals(results.length, 0, `Expected 0 findings, got ${results.length}`);
});

Deno.test("A6.1: Multiple unlabeled ARIA roles detected", () => {
  const files = new Map<string, string>();
  files.set("src/components/Tabs.tsx", `
export default function Tabs() {
  return (
    <div>
      <div role="tab"></div>
      <div role="menuitem"></div>
    </div>
  );
}
`);
  const results = detectA6AccessibleNames(files);
  assertEquals(results.length, 2, `Expected 2 findings, got ${results.length}`);
  assert(results.every(f => f.subCheck === 'A6.1'));
  assert(results.every(f => f.classification === 'confirmed'));
});

Deno.test("PASS: valid aria-labelledby with existing ID → no A6 issue", () => {
  const files = new Map<string, string>();
  files.set("src/components/LabelledBy.tsx", `
export default function LabelledBy() {
  return (
    <div>
      <span id="label1">Settings</span>
      <button aria-labelledby="label1"></button>
    </div>
  );
}
`);
  const results = detectA6AccessibleNames(files);
  assertEquals(results.length, 0, `Expected 0 findings, got ${results.length}`);
});
