import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A5ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { LocationBadge } from './LocationBadge';

interface A5AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

function A5ElementItem({ element, isConfirmed, compact = false }: {
  element: A5ElementSubItem;
  isConfirmed: boolean;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.sourceLabel || element.elementLabel;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn(
        'rounded-lg border space-y-0',
        isConfirmed
          ? 'bg-destructive/5 border-destructive/20'
          : 'bg-warning/5 border-warning/20',
        compact ? 'p-2' : 'p-3'
      )}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-2 cursor-pointer">
            <span className={cn('font-medium text-left', compact ? 'text-sm' : '')}>
              {displayLabel}
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <LocationBadge filePath={element.filePath || element.location} compact={compact} />
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className={cn('space-y-2 pt-2 mt-2 border-t border-border/50', compact ? 'text-xs' : 'text-sm')}>

            {/* Element */}
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-24 flex-shrink-0">Element:</span>
              <span className="font-mono text-xs">
                {element.elementType || 'unknown'}
                {element.inputSubtype ? ` [${element.inputSubtype}]` : ''}
                {element.controlId ? ` — id="${element.controlId}"` : ' — id: (none)'}
                {(element.selectorHints || []).filter(h => !h.startsWith('id=')).map((hint, i) => (
                  <span key={i}> — {hint}</span>
                ))}
              </span>
            </div>

            {/* Labeling method */}
            {element.labelingMethod && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-24 flex-shrink-0">Labeling:</span>
                <span className={cn(
                  'font-mono text-xs',
                  element.labelingMethod === 'none' || element.labelingMethod?.startsWith('none')
                    ? 'text-destructive'
                    : element.labelingMethod?.startsWith('broken')
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                )}>
                  {element.labelingMethod}
                </span>
              </div>
            )}

            {/* Detection */}
            {element.detection && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-24 flex-shrink-0">Detection:</span>
                <span className="font-mono text-xs">{element.detection}</span>
              </div>
            )}

            {/* Requirement */}
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-24 flex-shrink-0">Requirement:</span>
              <span>WCAG 2.1 — {(element.wcagCriteria || ['1.3.1', '3.3.2']).join(' / ')} (Level A)</span>
            </div>

            {/* Confidence — only for potential findings */}
            {!isConfirmed && element.confidence != null && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-24 flex-shrink-0">Confidence:</span>
                <span className="font-mono font-medium text-warning">
                  {Math.round(element.confidence * 100)}%
                </span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function A5AggregatedCard({ violation, compact = false }: A5AggregatedCardProps) {
  const isConfirmed = violation.status !== 'potential';

  const elements: A5ElementSubItem[] = (violation.isA5Aggregated && violation.a5Elements)
    ? violation.a5Elements
    : [{
        elementKey: `${violation.ruleId}-fallback`,
        elementLabel: violation.evidence || violation.diagnosis?.split('.')[0] || 'Form control',
        elementType: undefined,
        location: violation.evidence || '',
        detection: undefined,
        evidence: violation.evidence,
        subCheck: 'A5.1' as const,
        subCheckLabel: 'Missing label association',
        classification: isConfirmed ? 'confirmed' as const : 'potential' as const,
        explanation: violation.diagnosis || '',
        confidence: isConfirmed ? undefined : violation.confidence,
        wcagCriteria: ['1.3.1', '3.3.2'],
        correctivePrompt: violation.correctivePrompt,
        deduplicationKey: `${violation.ruleId}-fallback`,
      }];

  return (
    <Card className={cn(
      'border',
      isConfirmed ? 'border-destructive/30' : 'border-warning/30'
    )}>
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap text-base">
          <span className={cn(
            'category-badge flex-shrink-0 text-xs',
            isConfirmed ? 'category-accessibility' : 'bg-warning/10 text-warning border border-warning/20'
          )}>
            A5
          </span>
          <span className="font-bold text-base">Missing Form Labels</span>
          <Badge className={cn(
            "gap-1 text-xs",
            isConfirmed
              ? "bg-destructive/10 text-destructive border-destructive/30"
              : "bg-warning/10 text-warning border-warning/30"
          )}>
            {elements.length} element{elements.length !== 1 ? 's' : ''}
          </Badge>
        </CardTitle>
        <p className={cn('text-muted-foreground', compact ? 'text-xs mt-2' : 'text-sm mt-2')}>
          Form controls lack programmatic labels required by WCAG 1.3.1 and 3.3.2.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((element, idx) => (
          <A5ElementItem
            key={element.deduplicationKey || idx}
            element={element}
            isConfirmed={element.classification === 'confirmed'}
            compact={compact}
          />
        ))}
      </CardContent>
    </Card>
  );
}
