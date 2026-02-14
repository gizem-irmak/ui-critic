import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A3ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PotentialSubtypeBadge, SubtypeAdvisoryGuidance } from './PotentialSubtypeUI';

interface A3AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

function A3ElementItem({ element, isConfirmed, compact = false }: {
  element: A3ElementSubItem;
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
        {/* Header row — matches A1 typography */}
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
              {element.potentialSubtype === 'borderline' && (
                <PotentialSubtypeBadge subtype="borderline" compact={compact} />
              )}
              {element.potentialSubtype === 'accuracy' && (
                <PotentialSubtypeBadge subtype="accuracy" compact={compact} />
              )}
              {element.classificationCode && (
                <Badge variant="outline" className="text-xs border-muted-foreground/30 text-muted-foreground">
                  {element.classificationCode}
                </Badge>
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

        {/* Location (always visible) */}
        <div className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          <span className="font-medium">📍 </span>
          {element.location}
        </div>

        {/* Expandable details */}
        <CollapsibleContent>
          <div className={cn('space-y-2 pt-2 border-t border-border/50', compact ? 'text-xs' : 'text-sm')}>
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
                <span className="text-foreground">{element.evidence}</span>
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
              <span>WCAG 2.1.1 Keyboard</span>
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

export function A3AggregatedCard({ violation, compact = false }: A3AggregatedCardProps) {
  if (!violation.isA3Aggregated || !violation.a3Elements) {
    return null;
  }

  const isConfirmed = violation.status === 'confirmed';
  const elements = violation.a3Elements;

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
          {violation.diagnosis}
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

        {/* Advisory guidance for potential findings */}
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
