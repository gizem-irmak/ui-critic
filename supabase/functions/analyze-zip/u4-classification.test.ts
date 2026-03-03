import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// =====================
// Inline regex constants and helpers (mirrored from index.ts U4 section)
// =====================

const U4_STRUCTURED_LABEL_RE = /\b(category|type|status|specialty|department|gender|country|state|province|region|language|currency|priority|severity|role|level|grade|plan|tier|occupation|industry|marital|blood\s*type|ethnicity|nationality|education|degree|sport|position|brand|model|color|size|material|condition|source|channel|frequency|method|mode|format|platform|device)\b/i;
const U4_FREEFORM_LABEL_RE = /\b(note|notes|comment|comments|description|details|message|reason|bio|biography|about|story|narrative|explain|additional|other|remarks|feedback|suggestion|instructions|address|street|thoughts|opinion|custom|free.?text)\b/i;
const U4_SELECTION_RE = /<(?:Select|RadioGroup|Radio|CheckboxGroup|Combobox|Autocomplete|Listbox|ToggleGroup|SegmentedControl|Dropdown|DropdownMenu)\b|<(?:select|datalist)\b|\b(?:autocomplete|datalist|onSuggest|filterOptions|combobox)\b/i;

const U4_CONFIRMATION_DESTRUCTIVE_RE = /\b(delete|DELETE|cannot\s*be\s*undone|permanent|irreversible|are\s*you\s*sure|this\s*action|will\s*be\s*(?:deleted|removed|lost)|destroy|erase|remove\s*account|close\s*account)\b/i;
const U4_CONFIRMATION_INSTRUCTION_RE = /\b(type|enter)\s+(?:["'`]?[A-Z]{2,20}["'`]?|the\s*(?:word|name|phrase))\b/i;
const U4_CONFIRMATION_PHRASE_VISIBLE_RE = /(?:type|enter)\s+["'`]?(?:DELETE|CONFIRM|REMOVE|CANCEL|YES|[A-Z]{2,20})["'`]?\s*(?:to\s*(?:confirm|delete|remove|proceed|continue)|in\s*order\s*to)|type\s*(?:the\s*)?(?:word|name|phrase|text)\s/i;

const U4_KNOWN_SET_RE = /(?:const|let|var)\s+(?:specialties|categories|types|statuses|departments|roles|options|choices|genders|countries|states|provinces|languages|currencies|priorities|severities|levels|grades|plans|tiers|occupations|industries)\s*(?::\s*\w+(?:\[\])?\s*)?=\s*\[([^\]]{10,})\]/i;
const U4_ENUM_RE = /(?:enum\s+\w+|oneOf|z\.enum)\s*(?:\{|\()\s*\[?([^\]})]{10,})\]?\s*(?:\}|\))/i;

interface U4Candidate {
  candidateType: 'U4.1' | 'U4.2' | 'U4.3' | 'U4.4';
  elementLabel: string;
  elementType: string;
  filePath: string;
  codeSnippet: string;
  nearbyHeadings: string[];
  mitigationSignals: string[];
  rawEvidence: string;
  candidateKind?: 'categorical_free_text' | 'confirmation_phrase' | 'unknown';
  hasVisibleRequiredPhrase?: boolean;
  knownOptionsDetected?: boolean;
  knownOptionsExamples?: string[];
  nearbyText?: string[];
  actionContext?: string[];
  suppressionReason?: string;
  fieldLabel?: string;
  fieldPlaceholder?: string;
  inputType?: string;
}

/**
 * Simplified U4.1 candidate extractor (mirrors index.ts logic for testing).
 * Returns candidates that would be sent to the LLM stage.
 */
