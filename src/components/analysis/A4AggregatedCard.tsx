import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A4ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { LocationBadge } from './LocationBadge';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue, ConfidenceValue,
} from './CardTypography';

interface A4AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

const SUB_CHECK_LABELS: Record<string, string> = {
  'A4.1': 'Heading semantics',
  'A4.2': 'Interactive semantics',
  'A4.3': 'Landmark regions',
  'A4.4': 'List semantics',
};

function inferA4SubCheck(violation: Violation): 'A4.1' | 'A4.2' | 'A4.3' | 'A4.4' {
  const text = `${violation.diagnosis || ''} ${violation.evidence || ''} ${violation.correctivePrompt || ''}`.toLowerCase();
  if (/interactive|onclick|click handler|role="button"|tabindex|keyboard/.test(text)) return 'A4.2';
  if (/landmark|<main>|role="main"|<nav>/.test(text)) return 'A4.3';
  if (/list|<ul>|<ol>|repeated|sibling/.test(text)) return 'A4.4';
  return 'A4.1';
}

function A4ElementItem({ element, isConfirmed, compact = false }: {
  element: A4ElementSubItem;
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

            <FieldRow>
              <FieldLabel>Requirement:</FieldLabel>
              <FieldValue>WCAG 2.1 — 1.3.1 Info and Relationships (Level A)</FieldValue>
            </FieldRow>

            {!isConfirmed && (
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

export function A4AggregatedCard({ violation, compact = false }: A4AggregatedCardProps) {
  const isConfirmed = violation.status !== 'potential';

  const elements: A4ElementSubItem[] = (violation.isA4Aggregated && violation.a4Elements)
    ? violation.a4Elements
    : [{
        elementLabel: violation.evidence || violation.diagnosis?.split('.')[0] || 'Element',
        elementType: undefined,
        location: violation.evidence || '',
        detection: undefined,
        evidence: violation.evidence,
        subCheck: inferA4SubCheck(violation),
        subCheckLabel: SUB_CHECK_LABELS[inferA4SubCheck(violation)] || 'Heading semantics',
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
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <RuleIdBadge ruleId="A4" isConfirmed={isConfirmed} categoryClass="category-accessibility" />
          <RuleHeader ruleId="A4" title="Missing Semantic Structure" />
          <ElementCountBadge count={elements.length} isConfirmed={isConfirmed} />
        </CardTitle>
        <CardDescription compact={compact}>
          Semantic landmark structure is incomplete.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((element, idx) => (
          <A4ElementItem
            key={element.deduplicationKey || idx}
            element={element}
            isConfirmed={isConfirmed}
            compact={compact}
          />
        ))}
      </CardContent>
    </Card>
  );
}
