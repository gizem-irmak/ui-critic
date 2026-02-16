import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// Inline the detection function for testing
interface A5Finding {
  subCheck: 'A5.1' | 'A5.2' | 'A5.3';
  subCheckLabel: string;
  classification: 'confirmed';
  confidence: number;
  elementLabel: string;
  elementType: string;
  detection: string;
  evidence: string;
  explanation: string;
  deduplicationKey: string;
  filePath: string;
  sourceLabel: string;
  inputSubtype?: string;
  role?: string;
  componentName?: string;
  correctivePrompt?: string;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function detectA5FormLabels(allFiles: Map<string, string>): A5Finding[] {
  const findings: A5Finding[] = [];
  const seenKeys = new Set<string>();

  for (const [filePathRaw, content] of allFiles) {
    const filePath = normalizePath(filePathRaw);
    if (!/\.(tsx|jsx|ts|js|html|htm)$/.test(filePath)) continue;

    const controlIds = new Set<string>();
    const controlIdRegex = /(?:id)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
    let idMatch;
    while ((idMatch = controlIdRegex.exec(content)) !== null) {
      const id = idMatch[1] || idMatch[2] || idMatch[3];
      if (id) controlIds.add(id);
    }

    const idCounts = new Map<string, number>();
    for (const id of controlIds) {
      const idRegex = new RegExp(`id\\s*=\\s*(?:"|'|\\{["'])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:"|'|["']\\})`, 'g');
      const matches = content.match(idRegex);
      if (matches) idCounts.set(id, matches.length);
    }

    const labelForTargets = new Set<string>();
    const labelForRegex = /(?:htmlFor|for)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/g;
    let labelForMatch;
    while ((labelForMatch = labelForRegex.exec(content)) !== null) {
      const target = labelForMatch[1] || labelForMatch[2] || labelForMatch[3];
      if (target) labelForTargets.add(target);
    }

    const EXCLUDED_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button']);
    const controlRegex = /<(input|textarea|select)\b([^>]*)(?:>|\/>)/gi;
    let match;
    while ((match = controlRegex.exec(content)) !== null) {
      const tag = match[1].toLowerCase();
      const attrs = match[2];

      if (tag === 'input') {
        const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        const inputType = (typeMatch?.[1] || typeMatch?.[2] || 'text').toLowerCase();
        if (EXCLUDED_INPUT_TYPES.has(inputType)) continue;
      }
      if (/\bdisabled\b/.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;

      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;

      const hasAriaLabel = /aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs) && !/aria-label\s*=\s*["']\s*["']/.test(attrs);
      const hasAriaLabelledBy = /aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs);
      const controlIdMatch2 = attrs.match(/(?:^|\s)id\s*=\s*(?:"([^"]+)"|'([^']+)'|\{["']([^"']+)["']\})/);
      const controlId = controlIdMatch2?.[1] || controlIdMatch2?.[2] || controlIdMatch2?.[3];
      const hasExplicitLabel = controlId ? labelForTargets.has(controlId) : false;

      const beforeControl = content.slice(Math.max(0, match.index - 500), match.index);
      const lastLabelOpen = beforeControl.lastIndexOf('<label');
      const lastLabelClose = beforeControl.lastIndexOf('</label');
      const isWrappedInLabel = lastLabelOpen > lastLabelClose && lastLabelOpen !== -1;

      const hasValidLabel = hasAriaLabel || hasAriaLabelledBy || hasExplicitLabel || isWrappedInLabel;

      const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2];
      const hasPlaceholder = !!placeholder && placeholder.trim().length > 0;

      const nameMatch = attrs.match(/(?:name|id)\s*=\s*(?:"([^"]+)"|'([^']+)')/);
      const elementName = nameMatch?.[1] || nameMatch?.[2] || '';
      const label = placeholder || elementName || `<${tag}> control`;

      if (hasValidLabel) continue;

      if (hasPlaceholder && !hasValidLabel) {
        const dedupeKey = `A5.2|${filePath}|${tag}|${label}|${lineNumber}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          findings.push({
            elementLabel: label, elementType: tag, sourceLabel: label, filePath,
            subCheck: 'A5.2', subCheckLabel: 'Placeholder used as label', classification: 'confirmed',
            detection: `<${tag}> placeholder-only`, evidence: `placeholder="${placeholder}"`,
            explanation: `Placeholder is the only label.`, confidence: 0.95, deduplicationKey: dedupeKey,
          });
        }
        continue;
      }

      const dedupeKey = `A5.1|${filePath}|${tag}|${label}|${lineNumber}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        findings.push({
          elementLabel: label, elementType: tag, sourceLabel: label, filePath,
          subCheck: 'A5.1', subCheckLabel: 'Missing label association', classification: 'confirmed',
          detection: `<${tag}> no label`, evidence: `no label source`,
          explanation: `No accessible name.`, confidence: 0.97, deduplicationKey: dedupeKey,
        });
      }
    }