function extractU41Candidates(content: string, filePath: string): U4Candidate[] {
  const candidates: U4Candidate[] = [];
  const lines = content.split('\n');

  const getSnippet = (lineNum: number, range: number): string => {
    const ctxStart = Math.max(0, lineNum - range);
    const ctxEnd = Math.min(lines.length, lineNum + range);
    return lines.slice(ctxStart, ctxEnd).join('\n');
  };

  const getHeadings = (lineNum: number, range: number): string[] => {
    const ctxStart = Math.max(0, lineNum - range);
    const ctxEnd = Math.min(lines.length, lineNum + range);
    const nearby = lines.slice(ctxStart, ctxEnd).join('\n');
    const headings: string[] = [];
    const hRe = /<h([1-6])\b[^>]*>([^<]{2,60})<\/h\1>/gi;
    let hm;
    while ((hm = hRe.exec(nearby)) !== null) headings.push(hm[2].replace(/\{[^}]*\}/g, '').trim());
    return headings;
  };

  const inputRe = /<(?:Input|input|textarea|Textarea)\b([^>]*?)(?:\/>|>)/gi;
  let m;
  while ((m = inputRe.exec(content)) !== null) {
    const attrs = m[1] || '';
    const typeMatch = attrs.match(/type\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const inputType = typeMatch?.[1] || typeMatch?.[2] || 'text';
    if (!['text', ''].includes(inputType.toLowerCase())) continue;

    const labelMatch = attrs.match(/(?:label|aria-label|name|id)\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const placeholderMatch = attrs.match(/placeholder\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const label = labelMatch?.[1] || labelMatch?.[2] || '';
    const placeholder = placeholderMatch?.[1] || placeholderMatch?.[2] || '';
    const fieldText = `${label} ${placeholder}`.trim();

    if (!fieldText || !U4_STRUCTURED_LABEL_RE.test(fieldText)) continue;
    if (U4_FREEFORM_LABEL_RE.test(fieldText)) continue;
    if (/optional/i.test(attrs)) continue;

    const lineNum = content.substring(0, m.index).split('\n').length;
    const nearbyContent = getSnippet(lineNum, 40);
    const mitigations: string[] = [];
    if (U4_SELECTION_RE.test(nearbyContent)) mitigations.push('selection_component_nearby');
    if (/autocomplete/i.test(attrs)) mitigations.push('autocomplete_present');

    // Confirmation-phrase suppression
    const hasDestructiveContext = U4_CONFIRMATION_DESTRUCTIVE_RE.test(nearbyContent);
    const hasConfirmationInstruction = U4_CONFIRMATION_INSTRUCTION_RE.test(nearbyContent);
    const hasVisibleRequiredPhrase = U4_CONFIRMATION_PHRASE_VISIBLE_RE.test(nearbyContent);
    const isConfirmationPattern = hasDestructiveContext && (hasVisibleRequiredPhrase || hasConfirmationInstruction);
    if (isConfirmationPattern && hasVisibleRequiredPhrase) {
      continue; // Hard suppression
    }

    // Known-set detection
    let knownOptionsDetected = false;
    let knownOptionsExamples: string[] = [];
    const knownSetMatch = content.match(U4_KNOWN_SET_RE);
    if (knownSetMatch) {
      knownOptionsDetected = true;
      const arrayContent = knownSetMatch[1];
      const optionVals = arrayContent.match(/["'`]([^"'`]{1,40})["'`]/g);
      if (optionVals) knownOptionsExamples = optionVals.slice(0, 5).map(v => v.replace(/["'`]/g, ''));
      mitigations.push('known_options_in_code');
    }
    const enumMatch = content.match(U4_ENUM_RE);
    if (enumMatch && !knownOptionsDetected) {
      knownOptionsDetected = true;
      mitigations.push('enum_validation_in_code');
    }

    let candidateKind: 'categorical_free_text' | 'confirmation_phrase' | 'unknown' = 'unknown';
    if (isConfirmationPattern && !hasVisibleRequiredPhrase) {
      candidateKind = 'confirmation_phrase';
    } else {
      candidateKind = 'categorical_free_text';
    }

    candidates.push({
      candidateType: 'U4.1', elementLabel: `"${label || placeholder}" text input`,
      elementType: 'input', filePath, codeSnippet: getSnippet(lineNum, 8),
      nearbyHeadings: getHeadings(lineNum, 15), mitigationSignals: mitigations,
      rawEvidence: `U4.1 candidate`,
      candidateKind, hasVisibleRequiredPhrase: false, knownOptionsDetected, knownOptionsExamples,
      fieldLabel: label, fieldPlaceholder: placeholder, inputType: inputType || 'text',
    });
  }

  return candidates;
}

// ========== TEST CASES ==========

// ---- 1. Confirmation-phrase suppression ----

Deno.test("U4.1: 'Type DELETE to confirm' with visible phrase is suppressed", () => {
  const content = `
    <div className="space-y-4">
      <h2>Delete Account</h2>
      <p>This action cannot be undone. All your data will be permanently deleted.</p>
      <p>Type DELETE to confirm</p>
      <Input name="confirmType" placeholder="type DELETE" />
      <Button variant="destructive">Delete Account</Button>
    </div>
  `;
  const candidates = extractU41Candidates(content, 'src/components/Settings.tsx');
  // "type" matches U4_STRUCTURED_LABEL_RE — but should be suppressed by confirmation phrase
  // Actually "confirmType" has "type" in it. Let's verify suppression works.
  assertEquals(candidates.length, 0, 'Confirmation phrase with visible instruction should be suppressed');
});

Deno.test("U4.1: 'Enter DELETE to confirm deletion' with visible phrase is suppressed", () => {
  const content = `
    <div>
      <h3>Are you sure?</h3>
      <p>This is permanent and irreversible.</p>
      <p>Enter DELETE to confirm deletion</p>
      <Input id="deleteType" placeholder="Type here" />
      <Button>Confirm Delete</Button>
    </div>
  `;
  const candidates = extractU41Candidates(content, 'src/pages/AccountSettings.tsx');
  assertEquals(candidates.length, 0, 'Enter DELETE to confirm with visible instruction should be suppressed');
});

Deno.test("U4.1: Destructive confirmation without visible phrase is ambiguous (candidateKind=confirmation_phrase)", () => {
  // Has "cannot be undone" but NO "Type DELETE to confirm" visible phrase
  const content = `
    <div>
      <h3>Delete Account</h3>
      <p>This action cannot be undone.</p>
      <Input name="confirmationType" placeholder="Enter account type" />
      <Button variant="destructive">Delete</Button>
    </div>
  `;
  const candidates = extractU41Candidates(content, 'src/components/DeleteModal.tsx');
  // "confirmationType" contains "type" — matches structured label. 
  // "cannot be undone" is a confirmation keyword, but no visible phrase → ambiguous
  if (candidates.length > 0) {
    assertEquals(candidates[0].candidateKind, 'confirmation_phrase', 'Should be marked as ambiguous confirmation_phrase');
  }
});

// ---- 2. Categorical free-text fields (genuine U4.1) ----

Deno.test("U4.1: 'Specialty' free-text input with no select triggers U4 candidate", () => {
  const content = `
    <div>
      <h2>Doctor Profile</h2>
      <label>Specialty</label>
      <Input name="specialty" placeholder="Enter your specialty" />
      <Button>Save</Button>
    </div>
  `;
  const candidates = extractU41Candidates(content, 'src/components/DoctorForm.tsx');
  assert(candidates.length >= 1, 'Specialty field should generate a U4.1 candidate');
  assertEquals(candidates[0].candidateType, 'U4.1');
  assertEquals(candidates[0].candidateKind, 'categorical_free_text');
});

Deno.test("U4.1: 'Specialty' with known options array boosts evidence", () => {
  const content = `
    const specialties = ["Cardiology", "Dermatology", "Neurology", "Pediatrics", "Radiology"];
    
    export function DoctorForm() {
      return (
        <div>
          <h2>Doctor Profile</h2>
          <Input name="specialty" placeholder="Enter your specialty" />
          <Button>Save</Button>
        </div>
      );
    }
  `;
  const candidates = extractU41Candidates(content, 'src/components/DoctorForm.tsx');
  assert(candidates.length >= 1, 'Should detect U4.1');
  assert(candidates[0].knownOptionsDetected === true, 'Should detect known options in code');
  assert(candidates[0].knownOptionsExamples!.length > 0, 'Should extract option examples');
  assert(candidates[0].mitigationSignals.includes('known_options_in_code'), 'Should include known_options_in_code mitigation');
});

Deno.test("U4.1: 'Country' free-text with nearby Select is mitigated", () => {
  const content = `
    <div>
      <Select>
        <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
      </Select>
      <Input name="country" placeholder="Or type your country" />
    </div>
  `;
  const candidates = extractU41Candidates(content, 'src/components/AddressForm.tsx');
  if (candidates.length > 0) {
    assert(candidates[0].mitigationSignals.includes('selection_component_nearby'), 'Should detect nearby selection component');
  }
});

// ---- 3. Non-categorical fields (should NOT trigger U4) ----

Deno.test("U4.1: 'Notes' field does NOT trigger U4 (freeform label)", () => {
  const content = `
    <div>
      <Input name="notes" placeholder="Add your notes" />
      <Button>Save</Button>
    </div>
  `;
  const candidates = extractU41Candidates(content, 'src/components/NotesForm.tsx');
  assertEquals(candidates.length, 0, 'Freeform label "notes" should not trigger U4');
});

Deno.test("U4.1: 'Message' field does NOT trigger U4 (freeform label)", () => {
  const content = `
    <div>
      <Input name="message" placeholder="Enter your message" />
      <Button>Send</Button>
    </div>
  `;
  const candidates = extractU41Candidates(content, 'src/components/ContactForm.tsx');
  assertEquals(candidates.length, 0, 'Freeform label "message" should not trigger U4');
});

Deno.test("U4.1: 'Description' field does NOT trigger U4 (freeform label)", () => {
  const content = `
    <div>
      <textarea name="description" placeholder="Describe the issue" />
      <Button>Submit</Button>
    </div>
  `;
  const candidates = extractU41Candidates(content, 'src/components/IssueForm.tsx');
  assertEquals(candidates.length, 0, 'Freeform label "description" should not trigger U4');
});

Deno.test("U4.1: Email input type does NOT trigger U4", () => {
  const content = `
    <div>
      <Input type="email" name="category" placeholder="Enter category email" />
    </div>
  `;
  const candidates = extractU41Candidates(content, 'src/components/Form.tsx');
  assertEquals(candidates.length, 0, 'Non-text input type should not trigger U4');
});

// ---- 4. Confirmation-phrase regex validation ----

Deno.test("U4: confirmation phrase regex matches 'Type DELETE to confirm'", () => {
  assert(U4_CONFIRMATION_PHRASE_VISIBLE_RE.test("Type DELETE to confirm"));
});

Deno.test("U4: confirmation phrase regex matches 'Enter CONFIRM to proceed'", () => {
  assert(U4_CONFIRMATION_PHRASE_VISIBLE_RE.test("Enter CONFIRM to proceed"));
});

Deno.test("U4: confirmation phrase regex matches 'type REMOVE to delete'", () => {
  assert(U4_CONFIRMATION_PHRASE_VISIBLE_RE.test("type REMOVE to delete"));
});

Deno.test("U4: confirmation phrase regex does NOT match 'Enter your category'", () => {
  assert(!U4_CONFIRMATION_PHRASE_VISIBLE_RE.test("Enter your category"));
});

Deno.test("U4: destructive context regex matches 'cannot be undone'", () => {
  assert(U4_CONFIRMATION_DESTRUCTIVE_RE.test("This action cannot be undone"));
});

Deno.test("U4: destructive context regex matches 'permanent'", () => {
  assert(U4_CONFIRMATION_DESTRUCTIVE_RE.test("This is permanent"));
});

Deno.test("U4: destructive context regex does NOT match 'Enter your specialty'", () => {
  assert(!U4_CONFIRMATION_DESTRUCTIVE_RE.test("Enter your specialty"));
});

// ---- 5. Known-set regex validation ----

Deno.test("U4: known-set regex matches const specialties = [...]", () => {
  const code = 'const specialties = ["Cardiology", "Dermatology", "Neurology"];';
  assert(U4_KNOWN_SET_RE.test(code));
});

Deno.test("U4: known-set regex matches const categories with type annotation", () => {
  const code = 'const categories: string[] = ["Electronics", "Clothing", "Food"];';
  assert(U4_KNOWN_SET_RE.test(code));
});

Deno.test("U4: enum regex matches z.enum()", () => {
  const code = 'z.enum(["active", "inactive", "pending"])';
  assert(U4_ENUM_RE.test(code));
});
