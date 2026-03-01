import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A5ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { LocationBadge } from './LocationBadge';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue, ConfidenceValue,
} from './CardTypography';

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
      <ElementItemWrapper isConfirmed={isConfirmed} compact={compact}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-2 cursor-pointer">
            <ComponentTitle>{displayLabel}</ComponentTitle>
            <div className="flex items-center gap-2 flex-shrink-0">
              <LocationBadge filePath={element.filePath || element.location} compact={compact} startLine={element.startLine} endLine={element.endLine} />
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <DetailContainer>
            <FieldRow>
              <FieldLabel>Element:</FieldLabel>
              <FieldValue mono>
                {element.elementType || 'unknown'}
                {element.inputSubtype ? ` [${element.inputSubtype}]` : ''}
                {element.controlId ? ` — id="${element.controlId}"` : ' — id: (none)'}
                {(element.selectorHints || []).filter(h => !h.startsWith('id=')).map((hint, i) => (
                  <span key={i}> — {hint}</span>
                ))}
              </FieldValue>
            </FieldRow>

            {element.labelingMethod && (
              <FieldRow>
                <FieldLabel>Labeling:</FieldLabel>
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
              </FieldRow>
            )}

            {element.detection && (
              <FieldRow>
                <FieldLabel>Detection:</FieldLabel>
                <FieldValue mono>{element.detection}</FieldValue>
              </FieldRow>
            )}

            <FieldRow>
              <FieldLabel>Requirement:</FieldLabel>
              <FieldValue>WCAG 2.1 — {(element.wcagCriteria || ['1.3.1', '3.3.2']).join(' / ')} (Level A)</FieldValue>
            </FieldRow>

            {!isConfirmed && element.confidence != null && (
              <FieldRow>
                <FieldLabel>Confidence:</FieldLabel>
                <ConfidenceValue value={element.confidence} />
              </FieldRow>
            )}
          </DetailContainer>
        </CollapsibleContent>
      </ElementItemWrapper>
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
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <RuleIdBadge ruleId="A5" isConfirmed={isConfirmed} categoryClass="category-accessibility" />
          <RuleHeader ruleId="A5" title="Missing Form Labels" />
          <ElementCountBadge count={elements.length} isConfirmed={isConfirmed} />
        </CardTitle>
        <CardDescription compact={compact}>
          Form controls lack programmatic labels required by WCAG 1.3.1 and 3.3.2.
        </CardDescription>
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
