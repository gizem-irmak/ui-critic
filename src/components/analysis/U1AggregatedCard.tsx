import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, U1ElementSubItem } from '@/types/project';

const SUB_CHECK_COLORS: Record<string, string> = {
  'U1.1': 'bg-destructive/10 text-destructive border-destructive/30',
  'U1.2': 'bg-warning/10 text-warning border-warning/30',
  'U1.3': 'bg-warning/10 text-warning border-warning/30',
  'U1.S1': 'bg-warning/10 text-warning border-warning/30',
};

function U1ElementRow({ element, compact = false }: { element: U1ElementSubItem; compact?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const isConfirmed = element.classification === 'confirmed';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className={cn(
          'flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors',
          isConfirmed ? 'border-destructive/20 bg-destructive/5' : 'border-warning/20 bg-warning/5'
        )}>
          {isOpen ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
          <Badge variant="outline" className={cn('text-xs font-mono', SUB_CHECK_COLORS[element.subCheck])}>
            {element.subCheck}
          </Badge>
          <span className={cn('font-medium text-foreground truncate text-left', compact ? 'text-sm' : 'text-base')}>
            {element.elementLabel}
          </span>
          <Badge variant="outline" className="text-xs ml-auto flex-shrink-0">
            {element.subCheckLabel}
          </Badge>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded flex-shrink-0">
            {Math.round(element.confidence * 100)}%
          </span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={cn('ml-6 mt-2 space-y-2 pb-2', compact ? 'text-xs' : 'text-sm')}>
          {element.detection && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-20 flex-shrink-0">Detection:</span>
              <span className="text-foreground">{element.detection}</span>
            </div>
          )}
          {element.evidence && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-20 flex-shrink-0">Evidence:</span>
              <span className="text-foreground font-mono text-xs">{element.evidence}</span>
            </div>
          )}
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground font-medium w-20 flex-shrink-0">Location:</span>
            <span className="text-foreground">📍 {element.location}</span>
          </div>
          <p className="text-muted-foreground leading-relaxed mt-1">{element.explanation}</p>
          {element.advisoryGuidance && (
            <div className="bg-muted/30 rounded-md p-2 border border-border mt-2">
              <span className="text-muted-foreground font-medium">💡 Advisory: </span>
              <span className="text-muted-foreground">{element.advisoryGuidance}</span>
            </div>
          )}
        </div>
      </CollapsibleContent>
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

  const confirmedCount = elements.filter(el => el.classification === 'confirmed').length;
  const potentialCount = elements.filter(el => el.classification === 'potential').length;
  const hasConfirmed = confirmedCount > 0;

  return (
    <Card className={cn('border', hasConfirmed ? 'border-destructive/30' : 'border-warning/30')}>
      <CardContent className={cn('space-y-3', compact ? 'pt-3 pb-3' : 'pt-4 pb-4')}>
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="category-badge flex-shrink-0 text-xs category-usability">U1</span>
          <span className="font-bold text-base">Unclear primary action</span>
          <span className="text-sm text-muted-foreground">
            — {elements.length} finding{elements.length !== 1 ? 's' : ''}
            {confirmedCount > 0 && potentialCount > 0
              ? ` (${confirmedCount} confirmed, ${potentialCount} potential)`
              : confirmedCount > 0
              ? ` (${confirmedCount} confirmed)`
              : ` (${potentialCount} potential)`}
          </span>
        </div>

        <div className="h-1" />

        {/* Summary */}
        <p className={cn('text-muted-foreground leading-relaxed', compact ? 'text-xs' : 'text-sm')}>
          {violation.diagnosis}
        </p>

        {/* Element rows */}
        <div className="space-y-2">
          {elements.map((el, idx) => (
            <U1ElementRow key={`${el.deduplicationKey}-${idx}`} element={el} compact={compact} />
          ))}
        </div>

        {/* Advisory guidance */}
        {violation.advisoryGuidance && (
          <div className={cn('bg-muted/30 rounded-md p-3 border border-border', compact ? 'text-xs' : 'text-sm')}>
            <p className="font-medium text-muted-foreground">💡 Advisory Guidance</p>
            <p className="text-muted-foreground mt-1">{violation.advisoryGuidance}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
