import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { LocationBadge } from './LocationBadge';
import type { Violation, U4ElementSubItem } from '@/types/project';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue, ConfidenceValue, AdvisoryBlock,
} from './CardTypography';

function U4ElementItem({ element, compact = false }: {
  element: U4ElementSubItem;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.elementLabel || 'UI region';

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

            {element.confidence != null && (
              <FieldRow>
                <FieldLabel>Confidence:</FieldLabel>
                <ConfidenceValue value={element.confidence} />
              </FieldRow>
            )}

            {element.recommendedFix && (
              <FieldRow>
                <FieldLabel>Fix:</FieldLabel>
                <FieldValue>{element.recommendedFix}</FieldValue>
              </FieldRow>
            )}
          </DetailContainer>
        </CollapsibleContent>
      </ElementItemWrapper>
    </Collapsible>
  );
}

interface U4AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

export function U4AggregatedCard({ violation, compact = false }: U4AggregatedCardProps) {
  const elements: U4ElementSubItem[] = (violation.isU4Aggregated && violation.u4Elements)
    ? violation.u4Elements
    : [{
        elementLabel: violation.evidence?.split('.')[0] || 'UI region',
        elementType: 'component',
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
          <RuleIdBadge ruleId="U4" isConfirmed={false} categoryClass="category-usability" />
          <RuleHeader ruleId="U4" title="Recognition-to-Recall Regression" />
          <ElementCountBadge count={elements.length} isConfirmed={false} />
        </CardTitle>
        <CardDescription compact={compact}>
          UI regions that may force users to recall information from memory instead of recognizing it from visible cues.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((el, idx) => (
          <U4ElementItem
            key={el.deduplicationKey || idx}
            element={el}
            compact={compact}
          />
        ))}

        {(violation.advisoryGuidance || violation.contextualHint) && (
          <AdvisoryBlock compact={compact}>{violation.advisoryGuidance || violation.contextualHint}</AdvisoryBlock>
        )}
      </CardContent>
    </Card>
  );
}
