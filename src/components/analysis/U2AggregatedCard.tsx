import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { LocationBadge } from './LocationBadge';
import type { Violation, U2ElementSubItem } from '@/types/project';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue, ConfidenceValue, AdvisoryBlock,
} from './CardTypography';

function U2ElementItem({ element, compact = false }: {
  element: U2ElementSubItem;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.elementLabel || 'Navigation structure';

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
                <FieldValue mono>{element.detection}</FieldValue>
              </FieldRow>
            )}

            {element.evidence && (
              <FieldRow>
                <FieldLabel>Evidence:</FieldLabel>
                <FieldValue mono>{element.evidence}</FieldValue>
              </FieldRow>
            )}

            {element.confidence != null && (
              <FieldRow>
                <FieldLabel>Confidence:</FieldLabel>
                <ConfidenceValue value={element.confidence} />
              </FieldRow>
            )}

            {element.advisoryGuidance && (
              <AdvisoryBlock compact={compact}>{element.advisoryGuidance}</AdvisoryBlock>
            )}
          </DetailContainer>
        </CollapsibleContent>
      </ElementItemWrapper>
    </Collapsible>
  );
}

interface U2AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

export function U2AggregatedCard({ violation, compact = false }: U2AggregatedCardProps) {
  const elements: U2ElementSubItem[] = (violation.isU2Aggregated && violation.u2Elements)
    ? violation.u2Elements
    : [{
        elementLabel: violation.evidence?.split('.')[0] || 'Navigation structure',
        elementType: 'nav',
        location: violation.evidence || 'Unknown',
        detection: violation.diagnosis || '',
        evidence: violation.evidence || '',
        subCheck: 'U2.D1' as const,
        subCheckLabel: 'No navigation container',
        confidence: violation.confidence,
        advisoryGuidance: violation.advisoryGuidance || violation.contextualHint,
        deduplicationKey: `${violation.ruleId}-fallback`,
      }];

  return (
    <Card className="border border-warning/30">
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <RuleIdBadge ruleId="U2" isConfirmed={false} categoryClass="category-usability" />
          <RuleHeader ruleId="U2" title="Incomplete / Unclear Navigation" />
          <ElementCountBadge count={elements.length} isConfirmed={false} />
        </CardTitle>
        <CardDescription compact={compact}>
          Static analysis flagged a potential navigation clarity risk; verify in context.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((el, idx) => (
          <U2ElementItem
            key={el.deduplicationKey || idx}
            element={el}
            compact={compact}
          />
        ))}

        {!elements.some(el => el.advisoryGuidance) && (violation.advisoryGuidance || violation.contextualHint) && (
          <AdvisoryBlock compact={compact}>{violation.advisoryGuidance || violation.contextualHint}</AdvisoryBlock>
        )}
      </CardContent>
    </Card>
  );
}
