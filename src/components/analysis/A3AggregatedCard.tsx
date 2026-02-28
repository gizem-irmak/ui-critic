import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A3ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PotentialSubtypeBadge, SubtypeAdvisoryGuidance } from './PotentialSubtypeUI';
import { LocationBadge } from './LocationBadge';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue, CodeTag, ConfidenceValue,
} from './CardTypography';

interface A3AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

function getEvidenceChips(evidence?: string, explanation?: string): string[] {
  const chips: string[] = [];
  const src = (evidence || '') + ' ' + (explanation || '');
  if (/onClick/i.test(src)) chips.push('onClick');
  if (/onPointerDown/i.test(src)) chips.push('onPointerDown');
  if (/onMouseDown/i.test(src)) chips.push('onMouseDown');
  if (/missing\s+role|lacks?\s+role/i.test(src)) chips.push('missing role');
  if (/missing.*tabIndex|lacks?.*tabIndex|no\s+tabIndex|not\s+focusable/i.test(src)) chips.push('missing tabIndex');
  if (/missing.*onKeyDown|no\s+onKeyDown|missing.*key\s*handler/i.test(src)) chips.push('missing onKeyDown');
  if (/missing.*onKeyPress|onKeyPress/i.test(src)) chips.push('missing onKeyPress');
  if (/missing.*onKeyUp|onKeyUp/i.test(src)) chips.push('missing onKeyUp');
  if (/non.?semantic|div.*instead|clickable\s+<?(div|span|li)/i.test(src)) chips.push('non-semantic element');
  if (/tabIndex.*-1/i.test(src)) chips.push('tabIndex={-1}');
  if (/no\s+valid\s+href|no\s+href/i.test(src)) chips.push('missing href');
  if (chips.length === 0) chips.push('missing keyboard support');
  return chips;
}

function A3ElementItem({ element, isConfirmed, compact = false }: {
  element: A3ElementSubItem;
  isConfirmed: boolean;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.sourceLabel || element.elementLabel;
  const evidenceChips = getEvidenceChips(element.evidence, element.explanation);
  const needsNameRole = evidenceChips.some(c => c === 'missing role');

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <ElementItemWrapper isConfirmed={isConfirmed} compact={compact}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-2 cursor-pointer">
            <div className="flex items-center gap-2 flex-wrap text-left">
              <ComponentTitle>{displayLabel}</ComponentTitle>
              {element.potentialSubtype === 'borderline' && (
                <Badge variant="outline" className="text-xs font-medium border-warning/50 text-warning">
                  Borderline
                </Badge>
              )}
              {element.potentialSubtype === 'accuracy' && (
                <PotentialSubtypeBadge subtype="accuracy" compact={compact} />
              )}
            </div>
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
            <FieldRow>
              <FieldLabel>Detection:</FieldLabel>
              <div className="flex flex-wrap gap-1">
                {evidenceChips.map((chip, i) => (
                  <CodeTag key={i}>{chip}</CodeTag>
                ))}
              </div>
            </FieldRow>

            <FieldRow>
              <FieldLabel>Requirement:</FieldLabel>
              <FieldValue>
                WCAG 2.1.1 Keyboard
                {needsNameRole && ', WCAG 4.1.2 Name, Role, Value'}
              </FieldValue>
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

export function A3AggregatedCard({ violation, compact = false }: A3AggregatedCardProps) {
  const isConfirmed = violation.status !== 'potential';

  const elements: A3ElementSubItem[] = (violation.isA3Aggregated && violation.a3Elements)
    ? violation.a3Elements
    : [{
        elementLabel: violation.evidence || violation.diagnosis?.split('.')[0] || 'Element',
        elementType: undefined,
        location: violation.evidence || '',
        detection: undefined,
        evidence: violation.evidence,
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
          <RuleIdBadge ruleId="A3" isConfirmed={isConfirmed} categoryClass="category-accessibility" />
          <RuleHeader ruleId="A3" title="Incomplete Keyboard Operability" />
          <ElementCountBadge count={elements.length} isConfirmed={isConfirmed} />
        </CardTitle>
        <CardDescription compact={compact}>
          {isConfirmed
            ? 'Interactive elements lack required keyboard semantics and cannot be accessed via keyboard.'
            : violation.diagnosis}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((element, idx) => (
          <A3ElementItem
            key={element.deduplicationKey || idx}
            element={element}
            isConfirmed={isConfirmed}
            compact={compact}
          />
        ))}

        {!isConfirmed && (
          <SubtypeAdvisoryGuidance
            ruleId="A3"
            potentialSubtype={violation.potentialSubtype}
            fallbackGuidance={violation.advisoryGuidance}
            compact={compact}
          />
        )}
      </CardContent>
    </Card>
  );
}
