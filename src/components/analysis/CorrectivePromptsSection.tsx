import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Violation, A1ElementSubItem, A3ElementSubItem, A4ElementSubItem, A5ElementSubItem, A6ElementSubItem, U1ElementSubItem } from '@/types/project';
import { CorrectivePromptItem } from './CorrectivePromptItem';

const categoryColors: Record<string, string> = {
  accessibility: 'category-accessibility',
  usability: 'category-usability',
  ethics: 'category-ethics',
};

const categoryLabels: Record<string, string> = {
  accessibility: 'Accessibility',
  usability: 'Usability',
  ethics: 'Ethics',
};

function buildA1PromptBody(el: A1ElementSubItem): { issueReason: string; recommendedFix: string } {
  const ratioStr = el.contrastRatio != null ? `${el.contrastRatio.toFixed(1)}:1` : 'unknown';
  const threshStr = `${el.thresholdUsed || 4.5}:1`;
  const sizeLabel = el.textType === 'large' ? 'large' : 'normal';
  const fgHex = el.foregroundHex || '???';
  const bgHex = el.backgroundHex || '#FFFFFF';
  const issueReason = `Contrast ratio ${ratioStr} is below WCAG 1.4.3 threshold of ${threshStr} (${sizeLabel} text).`;
  const recommendedFix = `Darken the text color (currently ${fgHex} on ${bgHex}) to reach ≥${threshStr}, e.g. use text-gray-700/800 or adjust the background; keep visual style consistent across similar elements.`;
  return { issueReason, recommendedFix };
}

function buildA3PromptBody(el: A3ElementSubItem): { issueReason: string; recommendedFix: string } {
  const tag = el.elementType || 'div';
  const missing: string[] = [];

  const evidenceLower = (el.evidence || '').toLowerCase();
  const explanationLower = (el.explanation || '').toLowerCase();
  const combined = evidenceLower + ' ' + explanationLower;

  if (combined.includes('tabindex') || combined.includes('not focusable')) missing.push('tabIndex');
  if (combined.includes('role')) missing.push('semantic role');
  if (combined.includes('onkeydown') || combined.includes('onkeyup') || combined.includes('onkeypress') || combined.includes('enter') || combined.includes('space')) missing.push('onKeyDown (Enter/Space)');
  if (missing.length === 0) missing.push('tabIndex', 'semantic role', 'onKeyDown (Enter/Space)');

  const handler = el.detection?.match(/on\w+/)?.[0] || 'onClick';
  const issueReason = `This ${tag} uses ${handler} but is not keyboard operable because it lacks ${missing.join(', ')}.`;
  const recommendedFix = `Replace the clickable <${tag}> with a native <button type="button"> (or <a href> if navigation). If you must keep a ${tag}, add role="button", tabIndex={0}, and an onKeyDown handler for Enter/Space, and ensure :focus-visible styling.`;

  return { issueReason, recommendedFix };
}

const A4_CORRECTIVE_TEMPLATES: Record<string, { issueReason: string; recommendedFix: string }> = {
  'A4.1': {
    issueReason: 'Page lacks semantic heading structure, reducing screen reader navigation.',
    recommendedFix: 'Use semantic headings (<h1>–<h6>) to represent page hierarchy. Ensure exactly one <h1> for the page title and avoid skipping heading levels.',
  },
  'A4.2': {
    issueReason: 'Clickable non-semantic element is not keyboard operable and lacks ARIA role.',
    recommendedFix: 'Replace clickable non-semantic elements with <button> or <a>. If a non-button must be used, add role="button", tabIndex="0", and keyboard handlers for Enter/Space, plus visible focus styles.',
  },
  'A4.3': {
    issueReason: 'Page lacks semantic landmark regions, reducing assistive technology navigation.',
    recommendedFix: 'Add semantic landmarks (<main>, <nav>, <header>, <footer>, <aside>) so assistive technologies can navigate the page structure.',
  },
  'A4.4': {
    issueReason: 'Repeated items use purely visual repetition instead of semantic list elements.',
    recommendedFix: 'Represent repeated items using <ul>/<ol>/<li> (or role="list"/role="listitem") instead of purely visual repetition.',
  },
};

