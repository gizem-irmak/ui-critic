import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Violation } from '@/types/project';

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
      } else if (v.ruleId === 'A3' && v.isA3Aggregated && v.a3Elements) {
        if (!ruleGroups.has('A3')) {
          ruleGroups.set('A3', {
            ruleId: 'A3',
            ruleName: v.ruleName,
            category: v.category,
            prompts: [],
          });
        }
        const group = ruleGroups.get('A3')!;
        for (const el of v.a3Elements) {
          if (el.correctivePrompt) {
            // A3 correctivePrompt already contains the full formatted block
            // (header line, issue reason, recommended fix) — no separate elementRef needed
            group.prompts.push({
              prompt: el.correctivePrompt,
            });
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

    return Array.from(ruleGroups.values()).filter(g => g.prompts.length > 0);
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
        for (const item of ruleGroup.prompts) {
          if (ruleGroup.ruleId === 'A3' && !item.elementRef) {
            // A3 prompts are self-contained blocks — render directly
            text += `\n${item.prompt}\n`;
          } else {
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
              {group.prompts.map((item, pIdx) => (
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
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
