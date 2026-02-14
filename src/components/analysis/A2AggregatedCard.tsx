import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A2ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PotentialSubtypeBadge, SubtypeAdvisoryGuidance } from './PotentialSubtypeUI';

interface A2AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

function A2ElementItem({ element, isConfirmed, compact = false }: {
  element: A2ElementSubItem;
  isConfirmed: boolean;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const displayLabel = element.sourceLabel || element.elementLabel;
  const isBorderline = element.potentialSubtype === 'borderline';

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
                {displayLabel}
              </span>
              {element.elementType && (
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {element.elementType}
                </span>
              )}
              {isBorderline && (
                <Badge variant="outline" className="text-xs font-normal border-warning/50 text-warning">
                  Borderline
                </Badge>
              )}
              {element.potentialSubtype === 'accuracy' && (
                <PotentialSubtypeBadge subtype="accuracy" compact={compact} />
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                {Math.round(element.confidence * 100)}%
              </span>
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
            {/* ── Element Identity Block ── */}
            <div className="space-y-1.5">
              <span className="text-muted-foreground font-semibold text-xs uppercase tracking-wide">Element</span>

              {/* Role */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-28">Role:</span>
                <span className="font-mono text-xs">{element.role || element.elementType || 'unknown'}</span>
              </div>

              {/* Accessible name */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-28">Accessible name:</span>
                <span className={cn('text-xs', element.accessibleName ? 'font-mono' : 'italic text-muted-foreground')}>
                  {element.accessibleName ? `"${element.accessibleName}"` : '(no accessible name)'}
                </span>
              </div>

              {/* Source label */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-28">Source label:</span>
                <span className="text-xs">{element.sourceLabel || element.elementLabel || '—'}</span>
              </div>

              {/* Selector hint */}
              {element.selectorHint && (
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground font-medium w-28">Selector hint:</span>
                  <span className="font-mono text-xs break-all">{element.selectorHint}</span>
                </div>
              )}

              {/* Location (repeated in identity block for completeness) */}
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-28">Location:</span>
                <span className="text-xs break-all">{element.location}</span>
              </div>
            </div>

            {/* Spacing separator */}
            <div className="h-1" />

            {/* Evidence / Trigger */}
            {element.detection && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-28">Detection:</span>
                <span className="font-mono text-xs">{element.detection}</span>
              </div>
            )}

            {/* Focus classes found */}
            {element.focusClasses && element.focusClasses.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-28">Classes:</span>
                <div className="flex flex-wrap gap-1">
                  {element.focusClasses.map((cls, i) => (
                    <span key={i} className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                      {cls}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Confidence */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-28">Confidence:</span>
              <span className={cn(
                'font-mono font-medium',
                isConfirmed ? 'text-destructive' : 'text-warning'
              )}>
                {Math.round(element.confidence * 100)}%
              </span>
            </div>

            {/* Requirement */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-28">Requirement:</span>
              <span>WCAG 2.4.7 Focus Visible</span>
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

export function A2AggregatedCard({ violation, compact = false }: A2AggregatedCardProps) {
  if (!violation.isA2Aggregated || !violation.a2Elements) {
    return null;
  }

  const isConfirmed = violation.status === 'confirmed';
  const elements = violation.a2Elements;

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
            A2
          </span>
          <span className="font-bold text-base">Poor Focus Visibility</span>
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
          <A2ElementItem
            key={element.deduplicationKey || idx}
            element={element}
            isConfirmed={isConfirmed}
            compact={compact}
          />
        ))}

        {/* Advisory guidance for potential findings */}
        {!isConfirmed && (
          <SubtypeAdvisoryGuidance
            ruleId="A2"
            potentialSubtype={violation.potentialSubtype}
            fallbackGuidance={violation.advisoryGuidance}
            compact={compact}
          />
        )}
      </CardContent>
    </Card>
  );
}
