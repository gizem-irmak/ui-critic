import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Violation, A3ElementSubItem, A4ElementSubItem, A5ElementSubItem } from '@/types/project';
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
      a3Items?: A3ElementSubItem[];
      a4Items?: A4ElementSubItem[];
      a5Items?: A5ElementSubItem[];
    }>();

    for (const v of confirmedViolations) {
      if (v.ruleId === 'A1' && v.isA1Aggregated && v.a1Elements) {
        if (!ruleGroups.has('A1')) {
          ruleGroups.set('A1', {
            ruleId: 'A1',
            ruleName: v.ruleName,
            category: v.category,
            prompts: [],
          });
        }
        const group = ruleGroups.get('A1')!;
        for (const el of v.a1Elements) {
          if (el.correctivePrompt) {
            const elementRef = [
              el.uiRole || el.elementLabel,
              el.textSnippet ? `'${el.textSnippet}'` : null,
              el.location ? `— ${el.location}` : null,
            ].filter(Boolean).join(' ');
            group.prompts.push({
              prompt: el.correctivePrompt,
              elementRef: elementRef || el.elementLabel,
            });
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

    return Array.from(ruleGroups.values()).filter(g => g.prompts.length > 0 || (g.a3Items && g.a3Items.length > 0) || (g.a4Items && g.a4Items.length > 0) || (g.a5Items && g.a5Items.length > 0));
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
        if (ruleGroup.ruleId === 'A3' && ruleGroup.a3Items?.length) {
          for (const el of ruleGroup.a3Items) {
            const label = el.accessibleName || el.elementLabel || el.sourceLabel || el.textSnippet || 'Interactive element';
            const tag = el.elementType || el.role || 'div';
            const fileName = el.location?.replace(/^📍\s*/, '').split('/').pop()?.split(' — ')[0] || el.location || 'Unknown';
            const { issueReason, recommendedFix } = buildA3PromptBody(el);
            text += `\n[${label} (${tag})] — ${fileName}\n\nIssue reason:\n${issueReason}\n\nRecommended fix:\n${recommendedFix}\n`;
          }
        } else if (ruleGroup.ruleId === 'A4' && ruleGroup.a4Items?.length) {
          for (const el of ruleGroup.a4Items) {
            const label = el.elementLabel || el.sourceLabel || 'Element';
            const tag = el.elementType || 'element';
            const fileName = el.location?.replace(/^📍\s*/, '').split('/').pop()?.split(' — ')[0] || el.location || 'Unknown';
            const { issueReason, recommendedFix } = buildA4PromptBody(el);
            text += `\n[${label} (${tag})] — ${fileName}\n\nIssue reason:\n${issueReason}\n\nRecommended fix:\n${recommendedFix}\n`;
          }
        } else if (ruleGroup.ruleId === 'A5' && ruleGroup.a5Items?.length) {
          for (const el of ruleGroup.a5Items) {
            const label = el.elementLabel || el.sourceLabel || 'Form control';
            const tag = el.elementType || 'input';
            const fileName = el.location?.replace(/^📍\s*/, '').split('/').pop()?.split(' — ')[0] || el.location || 'Unknown';
            const { issueReason, recommendedFix } = buildA5PromptBody(el);
            text += `\n[${label} (${tag})] — ${fileName}\n\nIssue reason:\n${issueReason}\n\nRecommended fix:\n${recommendedFix}\n`;
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
              {group.ruleId === 'A3' && group.a3Items ? (
                // A3: use CorrectivePromptItem per element — single source of truth
                group.a3Items.map((el, pIdx) => {
                  const label = el.accessibleName || el.elementLabel || el.sourceLabel || el.textSnippet || 'Interactive element';
                  const tag = el.elementType || el.role || 'div';
                  const fileName = el.location?.replace(/^📍\s*/, '').split('/').pop()?.split(' — ')[0] || el.location || 'Unknown';
                  const { issueReason, recommendedFix } = buildA3PromptBody(el);
                  return (
                    <CorrectivePromptItem
                      key={pIdx}
                      elementLabel={label}
                      roleOrTag={tag}
                      fileName={fileName}
                      issueReason={issueReason}
                      recommendedFix={recommendedFix}
                    />
                  );
                })
              ) : group.ruleId === 'A4' && group.a4Items ? (
                // A4: use CorrectivePromptItem per element
                group.a4Items.map((el, pIdx) => {
                  const label = el.elementLabel || el.sourceLabel || 'Element';
                  const tag = el.elementType || 'element';
                  const fileName = el.location?.replace(/^📍\s*/, '').split('/').pop()?.split(' — ')[0] || el.location || 'Unknown';
                  const { issueReason, recommendedFix } = buildA4PromptBody(el);
                  return (
                    <CorrectivePromptItem
                      key={pIdx}
                      elementLabel={label}
                      roleOrTag={tag}
                      fileName={fileName}
                      issueReason={issueReason}
                      recommendedFix={recommendedFix}
                    />
                  );
                })
              ) : group.ruleId === 'A5' && group.a5Items ? (
                // A5: use CorrectivePromptItem per confirmed element
                group.a5Items.map((el, pIdx) => {
                  const label = el.elementLabel || el.sourceLabel || 'Form control';
                  const tag = el.elementType || 'input';
                  const fileName = el.location?.replace(/^📍\s*/, '').split('/').pop()?.split(' — ')[0] || el.location || 'Unknown';
                  const { issueReason, recommendedFix } = buildA5PromptBody(el);
                  return (
                    <CorrectivePromptItem
                      key={pIdx}
                      elementLabel={label}
                      roleOrTag={tag}
                      fileName={fileName}
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
