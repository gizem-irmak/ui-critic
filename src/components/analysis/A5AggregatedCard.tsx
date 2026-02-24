import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A5ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PotentialSubtypeBadge, SubtypeAdvisoryGuidance } from './PotentialSubtypeUI';

interface A5AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

const SUB_CHECK_LABELS: Record<string, string> = {
  'A5.1': 'Missing label association',
  'A5.2': 'Placeholder used as label',
  'A5.3': 'Broken label association',
  'A5.4': 'Generic label text',
  'A5.5': 'Duplicate label text',
  'A5.6': 'Noisy aria-labelledby',
};

function A5ElementItem({ element, isConfirmed, compact = false, cardDiagnosis }: {
  element: A5ElementSubItem;
  isConfirmed: boolean;
  compact?: boolean;
  cardDiagnosis?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.sourceLabel || element.elementLabel;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn(
        'rounded-lg border space-y-2',
        isConfirmed
          ? 'bg-destructive/5 border-destructive/20'
          : 'bg-warning/5 border-warning/20',
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
                  {element.elementType}{element.inputSubtype ? `[${element.inputSubtype}]` : ''}
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

            {/* Confidence — only for potential findings */}
            {!isConfirmed && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-20">Confidence:</span>
                <span className="font-mono font-medium text-warning">
                  {Math.round(element.confidence * 100)}%
                </span>
              </div>
            )}

            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-20">Requirement:</span>
              <span>WCAG 2.1 — 1.3.1 / 3.3.2 (Level A)</span>
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

export function A5AggregatedCard({ violation, compact = false }: A5AggregatedCardProps) {
  const isConfirmed = violation.status !== 'potential';

  const elements: A5ElementSubItem[] = (violation.isA5Aggregated && violation.a5Elements)
    ? violation.a5Elements
    : [{
        elementLabel: violation.evidence || violation.diagnosis?.split('.')[0] || 'Form control',
        elementType: undefined,
        location: violation.evidence || '',
        detection: undefined,
        evidence: violation.evidence,
        subCheck: 'A5.1',
        subCheckLabel: 'Missing label association',
        classification: isConfirmed ? 'confirmed' : 'potential',
        explanation: violation.diagnosis || '',
        confidence: violation.confidence,
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
          {violation.diagnosis}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((element, idx) => (
          <A5ElementItem
            key={element.deduplicationKey || idx}
            element={element}
            isConfirmed={isConfirmed}
            compact={compact}
            cardDiagnosis={violation.diagnosis}
          />
        ))}

        {!isConfirmed && (
          <SubtypeAdvisoryGuidance
            ruleId="A5"
            potentialSubtype={violation.potentialSubtype}
            fallbackGuidance={violation.advisoryGuidance}
            compact={compact}
          />
        )}
      </CardContent>
    </Card>
  );
}
