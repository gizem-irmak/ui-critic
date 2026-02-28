import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { LocationBadge } from './LocationBadge';
import type { Violation, E2ElementSubItem } from '@/types/project';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue, ConfidenceValue, AdvisoryBlock,
} from './CardTypography';

function E2ElementItem({ element, compact = false }: {
  element: E2ElementSubItem;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.elementLabel || 'Choice group';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <ElementItemWrapper isConfirmed={false} compact={compact}>
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
                <FieldValue>{element.detection}</FieldValue>
              </FieldRow>
            )}

            {element.evidence && (
              <FieldRow>
                <FieldLabel>Evidence:</FieldLabel>
                <FieldValue>{element.evidence}</FieldValue>
              </FieldRow>
            )}

            {element.recommendedFix && (
              <FieldRow>
                <FieldLabel>Fix:</FieldLabel>
                <FieldValue>{element.recommendedFix}</FieldValue>
              </FieldRow>
            )}

            {element.confidence != null && (
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

interface E2AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

export function E2AggregatedCard({ violation, compact = false }: E2AggregatedCardProps) {
  const elements: E2ElementSubItem[] = (violation.isE2Aggregated && violation.e2Elements)
    ? violation.e2Elements
    : [{
        elementLabel: violation.evidence?.split('.')[0] || 'Choice group',
        elementType: 'choice-group',
        location: violation.evidence || 'Unknown',
        detection: violation.diagnosis || '',
        evidence: violation.evidence || '',
        confidence: violation.confidence,
        deduplicationKey: `${violation.ruleId}-fallback`,
      }];

  return (
    <Card className="border border-warning/30">
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <RuleIdBadge ruleId="E2" isConfirmed={false} categoryClass="category-ethics" />
          <RuleHeader ruleId="E2" title="Imbalanced or Manipulative Choice Architecture" />
          <ElementCountBadge count={elements.length} isConfirmed={false} />
        </CardTitle>
        <CardDescription compact={compact}>
          Analysis flagged a potential imbalance between choice options; verify neutrality.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((el, idx) => (
          <E2ElementItem
            key={el.deduplicationKey || idx}
            element={el}
            compact={compact}
          />
        ))}

        <AdvisoryBlock compact={compact}>
          {violation.advisoryGuidance || violation.contextualHint || 'Present choices with equal visual weight and neutral defaults. Ensure monetized or data-sharing options are not visually dominant over alternatives.'}
        </AdvisoryBlock>
      </CardContent>
    </Card>
  );
}
