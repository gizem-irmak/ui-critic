import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A3ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PotentialSubtypeBadge, SubtypeAdvisoryGuidance } from './PotentialSubtypeUI';
import { LocationBadge } from './LocationBadge';

interface A3AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

/** Derive missing-requirement chips from evidence/explanation */
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
      <div className={cn(
        'rounded-lg border space-y-0',
        isConfirmed
          ? 'bg-destructive/5 border-destructive/20'
          : 'bg-warning/5 border-warning/20',
        compact ? 'p-2' : 'p-3'
      )}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-2 cursor-pointer">
            <div className="flex items-center gap-2 flex-wrap text-left">
              <span className={cn('font-medium', compact ? 'text-sm' : '')}>
                {displayLabel}
              </span>
              {element.potentialSubtype === 'borderline' && (
                <Badge variant="outline" className="text-xs border-warning/50 text-warning">
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
          <div className={cn('space-y-2 pt-2 mt-2 border-t border-border/50', compact ? 'text-xs' : 'text-sm')}>
            {/* Detection — chips */}
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-20">Detection:</span>
              <div className="flex flex-wrap gap-1">
                {evidenceChips.map((chip, i) => (
                  <span key={i} className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            {/* Requirement */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-20">Requirement:</span>
              <span>
                WCAG 2.1.1 Keyboard
                {needsNameRole && ', WCAG 4.1.2 Name, Role, Value'}
              </span>
            </div>

            {/* Confidence — only for potential findings */}
            {!isConfirmed && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-20">Confidence:</span>
                <span className="font-mono font-medium text-warning">
                  {Math.round(element.confidence * 100)}%
                </span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
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
        <CardTitle className="flex items-center gap-2 flex-wrap text-base">
          <span className={cn(
            'category-badge flex-shrink-0 text-xs',
            isConfirmed ? 'category-accessibility' : 'bg-warning/10 text-warning border border-warning/20'
          )}>
            A3
          </span>
          <span className="font-bold text-base">Incomplete Keyboard Operability</span>
          <Badge className={cn(
            "gap-1 text-xs",
            isConfirmed
              ? "bg-destructive/10 text-destructive border-destructive/30"
              : "bg-warning/10 text-warning border-warning/30"
          )}>
            {elements.length} element{elements.length !== 1 ? 's' : ''}
          </Badge>
        </CardTitle>
        <p className={cn('text-muted-foreground', compact ? 'text-xs mt-2' : 'text-sm mt-2')}>
          {isConfirmed
            ? 'Interactive elements lack required keyboard semantics and cannot be accessed via keyboard.'
            : violation.diagnosis}
        </p>
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