function buildA4PromptBody(el: A4ElementSubItem): { issueReason: string; recommendedFix: string } {
  const template = A4_CORRECTIVE_TEMPLATES[el.subCheck];
  if (template) return template;
  return { issueReason: el.explanation, recommendedFix: el.correctivePrompt || 'Use semantic HTML elements to represent page structure.' };
}

const A5_CORRECTIVE_TEMPLATES: Record<string, { issueReason: string; recommendedFix: string }> = {
  'A5.1': {
    issueReason: 'This form control has no associated <label>, aria-label, or aria-labelledby, so it has no programmatic accessible name.',
    recommendedFix: 'Add a visible <label> element associated using a matching for/id pair. Alternatively, provide an accessible name using aria-label or aria-labelledby. Ensure every form control has a clear, programmatic label.',
  },
  'A5.2': {
    issueReason: 'This input relies on placeholder text as its only label. Placeholders disappear on input and are not reliably announced by screen readers.',
    recommendedFix: 'Add a visible <label> associated via for/id. Do not rely on placeholder text as the sole accessible name.',
  },
  'A5.3': {
    issueReason: 'The <label> for attribute does not match the id of the corresponding form control, so the control has no valid programmatic label.',
    recommendedFix: 'Ensure the <label> for value exactly matches the id of the intended form control. Remove orphan labels or correct the referenced id.',
  },
};

function buildA5PromptBody(el: A5ElementSubItem): { issueReason: string; recommendedFix: string } {
  const template = A5_CORRECTIVE_TEMPLATES[el.subCheck];
  if (template) return template;
  return { issueReason: el.explanation, recommendedFix: el.correctivePrompt || 'Add a visible <label> or accessible name for this form control.' };
}

const A6_CORRECTIVE_TEMPLATES: Record<string, { issueReason: string; recommendedFix: string }> = {
  'A6.1': {
    issueReason: 'This interactive element has no programmatic accessible name (no text, aria-label, or valid aria-labelledby). Screen readers cannot identify its purpose.',
    recommendedFix: 'Add visible text content, or provide an accessible name using aria-label or aria-labelledby. For icon-only buttons/links, add an aria-label (e.g., "Edit profile", "Open settings") or include screen-reader-only text.',
  },
  'A6.2': {
    issueReason: 'This element uses aria-labelledby, but the referenced ID(s) are missing or resolve to empty text, so no accessible name is exposed.',
    recommendedFix: 'Ensure aria-labelledby references existing element IDs that contain the intended label text. Alternatively, replace with a clear aria-label or visible text content.',
  },
};

function buildA6PromptBody(el: A6ElementSubItem): { issueReason: string; recommendedFix: string } {
  const template = A6_CORRECTIVE_TEMPLATES[el.subCheck];
  if (template) return template;
  return { issueReason: el.explanation, recommendedFix: el.correctivePrompt || 'Add an accessible name to this interactive element.' };
}

function buildU1PromptBody(el: U1ElementSubItem): { issueReason: string; recommendedFix: string } {
  if (el.subCheck === 'U1.1') {
    return {
      issueReason: 'Form has no submit mechanism — no submit button, input[type="submit"], or onSubmit handler was found.',
      recommendedFix: "Add a clear submit mechanism to the form: either add <button type='submit'>Submit</button> inside the <form>, or attach an onSubmit handler to the <form> that processes submission. Ensure the submit control is discoverable and labeled specifically (e.g., 'Save', 'Submit').",
    };
  }
  return { issueReason: el.explanation, recommendedFix: el.advisoryGuidance || 'Ensure the primary action is clear and discoverable.' };
}

/** Extract file name only (not full path) from a location string */
function extractFilePath(location?: string): string {
  if (!location) return 'Unknown';
  const cleaned = location.replace(/^📍\s*/, '').trim();
  // If it contains " — ", take the part after it (the path)
  const dashIdx = cleaned.indexOf(' — ');
  const pathPart = dashIdx >= 0 ? cleaned.slice(dashIdx + 3).trim() : cleaned;
  if (!pathPart) return 'Unknown';
  // Extract just the filename from the path
  const match = pathPart.match(/([\w.-]+\.\w+)(?:\s|$)/);
  return match ? match[1] : pathPart.split('/').pop() || pathPart;
}