    // ARIA input roles
    const ariaInputRegex = new RegExp(`<(div|span|p|section)\\b([^>]*role\\s*=\\s*["'](?:textbox|combobox|searchbox|spinbutton)["'][^>]*)>`, 'gi');
    while ((match = ariaInputRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (/\bdisabled\b/.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      const hasAriaLabel = /aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs) && !/aria-label\s*=\s*["']\s*["']/.test(attrs);
      const hasAriaLabelledBy = /aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs);
      if (hasAriaLabel || hasAriaLabelledBy) continue;
      const roleMatch = attrs.match(/role\s*=\s*["']([^"']+)["']/i);
      const role = roleMatch?.[1] || 'textbox';
      const linesBefore = content.slice(0, match.index).split('\n');
      const lineNumber = linesBefore.length;
      const label = `<${tag} role="${role}">`;
      const dedupeKey = `A5.1|${filePath}|${tag}|${role}|${lineNumber}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      findings.push({
        elementLabel: label, elementType: tag, sourceLabel: label, filePath,
        subCheck: 'A5.1', subCheckLabel: 'Missing label association', classification: 'confirmed',
        detection: `<${tag} role="${role}"> no label`, evidence: `no programmatic label`,
        explanation: `Custom input (role="${role}") has no accessible name.`, confidence: 0.95, deduplicationKey: dedupeKey,
      });
    }

    // Contenteditable elements
    const contenteditableRegex = /<(\w+)\b([^>]*contenteditable\s*=\s*["']true["'][^>]*)>/gi;
    while ((match = contenteditableRegex.exec(content)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      if (/\bdisabled\b/.test(attrs)) continue;
      if (/aria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
      const hasAriaLabel = /aria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs) && !/aria-label\s*=\s*["']\s*["']/.test(attrs);
      const hasAriaLabelledBy = /aria-labelledby\s*=\s*(?:"([^"]+)"|'([^']+)')/.test(attrs);
      if (hasAriaLabel || hasAriaLabelledBy) continue;
      const roleMatch2 = attrs.match(/role\s*=\s*["']([^"']+)["']/i);
      const role = roleMatch2?.[1] || 'textbox';
      const linesBefore2 = content.slice(0, match.index).split('\n');
      const lineNumber2 = linesBefore2.length;
      const label2 = `<${tag} contenteditable role="${role}">`;
      const dedupeKey = `A5.1|${filePath}|${tag}|contenteditable|${lineNumber2}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      findings.push({
        elementLabel: label2, elementType: tag, sourceLabel: label2, filePath,
        subCheck: 'A5.1', subCheckLabel: 'Missing label association', classification: 'confirmed',
        detection: `<${tag} contenteditable="true"> no label`, evidence: `no programmatic label`,
        explanation: `Contenteditable element has no accessible name.`, confidence: 0.95, deduplicationKey: dedupeKey,
      });
    }

    // A5.3: Orphan labels (run once per file, after control loop)
    for (const forTarget of labelForTargets) {
      if (!controlIds.has(forTarget)) {
        const dedupeKey = `A5.3|${filePath}|${forTarget}|missing`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          findings.push({
            elementLabel: `label[for="${forTarget}"]`, elementType: 'label', sourceLabel: `Orphan label for="${forTarget}"`, filePath,
            subCheck: 'A5.3', subCheckLabel: 'Broken label association', classification: 'confirmed',
            detection: `<label for="${forTarget}"> references non-existent id`, evidence: `label for="${forTarget}" — no matching id`,
            explanation: `Label references non-existent id="${forTarget}".`, confidence: 0.90, deduplicationKey: dedupeKey,
          });
        }
      }
    }
  }

  // Post-process: suppress A5.1 for controls in the same file where an A5.3 orphan label exists
  const a53Files = new Set(findings.filter(f => f.subCheck === 'A5.3').map(f => f.filePath));
  const deduped = findings.filter(f => {
    if (f.subCheck === 'A5.1' && a53Files.has(f.filePath)) return false;
    return true;
  });

  return deduped;
}

