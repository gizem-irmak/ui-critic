import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { LocationBadge } from './LocationBadge';
import type { Violation, U1ElementSubItem } from '@/types/project';

function U1ElementItem({ element, isConfirmed, compact = false }: {
  element: U1ElementSubItem;
  isConfirmed: boolean;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.elementLabel || 'CTA element';

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
            <span className={cn('font-medium text-left', compact ? 'text-sm' : '')}>
              {displayLabel}
            </span>
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
            {element.detection && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-20">Detection:</span>
                <span className="font-mono text-xs">{element.detection}</span>
              </div>
            )}

            {element.evidence && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-20">Evidence:</span>
                <span className="font-mono text-xs">{element.evidence}</span>
              </div>
            )}

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

interface U1AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

export function U1AggregatedCard({ violation, compact = false }: U1AggregatedCardProps) {
  const elements: U1ElementSubItem[] = (violation.isU1Aggregated && violation.u1Elements)
    ? violation.u1Elements
    : [{
        elementLabel: violation.evidence || violation.diagnosis?.split('.')[0] || 'CTA element',
        elementType: 'button',
        location: violation.evidence || 'Unknown',
        subCheck: 'U1.2' as const,
        subCheckLabel: 'Multiple equivalent CTAs',
        classification: (violation.status === 'confirmed' ? 'confirmed' : 'potential') as 'confirmed' | 'potential',
        explanation: violation.diagnosis || '',
        confidence: violation.confidence,
        advisoryGuidance: violation.advisoryGuidance,
        deduplicationKey: `${violation.ruleId}-fallback`,
      }];

  const hasConfirmed = elements.some(el => el.classification === 'confirmed');
  const hasPotential = elements.some(el => el.classification === 'potential');

  return (
    <Card className={cn(
      'border',
      hasConfirmed ? 'border-destructive/30' : 'border-warning/30'
    )}>
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap text-base">
          <span className={cn(
            'category-badge flex-shrink-0 text-xs',
            hasConfirmed ? 'category-usability' : 'bg-warning/10 text-warning border border-warning/20'
          )}>
            U1
          </span>
          <span className="font-bold text-base">Unclear Primary Action</span>
          <Badge className={cn(
            "gap-1 text-xs",
            hasConfirmed
              ? "bg-destructive/10 text-destructive border-destructive/30"
              : "bg-warning/10 text-warning border-warning/30"
          )}>
            {elements.length} element{elements.length !== 1 ? 's' : ''}
          </Badge>
        </CardTitle>
        <p className={cn('text-muted-foreground', compact ? 'text-xs mt-2' : 'text-sm mt-2')}>
          Primary action clarity issue detected in code (deterministic).
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((el, idx) => (
          <U1ElementItem
            key={el.deduplicationKey || idx}
            element={el}
            isConfirmed={el.classification === 'confirmed'}
            compact={compact}
          />
        ))}

        {/* Advisory guidance — potential findings only */}
        {hasPotential && !hasConfirmed && violation.advisoryGuidance && (
          <div className={cn('bg-muted/30 rounded-md p-3 border border-border', compact ? 'text-xs' : 'text-sm')}>
            <p className="font-medium text-muted-foreground">💡 Advisory Guidance</p>
            <p className="text-muted-foreground mt-1">{violation.advisoryGuidance}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
