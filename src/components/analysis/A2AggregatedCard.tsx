import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A2ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PotentialSubtypeBadge, SubtypeAdvisoryGuidance } from './PotentialSubtypeUI';
import { LocationBadge } from './LocationBadge';

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
  const displayLabel = element.elementName && element.elementName !== 'unknown'
    ? element.elementName
    : (element.sourceLabel || element.elementLabel);
  const isBorderline = element.potentialSubtype === 'borderline';

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
              {(element.occurrences ?? 1) > 1 && (
                <Badge variant="outline" className="text-xs border-muted-foreground/40 text-muted-foreground">
                  {element.occurrences} occurrences
                </Badge>
              )}
              {isBorderline && (
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
          {isConfirmed ? (
            <div className={cn('space-y-2 pt-2 mt-2 border-t border-border/50', compact ? 'text-xs' : 'text-sm')}>
              {/* Element metadata */}
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-24">Element:</span>
                <span className="font-mono text-xs">
                  {element.elementName && element.elementName !== 'unknown'
                    ? element.elementName
                    : (element.elementTag || element.elementType || 'unknown')}
                  {element.elementSource === 'html_tag_fallback' && ' (fallback)'}
                  {element.sourceLabel && element.sourceLabel !== element.elementLabel && element.sourceLabel !== element.elementName ? ` (${element.sourceLabel})` : ''}
                  {element.selectorHints && element.selectorHints.length > 0 ? ` — ${element.selectorHints.join(' — ')}` : ''}
                  {' — Focusable: '}
                  {element.focusable === 'yes' ? 'Yes' : element.focusable === 'no' ? 'No' : 'Unknown'}
                </span>
              </div>

              {/* Affected components (when grouped) */}
              {element.affectedComponents && element.affectedComponents.length > 1 && (
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground font-medium w-24">Components:</span>
                  <span className="font-mono text-xs">{element.affectedComponents.join(', ')}</span>
                </div>
              )}
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-24">Detection:</span>
                <div className="flex flex-wrap gap-1">
                  {(() => {
                    if (element.focusClasses && element.focusClasses.length > 0) {
                      return element.focusClasses.map((cls, i) => (
                        <span key={i} className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                          {cls}
                        </span>
                      ));
                    }
                    const det = element.detection || '';
                    const match = det.match(/\(([^)]+)\)/);
                    const chip = match ? match[1] : (det || 'outline suppressed');
                    return (
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                        {chip}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Requirement */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-24">Requirement:</span>
                <span>WCAG 2.4.7 Focus Visible</span>
              </div>
            </div>
          ) : (
            <div className={cn('space-y-2 pt-2 mt-2 border-t border-border/50', compact ? 'text-xs' : 'text-sm')}>
              {/* Element metadata */}
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-20">Element:</span>
                <span className="font-mono text-xs">
                  {element.elementName && element.elementName !== 'unknown'
                    ? element.elementName
                    : (element.elementTag || element.elementType || 'unknown')}
                  {element.elementSource === 'html_tag_fallback' && ' (fallback)'}
                  {element.sourceLabel && element.sourceLabel !== element.elementLabel && element.sourceLabel !== element.elementName ? ` (${element.sourceLabel})` : ''}
                  {element.selectorHints && element.selectorHints.length > 0 ? ` — ${element.selectorHints.join(' — ')}` : ''}
                  {' — Focusable: '}
                  {element.focusable === 'yes' ? 'Yes' : element.focusable === 'no' ? 'No' : 'Unknown'}
                </span>
              </div>

              {/* Detection */}
              {element.detection && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-medium w-20">Detection:</span>
                  <span className="font-mono">{element.detection}</span>
                </div>
              )}

              {/* Borderline reason */}
              {isBorderline && element.focusClasses && element.focusClasses.length > 0 && (() => {
                const classes = element.focusClasses.join(' ');
                const hasOutlineRemoval = /outline-none|ring-0|border-0/.test(classes);
                const hasRing1 = /ring-1\b/.test(classes);
                const hasMutedColor = /ring-(?:gray|slate|zinc)-(?:100|200)/.test(classes);
                const hasNoOffset = !/ring-offset-[1-9]/.test(classes) || /ring-offset-0/.test(classes);
                
                if (hasOutlineRemoval && (hasRing1 || hasMutedColor)) {
                  const parts: string[] = [];
                  if (hasOutlineRemoval) parts.push('outline removed');
                  if (hasRing1) parts.push('ring-1');
                  if (hasMutedColor) parts.push('muted color');
                  if (hasNoOffset && (hasRing1 || hasMutedColor)) parts.push('no ring-offset');
                  
                  return (
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground font-medium w-20">Reason:</span>
                      <span className="text-warning">{parts.join(' + ')}</span>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Focus classes */}
              {element.focusClasses && element.focusClasses.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground font-medium w-20">Classes:</span>
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
                <span className="text-muted-foreground font-medium w-20">Confidence:</span>
                <span className={cn('font-mono font-medium', 'text-warning')}>
                  {Math.round(element.confidence * 100)}%
                </span>
              </div>

              {/* Method */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-20">Method:</span>
                <Badge variant="outline" className={cn(
                  'text-xs',
                  element.detectionMethod === 'deterministic'
                    ? 'border-blue-500/50 text-blue-600'
                    : 'border-amber-500/50 text-amber-600'
                )}>
                  {element.detectionMethod === 'deterministic' ? 'Deterministic' : 'LLM-Assisted'}
                </Badge>
              </div>

              {/* Requirement */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-20">Requirement:</span>
                <span>WCAG 2.4.7 Focus Visible</span>
              </div>

              {/* Potential reason */}
              {element.potentialReason && (
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground font-medium w-20">Reason:</span>
                  <span className="text-warning italic">{element.potentialReason}</span>
                </div>
              )}

              {/* Explanation */}
              <div className="pt-1">
                {element.explanation.includes('Issue reason:') && element.explanation.includes('Recommended fix:') ? (
                  <>
                    {element.explanation.split('\n').filter(Boolean).map((line, i) => {
                      const isLabel = /^(Issue reason|Recommended fix):/.test(line.trim());
                      return (
                        <p key={i} className={cn(
                          'leading-relaxed',
                          isLabel ? 'font-medium text-foreground' : 'text-foreground'
                        )}>
                          {line.trim()}
                        </p>
                      );
                    })}
                  </>
                ) : (
                  <p className="text-foreground leading-relaxed">{element.explanation}</p>
                )}
              </div>
            </div>
          )}
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
          {isConfirmed
            ? 'Elements remove the default focus outline. Flag as a violation only if no visible focus indicator (ring/border/outline/shadow) is provided.'
            : violation.diagnosis}
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
