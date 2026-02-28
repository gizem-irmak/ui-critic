import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A6ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { LocationBadge } from './LocationBadge';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue,
} from './CardTypography';

interface A6AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

function A6ElementItem({ element, compact = false }: {
  element: A6ElementSubItem;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.sourceLabel || element.elementLabel;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <ElementItemWrapper isConfirmed={true} compact={compact}>
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

            <FieldRow>
              <FieldLabel>Requirement:</FieldLabel>
              <FieldValue>WCAG 2.1 — 4.1.2 Name, Role, Value (Level A)</FieldValue>
            </FieldRow>
          </DetailContainer>
        </CollapsibleContent>
      </ElementItemWrapper>
    </Collapsible>
  );
}

export function A6AggregatedCard({ violation, compact = false }: A6AggregatedCardProps) {
  const rawElements: A6ElementSubItem[] = (violation.isA6Aggregated && violation.a6Elements)
    ? violation.a6Elements
    : [{
        elementLabel: violation.evidence || violation.diagnosis?.split('.')[0] || 'Interactive element',
        elementType: undefined,
        location: violation.evidence || '',
        detection: undefined,
        evidence: violation.evidence,
        subCheck: 'A6.1',
        subCheckLabel: 'Missing accessible name',
        classification: 'confirmed',
        explanation: violation.diagnosis || '',
        wcagCriteria: ['4.1.2'],
        correctivePrompt: violation.correctivePrompt,
        deduplicationKey: `${violation.ruleId}-fallback`,
      }];

  const a62Keys = new Set(
    rawElements.filter(el => el.subCheck === 'A6.2').map(el => el.deduplicationKey?.replace('-A6.2', '') ?? el.elementLabel)
  );
  const elements = rawElements.filter(el => {
    if (el.subCheck !== 'A6.1') return true;
    const baseKey = el.deduplicationKey?.replace('-A6.1', '') ?? el.elementLabel;
    return !a62Keys.has(baseKey);
  });

  return (
    <Card className="border border-destructive/30">
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <RuleIdBadge ruleId="A6" isConfirmed={true} categoryClass="category-accessibility" />
          <RuleHeader ruleId="A6" title="Missing Accessible Names" />
          <ElementCountBadge count={elements.length} isConfirmed={true} />
        </CardTitle>
        <CardDescription compact={compact}>
          Interactive elements must have programmatic accessible names (WCAG 4.1.2).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((element, idx) => (
          <A6ElementItem
            key={element.deduplicationKey || idx}
            element={element}
            compact={compact}
          />
        ))}
      </CardContent>
    </Card>
  );
}
