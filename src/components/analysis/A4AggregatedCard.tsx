import { Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A4ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface A4AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

function A4ElementItem({ element, isConfirmed, compact = false }: {
  element: A4ElementSubItem;
  isConfirmed: boolean;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn(
        'rounded-lg border space-y-2',
        isConfirmed
          ? 'bg-destructive/5 border-destructive/20'
          : 'bg-warning/5 border-warning/20',
        compact ? 'p-2' : 'p-3'
      )}>
        {/* Header row */}
        <CollapsibleTrigger className="w-full">
          <div className="flex items-start justify-between gap-2 cursor-pointer">
            <div className="flex items-center gap-2 flex-wrap text-left">
              <span className={cn('font-medium', compact ? 'text-sm' : '')}>
                {element.elementLabel}
              </span>
              {element.textSnippet && (
                <span className={cn(
                  'text-muted-foreground italic truncate max-w-48',
                  compact ? 'text-xs' : 'text-sm'
                )}>
                  "{element.textSnippet}"
                </span>
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
            {/* Size — deterministic or estimated */}
            <div className="flex items-center gap-2">
              {element.computedWidth !== undefined && element.computedHeight !== undefined ? (
                <>
                  <span className="text-muted-foreground font-medium w-28">Size:</span>
                  <span className={cn(
                    'font-mono font-medium',
                    isConfirmed ? 'text-destructive' : 'text-warning'
                  )}>
                    {element.computedWidth}px × {element.computedHeight}px
                  </span>
                </>
              ) : element.estimatedWidth !== undefined && element.estimatedHeight !== undefined ? (
                <>
                  <span className="text-muted-foreground font-medium w-28">Est. Size:</span>
                  <span className="font-mono font-medium text-warning">
                    ≈{element.estimatedWidth}px × {element.estimatedHeight}px
                  </span>
                  <span className="text-muted-foreground text-xs">(visual estimation)</span>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground font-medium w-28">Est. Size:</span>
                  <span className="text-muted-foreground italic">could not be reliably estimated</span>
                </>
              )}
            </div>

            {/* Threshold */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-28">Threshold:</span>
              <span className="font-mono">
                {element.detectionMethod === 'heuristic'
                  ? '&lt;20px Potential (High), 20–23px Potential (Low), ≥24px Pass'
                  : `<20px Confirmed, 20–23px Potential, ≥${element.thresholdPx}px Pass`}
              </span>
            </div>

            {/* Detection Source */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-28">Detection:</span>
              <span>{element.sizeSource || (element.detectionMethod === 'deterministic' ? 'CSS box model analysis' : 'Screenshot-based bounding box estimation')}</span>
            </div>

            {/* Confidence */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-28">Confidence:</span>
              <span className={cn(
                'font-mono',
                element.confidence >= 0.9 ? 'text-foreground' : 'text-warning'
              )}>
                {Math.round(element.confidence * 100)}%
                <span className="text-muted-foreground ml-1">
                  — {element.detectionMethod === 'deterministic' ? 'deterministic' : 'heuristic'}
                </span>
              </span>
            </div>

            {/* Explanation */}
            <div className="pt-1">
              <p className="text-foreground leading-relaxed">{element.explanation}</p>
            </div>

            {/* Low confidence badge for potential findings */}
            {!isConfirmed && element.detectionMethod === 'heuristic' && (
              <div className="flex items-start gap-2 pt-1">
                <Info className="h-3 w-3 text-warning mt-0.5 flex-shrink-0" />
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-xs border-warning/50 text-warning">
                    Low confidence measurement
                  </Badge>
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function A4AggregatedCard({ violation, compact = false }: A4AggregatedCardProps) {
  if (!violation.isA4Aggregated) return null;

  const isConfirmed = violation.status === 'confirmed';
  const elements = violation.a4Elements || [];

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
          <span className="font-bold text-base">Small Tap / Click Targets</span>
          {elements.length > 0 && (
            <Badge className={cn(
              "gap-1 text-xs",
              isConfirmed
                ? "bg-destructive/10 text-destructive border-destructive/30"
                : "bg-warning/10 text-warning border-warning/30"
            )}>
              {elements.length} element{elements.length !== 1 ? 's' : ''}
            </Badge>
          )}
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

        {/* Advisory guidance for potential findings */}
        {!isConfirmed && violation.advisoryGuidance && (
          <div className={cn(
            'rounded-lg bg-muted/30 border border-border mt-3',
            compact ? 'p-2' : 'p-3'
          )}>
            <p className={cn('font-medium text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
              💡 Advisory Guidance
            </p>
            <p className={cn('text-muted-foreground mt-1', compact ? 'text-xs' : 'text-sm')}>
              {violation.advisoryGuidance}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
