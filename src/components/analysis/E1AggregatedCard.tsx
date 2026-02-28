import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { LocationBadge } from './LocationBadge';
import type { Violation, E1ElementSubItem } from '@/types/project';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue, ConfidenceValue, AdvisoryBlock,
} from './CardTypography';

function E1ElementItem({ element, compact = false }: {
  element: E1ElementSubItem;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.elementLabel || 'High-impact action';

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

interface E1AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

export function E1AggregatedCard({ violation, compact = false }: E1AggregatedCardProps) {
  const elements: E1ElementSubItem[] = (violation.isE1Aggregated && violation.e1Elements)
    ? violation.e1Elements
    : [{
        elementLabel: violation.evidence?.split('.')[0] || 'High-impact action',
        elementType: 'action',
        location: violation.evidence || 'Unknown',
        detection: violation.diagnosis || '',
        evidence: violation.evidence || '',
        confidence: violation.confidence,
        deduplicationKey: `${violation.ruleId}-fallback`,
      }];

  const hasVisionItems = elements.some(e => e.evaluationMethod === 'llm_perceptual');
  const headerExplanation = hasVisionItems
    ? 'Visual analysis flagged a potential transparency risk in high-impact actions; verify in context.'
    : 'Code analysis flagged a potential transparency risk in high-impact actions; verify in context.';

  return (
    <Card className="border border-warning/30">
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <RuleIdBadge ruleId="E1" isConfirmed={false} categoryClass="category-ethics" />
          <RuleHeader ruleId="E1" title="Insufficient Transparency in High-Impact Actions" />
          <ElementCountBadge count={elements.length} isConfirmed={false} />
        </CardTitle>
        <CardDescription compact={compact}>
          {headerExplanation}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((el, idx) => (
          <E1ElementItem
            key={el.deduplicationKey || idx}
            element={el}
            compact={compact}
          />
        ))}

        <AdvisoryBlock compact={compact}>
          {violation.advisoryGuidance || violation.contextualHint || 'Add confirmation steps with clear consequence disclosure for irreversible or high-impact actions. Ensure costs, data implications, and irreversibility are visible before the user commits.'}
        </AdvisoryBlock>
      </CardContent>
    </Card>
  );
}
