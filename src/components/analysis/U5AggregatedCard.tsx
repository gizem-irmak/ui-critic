import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { LocationBadge } from './LocationBadge';
import type { Violation, U5ElementSubItem } from '@/types/project';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue, ConfidenceValue, AdvisoryBlock,
} from './CardTypography';

function U5ElementItem({ element, compact = false }: {
  element: U5ElementSubItem;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.elementLabel || 'Interactive element';

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
          </DetailContainer>
        </CollapsibleContent>
      </ElementItemWrapper>
    </Collapsible>
  );
}

interface U5AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

export function U5AggregatedCard({ violation, compact = false }: U5AggregatedCardProps) {
  const elements: U5ElementSubItem[] = (violation.isU5Aggregated && violation.u5Elements)
    ? violation.u5Elements
    : [{
        elementLabel: violation.evidence?.split('.')[0] || 'Interactive element',
        elementType: 'button',
        location: violation.evidence || 'Unknown',
        detection: violation.diagnosis || '',
        evidence: violation.evidence || '',
        confidence: violation.confidence,
        deduplicationKey: `${violation.ruleId}-fallback`,
      }];

  const hasVisionItems = elements.some(e => e.evaluationMethod === 'vision_llm');
  const headerExplanation = hasVisionItems
    ? 'Visual analysis flagged potential missing interaction feedback; verify by interacting.'
    : 'Static analysis flagged potential missing interaction feedback (loading/state/confirmation); verify in context.';

  return (
    <Card className="border border-warning/30">
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <RuleIdBadge ruleId="U5" isConfirmed={false} categoryClass="category-usability" />
          <RuleHeader ruleId="U5" title="Insufficient Interaction Feedback" />
          <ElementCountBadge count={elements.length} isConfirmed={false} />
        </CardTitle>
        <CardDescription compact={compact}>
          {headerExplanation}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((el, idx) => (
          <U5ElementItem
            key={el.deduplicationKey || idx}
            element={el}
            compact={compact}
          />
        ))}

        <AdvisoryBlock compact={compact}>
          {violation.advisoryGuidance || violation.contextualHint || 'Provide loading/progress state, disable controls during async actions, and show success/error confirmation.'}
        </AdvisoryBlock>
      </CardContent>
    </Card>
  );
}