// ===== TESTS =====

Deno.test("A5.1: input with no label triggers missing label", () => {
  const files = new Map([["src/Form.tsx", `<input type="text" name="email" />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  assertEquals(results[0].subCheck, "A5.1");
  assertEquals(results[0].subCheckLabel, "Missing label association");
  assertEquals(results[0].classification, "confirmed");
  assert(results[0].confidence >= 0.95);
});

Deno.test("A5.2: input with placeholder only triggers placeholder-as-label", () => {
  const files = new Map([["src/Form.tsx", `<input type="text" placeholder="Enter email" />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  assertEquals(results[0].subCheck, "A5.2");
  assertEquals(results[0].subCheckLabel, "Placeholder used as label");
  assertEquals(results[0].classification, "confirmed");
  assert(results[0].confidence >= 0.95);
});

Deno.test("A5.3: label for mismatch triggers broken association, suppresses A5.1", () => {
  const files = new Map([["src/Form.tsx", `
    <label for="nonexistent">Email</label>
    <input type="text" id="email-field" />
  `]]);
  const results = detectA5FormLabels(files);
  // The orphan label triggers A5.3, and the input's A5.1 is suppressed by dedup
  const a53 = results.find(r => r.subCheck === 'A5.3');
  assert(a53 !== undefined, "Should find A5.3 for orphan label");
  const a51 = results.find(r => r.subCheck === 'A5.1');
  assertEquals(a51, undefined, "A5.1 should be suppressed when A5.3 exists in same file");
});

Deno.test("No findings for correctly labeled input (label+id)", () => {
  const files = new Map([["src/Form.tsx", `
    <label htmlFor="email">Email</label>
    <input type="text" id="email" />
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("No findings for aria-label only", () => {
  const files = new Map([["src/Form.tsx", `<input type="text" aria-label="Search" />`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("No findings for aria-labelledby", () => {
  const files = new Map([["src/Form.tsx", `
    <span id="label-text">Search</span>
    <input type="text" aria-labelledby="label-text" />
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("Excludes hidden, submit, reset, button input types", () => {
  const files = new Map([["src/Form.tsx", `
    <input type="hidden" name="token" />
    <input type="submit" value="Go" />
    <input type="reset" value="Clear" />
    <input type="button" value="Click" />
  `]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("Excludes disabled controls", () => {
  const files = new Map([["src/Form.tsx", `<input type="text" disabled />`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("Textarea without label triggers A5.1", () => {
  const files = new Map([["src/Form.tsx", `<textarea name="comment"></textarea>`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  assertEquals(results[0].subCheck, "A5.1");
});

Deno.test("Select without label triggers A5.1", () => {
  const files = new Map([["src/Form.tsx", `<select name="country"><option>US</option></select>`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  assertEquals(results[0].subCheck, "A5.1");
});

Deno.test("Wrapped in <label> is valid", () => {
  const files = new Map([["src/Form.tsx", `<label>Email <input type="text" /></label>`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("Plain HTML fixture: placeholder-only triggers A5.2", () => {
  const files = new Map([["index.html", `<input type="email" placeholder="Enter email" />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  const a52 = results.find(r => r.subCheck === 'A5.2');
  assert(a52 !== undefined, "Should find A5.2 for placeholder-only input");
});

Deno.test("Plain HTML fixture: unlabeled password triggers A5.1", () => {
  const files = new Map([["index.html", `<input type="password" name="pass" />`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  const a51 = results.find(r => r.subCheck === 'A5.1');
  assert(a51 !== undefined, "Should find A5.1 for unlabeled password");
});

Deno.test("Plain HTML fixture: label for mismatch triggers A5.3, suppresses A5.1", () => {
  const files = new Map([["index.html", `
    <label for="country">Country</label>
    <select id="countrySelect"><option>US</option></select>
  `]]);
  const results = detectA5FormLabels(files);
  const a53 = results.find(r => r.subCheck === 'A5.3');
  assert(a53 !== undefined, "Should find A5.3 for label/id mismatch");
  const a51 = results.find(r => r.subCheck === 'A5.1');
  assertEquals(a51, undefined, "A5.1 should be suppressed when A5.3 exists in same file");
});

Deno.test("Contenteditable without label triggers A5.1", () => {
  const files = new Map([["index.html", `<div contenteditable="true" role="textbox"></div>`]]);
  const results = detectA5FormLabels(files);
  assert(results.length >= 1);
  assertEquals(results[0].subCheck, "A5.1");
});

Deno.test("Contenteditable with aria-label is valid", () => {
  const files = new Map([["index.html", `<div contenteditable="true" role="textbox" aria-label="Notes"></div>`]]);
  const results = detectA5FormLabels(files);
  assertEquals(results.length, 0);
});

Deno.test("Multi-control HTML fixture triggers findings with A5.1 suppressed by A5.3", () => {
  const files = new Map([["form.html", `
    <form>
      <input type="email" placeholder="Enter email" />
      <input type="password" name="pass" />
      <label for="country">Country</label>
      <select id="countrySelect"><option>US</option></select>
      <div contenteditable="true" role="textbox"></div>
    </form>
  `]]);
  const results = detectA5FormLabels(files);
  // A5.3 orphan label suppresses all A5.1 in same file
  // Expect: A5.2 (email placeholder) + A5.3 (orphan label) = 2 findings
  assert(results.some(r => r.subCheck === 'A5.2'), "Should have A5.2");
  assert(results.some(r => r.subCheck === 'A5.3'), "Should have A5.3");
  assertEquals(results.filter(r => r.subCheck === 'A5.1').length, 0, "A5.1 should be suppressed by A5.3 dedup");
});

Deno.test("HTML fixture file: a5_form_labels_fail.html triggers A5.1, A5.2, A5.3", () => {
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head><title>A5 Test Fixture</title></head>
<body>
  <form>
    <!-- A5.2: placeholder-only, no label -->
    <input type="email" placeholder="Enter your email" />

    <!-- A5.1: no label at all (separate file, no A5.3 interference) -->
    <textarea name="comments"></textarea>

    <!-- Correctly labeled: should NOT trigger -->
    <label for="username">Username</label>
    <input type="text" id="username" />

    <!-- Correctly labeled via aria-label: should NOT trigger -->
    <input type="search" aria-label="Search site" />

    <!-- Correctly labeled via wrapping: should NOT trigger -->
    <label>Phone <input type="tel" /></label>
  </form>
</body>
</html>`;

  const htmlWithBrokenLabel = `<!DOCTYPE html>
<html><body>
  <form>
    <!-- A5.3: label for="city" but control has id="citySelect" -->
    <label for="city">City</label>
    <select id="citySelect"><option>NYC</option></select>
  </form>
</body></html>`;

  // Test file WITHOUT orphan labels — A5.1 should fire
  const results1 = detectA5FormLabels(new Map([["a5_form_labels_fail.html", htmlContent]]));

  const a52 = results1.filter(r => r.subCheck === 'A5.2');
  assert(a52.length >= 1, "Should find A5.2 for email placeholder-only");
  assertEquals(a52[0].filePath, "a5_form_labels_fail.html");

  const a51 = results1.filter(r => r.subCheck === 'A5.1');
  assert(a51.length >= 1, "Should find A5.1 for textarea without label");

  // No A5.3 in this file, so A5.1 should not be suppressed
  assertEquals(results1.filter(r => r.subCheck === 'A5.3').length, 0, "No A5.3 expected in clean file");

  // Correctly labeled controls should produce NO findings
  const usernameFindings = results1.filter(r => r.elementLabel === 'username');
  assertEquals(usernameFindings.length, 0, "Correctly labeled username should not trigger");

  // Test file WITH orphan label — A5.3 fires, A5.1 suppressed
  const results2 = detectA5FormLabels(new Map([["a5_broken_labels.html", htmlWithBrokenLabel]]));

  const a53 = results2.filter(r => r.subCheck === 'A5.3');
  assert(a53.length >= 1, "Should find A5.3 for broken label association");
  assertEquals(a53[0].filePath, "a5_broken_labels.html");

  const a51suppressed = results2.filter(r => r.subCheck === 'A5.1');
  assertEquals(a51suppressed.length, 0, "A5.1 should be suppressed when A5.3 exists");
});