/** Unified location parts extractor for all rules */
function extractLocationParts(
  rawLabel: string,
  rawTag: string,
  location?: string
): { label: string; tag: string; filePath: string } {
  // Clean label: remove parenthesized filenames like "Foo (Foo.tsx)"
  let label = rawLabel.replace(/\s*\([^)]*\.\w+\)\s*$/, '').trim();
  // Remove trailing code snippets (e.g. "text-gray-300 on bg-white …")
  label = label.replace(/\s+text-\S+.*$/, '').trim();
  // Remove any other trailing snippet-like text after the component name (e.g. " on bg-white in…")
  label = label.replace(/\s+on\s+bg-\S+.*$/, '').trim();
  // Deduplicate if tag is repeated in label (e.g. "Submit Form button" with tag "button")
  // We keep the label as-is since it may intentionally contain the word
  const tag = rawTag;
  const filePath = extractFilePath(location);
  return { label: label || rawLabel, tag, filePath };
}

/** Parse A2 elementRef string: "Label (type) — path" or "[Label type] — path" */
function parseA2ElementRef(ref: string): { label: string; tag: string; filePath: string } {
  // Strip brackets
  let cleaned = ref.replace(/^\[/, '').replace(/\]/, '');
  // Split on " — "
  const dashIdx = cleaned.indexOf(' — ');
  let namePart = dashIdx >= 0 ? cleaned.slice(0, dashIdx).trim() : cleaned.trim();
  const rawPath = dashIdx >= 0 ? cleaned.slice(dashIdx + 3).trim() : 'Unknown';
  // Extract filename only from path
  const fileMatch = rawPath.match(/([\w.-]+\.\w+)(?:\s|$)/);
  const filePath = fileMatch ? fileMatch[1] : rawPath.split('/').pop() || rawPath;

  // Try to extract (type) from end
  const parenMatch = namePart.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    return { label: parenMatch[1].trim(), tag: parenMatch[2].trim(), filePath };
  }
  // Fallback: last word is tag if it's a known HTML tag
  const words = namePart.split(/\s+/);
  if (words.length >= 2) {
    const lastWord = words[words.length - 1].toLowerCase();
    const htmlTags = ['button', 'div', 'a', 'input', 'select', 'textarea', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'label'];
    if (htmlTags.includes(lastWord)) {
      return { label: words.slice(0, -1).join(' '), tag: lastWord, filePath };
    }
  }
  return { label: namePart, tag: 'element', filePath };
}

/** Extract a section from a prompt string by header label */
function extractSection(prompt: string, header: string): string {
  const idx = prompt.indexOf(header);
  if (idx < 0) return prompt;
  const after = prompt.slice(idx + header.length).trim();
  // Find next section header
  const nextHeaders = ['Issue reason:', 'Recommended fix:'];
  let end = after.length;
  for (const nh of nextHeaders) {
    if (nh === header) continue;
    const nhIdx = after.indexOf(nh);
    if (nhIdx > 0 && nhIdx < end) end = nhIdx;
  }
  return after.slice(0, end).trim();
}

interface CorrectivePromptsSectionProps {
  violations: Violation[];
}

