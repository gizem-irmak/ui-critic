import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { LocationBadge } from './LocationBadge';
import type { Violation, U5ElementSubItem } from '@/types/project';

function U5ElementItem({ element, compact = false }: {
  element: U5ElementSubItem;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.elementLabel || 'Interactive element';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn(
        'rounded-lg border space-y-0 bg-warning/5 border-warning/20',
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
                <span className="text-muted-foreground font-medium w-24 flex-shrink-0">Detection:</span>
                <span>{element.detection}</span>
              </div>
            )}

            {element.evidence && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-24 flex-shrink-0">Evidence:</span>
                <span>{element.evidence}</span>
              </div>
            )}

            {element.confidence != null && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-24 flex-shrink-0">Confidence:</span>
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

interface U5AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

export function U5AggregatedCard({ violation, compact = false }: U5AggregatedCardProps) {
  const elements: U5ElementSubItem[] = (violation.isU5Aggregated && violation.u5Elements)
    ? violation.u5Elements
    : [{
        elementLabel: violation.evidence?.split('.')[0] || 'Interactive element',
        elementType: 'button',
        location: violation.evidence || 'Unknown',
        detection: violation.diagnosis || '',
        evidence: violation.evidence || '',
        confidence: violation.confidence,
        deduplicationKey: `${violation.ruleId}-fallback`,
      }];

  const elementCount = elements.length;

  // Determine header explanation based on evaluation method
  const hasVisionItems = elements.some(e => e.evaluationMethod === 'vision_llm');
  const headerExplanation = hasVisionItems
    ? 'Visual analysis flagged potential missing interaction feedback; verify by interacting.'
    : 'Static analysis flagged potential missing interaction feedback (loading/state/confirmation); verify in context.';

  return (
    <Card className="border border-warning/30">
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap text-base">
          <span className="category-badge flex-shrink-0 text-xs category-usability">
            U5
          </span>
          <span className="font-bold text-base">Insufficient Interaction Feedback</span>
          <Badge className="gap-1 text-xs bg-warning/10 text-warning border-warning/30">
            {elementCount} element{elementCount !== 1 ? 's' : ''}
          </Badge>
        </CardTitle>
        <p className={cn('text-muted-foreground', compact ? 'text-xs mt-2' : 'text-sm mt-2')}>
          {headerExplanation}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((el, idx) => (
          <U5ElementItem
            key={el.deduplicationKey || idx}
            element={el}
            compact={compact}
          />
        ))}

        {/* Card-level advisory guidance */}
        <div className={cn('bg-muted/30 rounded-md p-3 border border-border', compact ? 'text-xs' : 'text-sm')}>
          <p className="font-medium text-muted-foreground">💡 Advisory Guidance</p>
          <p className="text-muted-foreground mt-1">
            {violation.advisoryGuidance || violation.contextualHint || 'Provide loading/progress state, disable controls during async actions, and show success/error confirmation.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
