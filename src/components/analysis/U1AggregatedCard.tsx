import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { LocationBadge } from './LocationBadge';
import type { Violation, U1ElementSubItem } from '@/types/project';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue, ConfidenceValue, AdvisoryBlock,
} from './CardTypography';

function U1ElementItem({ element, isConfirmed, compact = false }: {
  element: U1ElementSubItem;
  isConfirmed: boolean;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.elementLabel || 'CTA element';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <ElementItemWrapper isConfirmed={isConfirmed} compact={compact}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-2 cursor-pointer">
            <ComponentTitle>{displayLabel}</ComponentTitle>
            <div className="flex items-center gap-2 flex-shrink-0">
              <LocationBadge filePath={element.location} compact={compact} />
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
            {element.detection && (
              <FieldRow>
                <FieldLabel>Detection:</FieldLabel>
                <FieldValue mono>{element.detection}</FieldValue>
              </FieldRow>
            )}

            {element.evidence && (
              <FieldRow>
                <FieldLabel>Evidence:</FieldLabel>
                <FieldValue mono>{element.evidence}</FieldValue>
              </FieldRow>
            )}

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

interface U1AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

export function U1AggregatedCard({ violation, compact = false }: U1AggregatedCardProps) {
  const elements: U1ElementSubItem[] = (violation.isU1Aggregated && violation.u1Elements)
    ? violation.u1Elements
    : [{
        elementLabel: violation.evidence || violation.diagnosis?.split('.')[0] || 'CTA element',
        elementType: 'button',
        location: violation.evidence || 'Unknown',
        subCheck: 'U1.2' as const,
        subCheckLabel: 'Multiple equivalent CTAs',
        classification: (violation.status === 'confirmed' ? 'confirmed' : 'potential') as 'confirmed' | 'potential',
        explanation: violation.diagnosis || '',
        confidence: violation.confidence,
        advisoryGuidance: violation.advisoryGuidance,
        deduplicationKey: `${violation.ruleId}-fallback`,
      }];

  const hasConfirmed = elements.some(el => el.classification === 'confirmed');
  const hasPotential = elements.some(el => el.classification === 'potential');

  return (
    <Card className={cn(
      'border',
      hasConfirmed ? 'border-destructive/30' : 'border-warning/30'
    )}>
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <RuleIdBadge ruleId="U1" isConfirmed={hasConfirmed} categoryClass="category-usability" />
          <RuleHeader ruleId="U1" title="Unclear Primary Action" />
          <ElementCountBadge count={elements.length} isConfirmed={hasConfirmed} />
        </CardTitle>
        <CardDescription compact={compact}>
          {hasConfirmed
            ? 'Static analysis identified a structural primary-action issue that prevents clear or functional completion.'
            : 'Static analysis flagged a potential primary-action clarity risk based on CTA structure, emphasis, or labeling; verify in context.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((el, idx) => (
          <U1ElementItem
            key={el.deduplicationKey || idx}
            element={el}
            isConfirmed={el.classification === 'confirmed'}
            compact={compact}
          />
        ))}

        {hasPotential && !hasConfirmed && violation.advisoryGuidance && (
          <AdvisoryBlock compact={compact}>{violation.advisoryGuidance}</AdvisoryBlock>
        )}
      </CardContent>
    </Card>
  );
}
