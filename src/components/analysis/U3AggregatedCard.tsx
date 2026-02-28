import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { LocationBadge } from './LocationBadge';
import type { Violation, U3ElementSubItem } from '@/types/project';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue, ConfidenceValue, AdvisoryBlock,
} from './CardTypography';

function U3ElementItem({ element, compact = false }: {
  element: U3ElementSubItem;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.elementLabel || 'Content element';

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
            {(element.truncationType || element.elementTag) && (
              <FieldRow>
                <FieldLabel>Element:</FieldLabel>
                <FieldValue mono>
                  {element.elementTag ? `<${element.elementTag}>` : '(unknown tag)'}
                  {' — '}type: {element.truncationType || '(none)'}
                  {' — '}text: {element.textLength === 'dynamic' ? 'dynamic' : element.textLength != null ? `${element.textLength} chars` : '(unknown)'}
                  {' — '}expand: {element.expandDetected ? 'Yes' : 'No'}
                </FieldValue>
              </FieldRow>
            )}

            {element.triggerReason && (
              <FieldRow>
                <FieldLabel>Trigger:</FieldLabel>
                <FieldValue mono>{element.triggerReason}</FieldValue>
              </FieldRow>
            )}

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

            {element.textPreview && (
              <FieldRow>
                <FieldLabel>Text preview:</FieldLabel>
                <span className="font-mono text-xs text-foreground/80 truncate max-w-full">{element.textPreview}</span>
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

interface U3AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

export function U3AggregatedCard({ violation, compact = false }: U3AggregatedCardProps) {
  const elements: U3ElementSubItem[] = (violation.isU3Aggregated && violation.u3Elements)
    ? violation.u3Elements
    : [{
        elementLabel: violation.evidence?.split('.')[0] || 'Content element',
        elementType: 'text',
        location: violation.evidence || 'Unknown',
        detection: violation.diagnosis || '',
        evidence: violation.evidence || '',
        subCheck: 'U3.D1' as const,
        subCheckLabel: 'Line clamp / ellipsis truncation',
        confidence: violation.confidence,
        advisoryGuidance: violation.advisoryGuidance || violation.contextualHint,
        deduplicationKey: `${violation.ruleId}-fallback`,
      }];

  return (
    <Card className="border border-warning/30">
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <RuleIdBadge ruleId="U3" isConfirmed={false} categoryClass="category-usability" />
          <RuleHeader ruleId="U3" title="Truncated or Inaccessible Content" />
          <ElementCountBadge count={elements.length} isConfirmed={false} />
        </CardTitle>
        <CardDescription compact={compact}>
          Static analysis flagged a potential content truncation or accessibility risk; verify in context.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((el, idx) => (
          <U3ElementItem
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
