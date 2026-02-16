import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A6ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface A6AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

const SUB_CHECK_LABELS: Record<string, string> = {
  'A6.1': 'Missing accessible name',
  'A6.2': 'Broken aria-labelledby reference',
};

function A6ElementItem({ element, compact = false, cardDiagnosis }: {
  element: A6ElementSubItem;
  compact?: boolean;
  cardDiagnosis?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.sourceLabel || element.elementLabel;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn(
        'rounded-lg border space-y-2 bg-destructive/5 border-destructive/20',
        compact ? 'p-2' : 'p-3'
      )}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-start justify-between gap-2 cursor-pointer">
            <div className="flex items-center gap-2 flex-wrap text-left">
              <span className={cn('font-medium', compact ? 'text-sm' : '')}>
                {displayLabel}
              </span>
              {element.elementType && (
                <span className={cn(
                  'text-muted-foreground italic truncate max-w-48',
                  compact ? 'text-xs' : 'text-sm'
                )}>
                  {element.elementType}{element.role ? ` [${element.role}]` : ''}
                </span>
              )}
              <Badge variant="outline" className="text-xs border-muted-foreground/30 text-muted-foreground">
                {element.subCheck}
              </Badge>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        <div className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          <span className="font-medium">📍 </span>
          {element.location}
        </div>

        <CollapsibleContent>
          <div className={cn('space-y-2 pt-2 border-t border-border/50', compact ? 'text-xs' : 'text-sm')}>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-20">Sub-check:</span>
              <span>{element.subCheckLabel || SUB_CHECK_LABELS[element.subCheck] || element.subCheck}</span>
            </div>

            {element.detection && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-20">Detection:</span>
                <span className="font-mono">{element.detection}</span>
              </div>
            )}

            {element.evidence && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-20">Evidence:</span>
                <span className="font-mono text-xs">{element.evidence}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-20">Confidence:</span>
              <span className="font-mono font-medium text-destructive">
                {Math.round(element.confidence * 100)}%
              </span>
            </div>

            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-20">Requirement:</span>
              <span>WCAG 2.1 — 4.1.2 Name, Role, Value (Level A)</span>
            </div>

            {element.explanation && element.explanation !== cardDiagnosis && (
              <div className="pt-1">
                <p className="text-foreground leading-relaxed">{element.explanation}</p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function A6AggregatedCard({ violation, compact = false }: A6AggregatedCardProps) {
  const rawElements: A6ElementSubItem[] = (violation.isA6Aggregated && violation.a6Elements)
    ? violation.a6Elements
    : [{
        elementLabel: violation.evidence || violation.diagnosis?.split('.')[0] || 'Interactive element',
        elementType: undefined,
        location: violation.evidence || '',
        detection: undefined,
        evidence: violation.evidence,
        subCheck: 'A6.1',
        subCheckLabel: 'Missing accessible name',
        classification: 'confirmed',
        explanation: violation.diagnosis || '',
        confidence: violation.confidence,
        correctivePrompt: violation.correctivePrompt,
        deduplicationKey: `${violation.ruleId}-fallback`,
      }];

  // Suppress A6.1 for elements that also have A6.2 (A6.2 takes precedence)
  const a62Keys = new Set(
    rawElements.filter(el => el.subCheck === 'A6.2').map(el => el.deduplicationKey?.replace('-A6.2', '') ?? el.elementLabel)
  );
  const elements = rawElements.filter(el => {
    if (el.subCheck !== 'A6.1') return true;
    const baseKey = el.deduplicationKey?.replace('-A6.1', '') ?? el.elementLabel;
    return !a62Keys.has(baseKey);
  });

  return (
    <Card className="border border-destructive/30">
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap text-base">
          <span className="category-badge flex-shrink-0 text-xs category-accessibility">
            A6
          </span>
          <span className="font-bold text-base">Missing Accessible Names</span>
          <Badge className="gap-1 text-xs bg-destructive/10 text-destructive border-destructive/30">
            {elements.length} element{elements.length !== 1 ? 's' : ''}
          </Badge>
        </CardTitle>
        <p className={cn('text-muted-foreground', compact ? 'text-xs mt-2' : 'text-sm mt-2')}>
          {violation.diagnosis}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((element, idx) => (
          <A6ElementItem
            key={element.deduplicationKey || idx}
            element={element}
            compact={compact}
            cardDiagnosis={violation.diagnosis}
          />
        ))}
      </CardContent>
    </Card>
  );
}
