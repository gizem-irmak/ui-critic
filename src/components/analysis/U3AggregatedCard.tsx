import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { LocationBadge } from './LocationBadge';
import type { Violation, U3ElementSubItem } from '@/types/project';

function U3ElementItem({ element, compact = false }: {
  element: U3ElementSubItem;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.elementLabel || 'Content element';

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

            {element.textPreview && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-24 flex-shrink-0">Text preview:</span>
                <span className="font-mono text-xs text-foreground/80 truncate max-w-full">{element.textPreview}</span>
              </div>
            )}

            {element.confidence != null && (
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

  const elementCount = elements.length;

  return (
    <Card className="border border-warning/30">
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap text-base">
          <span className="category-badge flex-shrink-0 text-xs bg-warning/10 text-warning border border-warning/20">
            U3
          </span>
          <span className="font-bold text-base">Truncated or Inaccessible Content</span>
          <Badge className="gap-1 text-xs bg-warning/10 text-warning border-warning/30">
            {elementCount} element{elementCount !== 1 ? 's' : ''}
          </Badge>
        </CardTitle>
        <p className={cn('text-muted-foreground', compact ? 'text-xs mt-2' : 'text-sm mt-2')}>
          Static analysis flagged a potential content truncation or accessibility risk; verify in context.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((el, idx) => (
          <U3ElementItem
            key={el.deduplicationKey || idx}
            element={el}
            compact={compact}
          />
        ))}

        {/* Card-level advisory guidance */}
        {(violation.advisoryGuidance || violation.contextualHint) && (
          <div className={cn('bg-muted/30 rounded-md p-3 border border-border', compact ? 'text-xs' : 'text-sm')}>
            <p className="font-medium text-muted-foreground">💡 Advisory Guidance</p>
            <p className="text-muted-foreground mt-1">{violation.advisoryGuidance || violation.contextualHint}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