export function CorrectivePromptsSection({ violations }: CorrectivePromptsSectionProps) {
  const [copied, setCopied] = useState(false);

  // ONLY include confirmed violations - potential risks don't get corrective prompts
  const confirmedViolations = violations.filter(v => v.status === 'confirmed' || v.status !== 'potential');

  // Group prompts by rule code, with element references for traceability
  const groupedPrompts = (() => {
    const ruleGroups = new Map<string, {
      ruleId: string;
      ruleName: string;
      category: string;
      prompts: Array<{
        prompt: string;
        elementRef?: string;
      }>;
      a1Items?: A1ElementSubItem[];
      a3Items?: A3ElementSubItem[];
      a4Items?: A4ElementSubItem[];
      a5Items?: A5ElementSubItem[];
      a6Items?: A6ElementSubItem[];
      u1Items?: U1ElementSubItem[];
    }>();

    for (const v of confirmedViolations) {
      if (v.ruleId === 'A1' && v.isA1Aggregated && v.a1Elements) {
        if (!ruleGroups.has('A1')) {
          ruleGroups.set('A1', {
            ruleId: 'A1',
            ruleName: v.ruleName,
            category: v.category,
            prompts: [],
            a1Items: [],
          });
        }
        const group = ruleGroups.get('A1')!;
        if (v.status === 'confirmed') {
          for (const el of v.a1Elements) {
            group.a1Items!.push(el);
          }
        }
    } else if (v.ruleId === 'A2' && v.isA2Aggregated && v.a2Elements) {
        if (!ruleGroups.has('A2')) {
          ruleGroups.set('A2', {
            ruleId: 'A2',
            ruleName: v.ruleName,
            category: v.category,
            prompts: [],
          });
        }
        const group = ruleGroups.get('A2')!;
        for (const el of v.a2Elements) {
          if (el.correctivePrompt) {
            const elementRef = [
              el.elementLabel,
              el.elementType ? `(${el.elementType})` : null,
              el.location ? `— ${el.location}` : null,
            ].filter(Boolean).join(' ');
            group.prompts.push({
              prompt: el.correctivePrompt,
              elementRef: elementRef || el.elementLabel,
            });
          }
        }
      } else if (v.ruleId === 'A3') {
        // A3 ALWAYS uses per-element rendering — never the generic correctivePrompt string
        if (!ruleGroups.has('A3')) {
          ruleGroups.set('A3', {
            ruleId: 'A3',
            ruleName: v.ruleName,
            category: v.category,
            prompts: [],
            a3Items: [],
          });
        }
        const group = ruleGroups.get('A3')!;
        if (v.isA3Aggregated && v.a3Elements) {
          for (const el of v.a3Elements) {
            if (el.classification === 'confirmed') {
              group.a3Items!.push(el);
            }
          }
        } else if (v.status === 'confirmed' || v.status !== 'potential') {
          // Non-aggregated A3: synthesize a single element from top-level fields
          group.a3Items!.push({
            elementLabel: v.contextualHint || v.evidence || v.ruleName,
            elementType: 'div',
            role: '',
            location: v.evidence || '',
            explanation: v.diagnosis || '',
            confidence: v.confidence,
            correctivePrompt: v.correctivePrompt,
            deduplicationKey: `${v.ruleId}-${v.evidence || 'fallback'}`,
            classification: 'confirmed',
            detection: v.diagnosis || '',
            sourceLabel: v.contextualHint || '',
            textSnippet: '',
          } as A3ElementSubItem);
        }
      } else if (v.ruleId === 'A4') {
        // A4 ALWAYS uses per-element rendering — never the generic correctivePrompt string
        if (!ruleGroups.has('A4')) {
          ruleGroups.set('A4', {
            ruleId: 'A4',
            ruleName: v.ruleName,
            category: v.category,
            prompts: [],
            a4Items: [],
          });
        }
        const group = ruleGroups.get('A4')!;
        if (v.isA4Aggregated && v.a4Elements) {
          for (const el of v.a4Elements) {
            if (el.classification === 'confirmed') {
              group.a4Items!.push(el);
            }
          }
        } else if (v.status === 'confirmed' || v.status !== 'potential') {
          group.a4Items!.push({
            elementLabel: v.contextualHint || v.evidence || v.ruleName,
            elementType: 'div',
            location: v.evidence || '',
            explanation: v.diagnosis || '',
            confidence: v.confidence,
            correctivePrompt: v.correctivePrompt,
            deduplicationKey: `${v.ruleId}-${v.evidence || 'fallback'}`,
            classification: 'confirmed',
            subCheck: 'A4.1',
            subCheckLabel: 'Heading semantics',
          } as A4ElementSubItem);
        }
      } else if (v.ruleId === 'A5') {
        // A5 uses per-element rendering — only confirmed sub-checks (A5.1–A5.3)
        if (!ruleGroups.has('A5')) {
          ruleGroups.set('A5', {
            ruleId: 'A5',
            ruleName: v.ruleName,
            category: v.category,
            prompts: [],
            a5Items: [],
          });
        }
        const group = ruleGroups.get('A5')!;
        if (v.isA5Aggregated && v.a5Elements) {
          for (const el of v.a5Elements) {
            if (el.classification === 'confirmed') {
              group.a5Items!.push(el);
            }
          }
        } else if (v.status === 'confirmed' || v.status !== 'potential') {
          group.a5Items!.push({
            elementLabel: v.contextualHint || v.evidence || v.ruleName,
            elementType: 'input',
            location: v.evidence || '',
            explanation: v.diagnosis || '',
            confidence: v.confidence,
            correctivePrompt: v.correctivePrompt,
            deduplicationKey: `${v.ruleId}-${v.evidence || 'fallback'}`,
            classification: 'confirmed',
            subCheck: 'A5.1',
            subCheckLabel: 'Missing label association',
          } as A5ElementSubItem);
        }
      } else if (v.ruleId === 'A6') {
        // A6 uses per-element rendering — only confirmed sub-checks (A6.1–A6.2)
        if (!ruleGroups.has('A6')) {
          ruleGroups.set('A6', {
            ruleId: 'A6',
            ruleName: v.ruleName,
            category: v.category,
            prompts: [],
            a6Items: [],
          });
        }
        const group = ruleGroups.get('A6')!;
        if (v.isA6Aggregated && v.a6Elements) {
          for (const el of v.a6Elements) {
            if (el.classification === 'confirmed') {
              group.a6Items!.push(el);
            }
          }
        } else if (v.status === 'confirmed' || v.status !== 'potential') {
          group.a6Items!.push({
            elementLabel: v.contextualHint || v.evidence || v.ruleName,
            elementType: 'button',
            location: v.evidence || '',
            explanation: v.diagnosis || '',
            correctivePrompt: v.correctivePrompt,
            deduplicationKey: `${v.ruleId}-${v.evidence || 'fallback'}`,
            classification: 'confirmed',
            subCheck: 'A6.1',
            subCheckLabel: 'Missing accessible name',
            wcagCriteria: ['4.1.2'],
          } as A6ElementSubItem);
        }
      } else if (v.ruleId === 'U1' && v.isU1Aggregated && v.u1Elements && v.status === 'confirmed') {
        // U1 confirmed only (U1.1) — potential U1.2/U1.3 do NOT get corrective prompts
        if (!ruleGroups.has('U1')) {
          ruleGroups.set('U1', {
            ruleId: 'U1',
            ruleName: v.ruleName,
            category: v.category,
            prompts: [],
            u1Items: [],
          });
        }
        const group = ruleGroups.get('U1')!;
        for (const el of v.u1Elements) {
          if (el.classification === 'confirmed' && el.subCheck === 'U1.1') {
            group.u1Items!.push(el);
          }
        }
      } else if (v.correctivePrompt) {
        const key = v.ruleId;
        if (!ruleGroups.has(key)) {
          ruleGroups.set(key, {
            ruleId: v.ruleId,
            ruleName: v.ruleName,
            category: v.category,
            prompts: [],
          });
        }
        const group = ruleGroups.get(key)!;
        const existing = group.prompts.find(p => p.prompt === v.correctivePrompt);
        if (!existing) {
          group.prompts.push({
            prompt: v.correctivePrompt,
            elementRef: v.contextualHint || v.evidence,
          });
        }
      }
    }

    return Array.from(ruleGroups.values()).filter(g => g.prompts.length > 0 || (g.a1Items && g.a1Items.length > 0) || (g.a3Items && g.a3Items.length > 0) || (g.a4Items && g.a4Items.length > 0) || (g.a5Items && g.a5Items.length > 0) || (g.a6Items && g.a6Items.length > 0) || (g.u1Items && g.u1Items.length > 0));
  })();

  const copyPrompt = async () => {
    if (!groupedPrompts.length) return;

    const grouped: Record<string, typeof groupedPrompts> = {};
    for (const item of groupedPrompts) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }

    let text = 'Please revise the UI design to address the following issues:\n';
    const categoryOrder = ['accessibility', 'usability', 'ethics'];

    for (const cat of categoryOrder) {
      if (!grouped[cat]?.length) continue;
      text += `\n${categoryLabels[cat]}:\n`;
      for (const ruleGroup of grouped[cat]) {
        text += `\n[${ruleGroup.ruleId}] ${ruleGroup.ruleName}:\n`;
        if (ruleGroup.ruleId === 'A1' && ruleGroup.a1Items?.length) {
          for (const el of ruleGroup.a1Items) {
            const { label, tag, filePath } = extractLocationParts(
              el.elementLabel || el.textSnippet || 'Text element',
              el.jsxTag || 'text',
              el.location
            );
            const { issueReason, recommendedFix } = buildA1PromptBody(el);
            text += `\n${label} (${tag}) — ${filePath}\n\nIssue reason:\n${issueReason}\n\nRecommended fix:\n${recommendedFix}\n`;
          }
        } else if (ruleGroup.ruleId === 'A3' && ruleGroup.a3Items?.length) {
          for (const el of ruleGroup.a3Items) {
            const { label, tag, filePath } = extractLocationParts(
              el.accessibleName || el.elementLabel || el.sourceLabel || el.textSnippet || 'Interactive element',
              el.elementType || el.role || 'div',
              el.location
            );
            const { issueReason, recommendedFix } = buildA3PromptBody(el);
            text += `\n${label} (${tag}) — ${filePath}\n\nIssue reason:\n${issueReason}\n\nRecommended fix:\n${recommendedFix}\n`;
          }
        } else if (ruleGroup.ruleId === 'A4' && ruleGroup.a4Items?.length) {
          for (const el of ruleGroup.a4Items) {
            const { label, tag, filePath } = extractLocationParts(
              el.elementLabel || el.sourceLabel || 'Element',
              el.elementType || 'element',
              el.location
            );
            const { issueReason, recommendedFix } = buildA4PromptBody(el);
            text += `\n${label} (${tag}) — ${filePath}\n\nIssue reason:\n${issueReason}\n\nRecommended fix:\n${recommendedFix}\n`;
          }
        } else if (ruleGroup.ruleId === 'A5' && ruleGroup.a5Items?.length) {
          for (const el of ruleGroup.a5Items) {
            const { label, tag, filePath } = extractLocationParts(
              el.elementLabel || el.sourceLabel || 'Form control',
              el.elementType || 'input',
              el.location
            );
            const { issueReason, recommendedFix } = buildA5PromptBody(el);
            text += `\n${label} (${tag}) — ${filePath}\n\nIssue reason:\n${issueReason}\n\nRecommended fix:\n${recommendedFix}\n`;
          }
        } else if (ruleGroup.ruleId === 'A6' && ruleGroup.a6Items?.length) {
          for (const el of ruleGroup.a6Items) {
            const { label, tag, filePath } = extractLocationParts(
              el.elementLabel || el.sourceLabel || 'Interactive element',
              el.elementType || 'button',
              el.location
            );
            const { issueReason, recommendedFix } = buildA6PromptBody(el);
            text += `\n${label} (${tag}) — ${filePath}\n\nIssue reason:\n${issueReason}\n\nRecommended fix:\n${recommendedFix}\n`;
          }
        } else if (ruleGroup.ruleId === 'U1' && ruleGroup.u1Items?.length) {
          for (const el of ruleGroup.u1Items) {
            const { label, tag, filePath } = extractLocationParts(
              el.elementLabel || 'Form element',
              el.elementType || 'form',
              el.location
            );
            const { issueReason, recommendedFix } = buildU1PromptBody(el);
            text += `\n${label} (${tag}) — ${filePath}\n\nIssue reason:\n${issueReason}\n\nRecommended fix:\n${recommendedFix}\n`;
          }
        } else {
          for (const item of ruleGroup.prompts) {
            if (item.elementRef) {
              text += `  • ${item.elementRef}\n`;
            }
            text += `    ${item.prompt.replace(/\n/g, '\n    ')}\n`;
          }
        }
      }
    }

    try {
      await navigator.clipboard.writeText(text.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (groupedPrompts.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Corrective Prompts</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={copyPrompt}
          className="gap-2 print:hidden"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copy All
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {groupedPrompts.map((group, idx) => (
          <div key={idx} className="space-y-3 pb-4 border-b border-border last:border-0 last:pb-0">
            {/* Rule header */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                'category-badge flex-shrink-0 text-xs',
                categoryColors[group.category]
              )}>
                {group.ruleId}
              </span>
              <span className="text-sm font-medium">{group.ruleName}</span>
              {group.prompts.length > 1 && (
                <Badge variant="outline" className="text-xs">
                  {group.prompts.length} elements
                </Badge>
              )}
            </div>

            {/* Individual prompts with element references */}
            <div className="space-y-3">
              {group.ruleId === 'A1' && group.a1Items ? (
                group.a1Items.map((el, pIdx) => {
                  const { label, tag, filePath } = extractLocationParts(
                    el.elementLabel || el.textSnippet || 'Text element',
                    el.jsxTag || 'text',
                    el.location
                  );
                  const { issueReason, recommendedFix } = buildA1PromptBody(el);
                  return (
                    <CorrectivePromptItem
                      key={pIdx}
                      elementLabel={label}
                      roleOrTag={tag}
                      fileName={filePath}
                      issueReason={issueReason}
                      recommendedFix={recommendedFix}
                    />
                  );
                })
              ) : group.ruleId === 'A2' ? (
                group.prompts.map((item, pIdx) => {
                  const parts = parseA2ElementRef(item.elementRef || '');
                  return (
                    <CorrectivePromptItem
                      key={pIdx}
                      elementLabel={parts.label}
                      roleOrTag={parts.tag}
                      fileName={parts.filePath}
                      issueReason={extractSection(item.prompt, 'Issue reason:')}
                      recommendedFix={extractSection(item.prompt, 'Recommended fix:')}
                    />
                  );
                })
              ) : group.ruleId === 'A3' && group.a3Items ? (
                group.a3Items.map((el, pIdx) => {
                  const { label, tag, filePath } = extractLocationParts(
                    el.accessibleName || el.elementLabel || el.sourceLabel || el.textSnippet || 'Interactive element',
                    el.elementType || el.role || 'div',
                    el.location
                  );
                  const { issueReason, recommendedFix } = buildA3PromptBody(el);
                  return (
                    <CorrectivePromptItem
                      key={pIdx}
                      elementLabel={label}
                      roleOrTag={tag}
                      fileName={filePath}
                      issueReason={issueReason}
                      recommendedFix={recommendedFix}
                    />
                  );
                })
              ) : group.ruleId === 'A4' && group.a4Items ? (
                group.a4Items.map((el, pIdx) => {
                  const { label, tag, filePath } = extractLocationParts(
                    el.elementLabel || el.sourceLabel || 'Element',
                    el.elementType || 'element',
                    el.location
                  );
                  const { issueReason, recommendedFix } = buildA4PromptBody(el);
                  return (
                    <CorrectivePromptItem
                      key={pIdx}
                      elementLabel={label}
                      roleOrTag={tag}
                      fileName={filePath}
                      issueReason={issueReason}
                      recommendedFix={recommendedFix}
                    />
                  );
                })
              ) : group.ruleId === 'A5' && group.a5Items ? (
                group.a5Items.map((el, pIdx) => {
                  const { label, tag, filePath } = extractLocationParts(
                    el.elementLabel || el.sourceLabel || 'Form control',
                    el.elementType || 'input',
                    el.location
                  );
                  const { issueReason, recommendedFix } = buildA5PromptBody(el);
                  return (
                    <CorrectivePromptItem
                      key={pIdx}
                      elementLabel={label}
                      roleOrTag={tag}
                      fileName={filePath}
                      issueReason={issueReason}
                      recommendedFix={recommendedFix}
                    />
                  );
                })
              ) : group.ruleId === 'A6' && group.a6Items ? (
                group.a6Items.map((el, pIdx) => {
                  const { label, tag, filePath } = extractLocationParts(
                    el.elementLabel || el.sourceLabel || 'Interactive element',
                    el.elementType || 'button',
                    el.location
                  );
                  const { issueReason, recommendedFix } = buildA6PromptBody(el);
                  return (
                    <CorrectivePromptItem
                      key={pIdx}
                      elementLabel={label}
                      roleOrTag={tag}
                      fileName={filePath}
                      issueReason={issueReason}
                      recommendedFix={recommendedFix}
                    />
                  );
                })
              ) : group.ruleId === 'U1' && group.u1Items ? (
                group.u1Items.map((el, pIdx) => {
                  const { label, tag, filePath } = extractLocationParts(
                    el.elementLabel || 'Form element',
                    el.elementType || 'form',
                    el.location
                  );
                  const { issueReason, recommendedFix } = buildU1PromptBody(el);
                  return (
                    <CorrectivePromptItem
                      key={pIdx}
                      elementLabel={label}
                      roleOrTag={tag}
                      fileName={filePath}
                      issueReason={issueReason}
                      recommendedFix={recommendedFix}
                    />
                  );
                })
              ) : (
                group.prompts.map((item, pIdx) => (
                  <div key={pIdx} className="space-y-1">
                    {item.elementRef && (
                      <p className="text-xs text-muted-foreground font-medium pl-1">
                        📍 {item.elementRef}
                      </p>
                    )}
                    <div className="text-sm bg-primary/5 p-3 rounded border-l-2 border-primary whitespace-pre-line">
                      {item.prompt}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
