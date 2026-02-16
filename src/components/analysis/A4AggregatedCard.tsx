import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A4ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PotentialSubtypeBadge, SubtypeAdvisoryGuidance } from './PotentialSubtypeUI';

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

/**
 * Infer sub-check from violation text when a4Elements is missing (fallback).
 */
function inferA4SubCheck(violation: Violation): 'A4.1' | 'A4.2' | 'A4.3' | 'A4.4' {
  const text = `${violation.diagnosis || ''} ${violation.evidence || ''} ${violation.correctivePrompt || ''}`.toLowerCase();
  if (/interactive|onclick|click handler|role="button"|tabindex|keyboard/.test(text)) return 'A4.2';
  if (/landmark|<main>|role="main"|<nav>/.test(text)) return 'A4.3';
  if (/list|<ul>|<ol>|repeated|sibling/.test(text)) return 'A4.4';
  return 'A4.1'; // Default to heading semantics
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
      <div className={cn(
        'rounded-lg border space-y-2',
        isConfirmed
          ? 'bg-destructive/5 border-destructive/20'
          : 'bg-warning/5 border-warning/20',
        compact ? 'p-2' : 'p-3'
      )}>
        {/* Header row — matches A2/A3 */}
        <CollapsibleTrigger className="w-full">
          <div className="flex items-start justify-between gap-2 cursor-pointer">
            <div className="flex items-center gap-2 flex-wrap text-left">
              <span className={cn('font-medium', compact ? 'text-sm' : '')}>
                {displayLabel}
              </span>
              {element.elementType && (
                <span className={cn(
                  'text-muted-foreground italic truncate max-w-48',
                  compact ? 'text-xs' : 'text-sm'
                )}>
                  {element.elementType}
                </span>
              )}
              <Badge variant="outline" className="text-xs border-muted-foreground/30 text-muted-foreground">
                {element.subCheck}
              </Badge>
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
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        {/* Location (always visible) — matches A2/A3 */}
        <div className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          <span className="font-medium">📍 </span>
          {element.location}
        </div>

        {/* Expandable details — matches A2/A3 row style with w-20 labels */}
        <CollapsibleContent>
          <div className={cn('space-y-2 pt-2 border-t border-border/50', compact ? 'text-xs' : 'text-sm')}>
            {/* Sub-check */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-20">Sub-check:</span>
              <span>{element.subCheckLabel || SUB_CHECK_LABELS[element.subCheck] || element.subCheck}</span>
            </div>

            {/* Detection */}
            {element.detection && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-20">Detection:</span>
                <span className="font-mono">{element.detection}</span>
              </div>
            )}

            {/* Evidence */}
            {element.evidence && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-20">Evidence:</span>
                <span className="font-mono text-xs">{element.evidence}</span>
              </div>
            )}

            {/* Confidence */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-20">Confidence:</span>
              <span className={cn(
                'font-mono font-medium',
                isConfirmed ? 'text-destructive' : 'text-warning'
              )}>
                {Math.round(element.confidence * 100)}%
              </span>
            </div>

            {/* Requirement */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-20">Requirement:</span>
              <span>WCAG 2.1 — 1.3.1 Info and Relationships (Level A)</span>
            </div>

            {/* Explanation */}
            <div className="pt-1">
              <p className="text-foreground leading-relaxed">{element.explanation}</p>
            </div>
          </div>
        </CollapsibleContent>
      </div>
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
        <CardTitle className="flex items-center gap-2 flex-wrap text-base">
          <span className={cn(
            'category-badge flex-shrink-0 text-xs',
            isConfirmed ? 'category-accessibility' : 'bg-warning/10 text-warning border border-warning/20'
          )}>
            A4
          </span>
          <span className="font-bold text-base">Missing Semantic Structure</span>
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
          {violation.diagnosis}
        </p>
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

        {!isConfirmed && (
          <SubtypeAdvisoryGuidance
            ruleId="A4"
            potentialSubtype={violation.potentialSubtype}
            fallbackGuidance={violation.advisoryGuidance}
            compact={compact}
          />
        )}
      </CardContent>
    </Card>
  );
}
