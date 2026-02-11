import { Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A3ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

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
            {/* Line Height — deterministic or estimated */}
            <div className="flex items-center gap-2">
              {element.computedLineHeight !== undefined ? (
                <>
                  <span className="text-muted-foreground font-medium w-28">Line Height:</span>
                  <span className={cn(
                    'font-mono font-medium',
                    isConfirmed ? 'text-destructive' : 'text-warning'
                  )}>
                    {element.computedLineHeight.toFixed(2)} (computed)
                  </span>
                  {element.confidence !== undefined && (
                    <span className="text-muted-foreground">
                      ({Math.round(element.confidence * 100)}% conf)
                    </span>
                  )}
                </>
              ) : element.estimatedLineHeight !== undefined ? (
                <>
                  <span className="text-muted-foreground font-medium w-28">Est. Line Height:</span>
                  <span className={cn(
                    'font-mono font-medium',
                    'text-warning'
                  )}>
                    ≈{element.estimatedLineHeight.toFixed(2)} (visual estimation)
                  </span>
                </>
              ) : element.estimationFailed ? (
                <>
                  <span className="text-muted-foreground font-medium w-28">Est. Line Height:</span>
                  <span className="text-muted-foreground italic">could not be reliably computed</span>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground font-medium w-28">Est. Line Height:</span>
                  <span className="text-muted-foreground italic">could not be reliably estimated</span>
                </>
              )}
            </div>

            {/* Font Size if available */}
            {element.computedFontSize !== undefined && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-28">Font Size:</span>
                <span className="font-mono">{element.computedFontSize}px</span>
              </div>
            )}

            {/* Threshold */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-28">Threshold:</span>
              <span className="font-mono">
                {element.detectionMethod === 'heuristic'
                  ? (element.estimationFailed ? '1.35 readability baseline' : '1.35 readability baseline')
                  : `${element.thresholdRatio} minimum readability baseline`}
              </span>
            </div>

            {/* Detection Source */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-28">Detection:</span>
              <span>{element.lineHeightSource || (element.detectionMethod === 'deterministic' ? 'CSS cascade resolution' : (element.estimationFailed ? 'Screenshot-based density fallback' : 'Screenshot-based visual estimation'))}</span>
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
            {!isConfirmed && (element.detectionMethod === 'heuristic' || element.estimationFailed) && (
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
          <span className="font-bold text-base">Insufficient Line Spacing</span>
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

        {/* Debug Telemetry Panel */}
        {(violation as any)._a3DebugLogs && (violation as any)._a3DebugLogs.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="w-full">
              <div className="flex items-center gap-2 cursor-pointer rounded-lg bg-muted/50 border border-dashed border-muted-foreground/30 p-2 mt-3">
                <Badge variant="outline" className="text-xs font-mono border-muted-foreground/40">DEBUG</Badge>
                <span className="text-xs text-muted-foreground font-medium">A3 Debug Telemetry ({(violation as any)._a3DebugLogs.length} entries)</span>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 space-y-1.5 rounded-lg bg-muted/30 border border-dashed border-muted-foreground/20 p-3">
                {(violation as any)._a3DebugLogs.map((log: any, i: number) => (
                  <div key={i} className="text-xs font-mono text-muted-foreground leading-relaxed">
                    {log.type === 'block_analysis' ? (
                      <div className="space-y-0.5 border-b border-border/30 pb-1.5 mb-1.5">
                        <div><span className="text-foreground font-semibold">[{log.blockId}]</span> {log.screenshotRef}</div>
                        <div>Lines: {log.detectedLines} | Text H: {log.avgTextHeight} | Baseline Dist: {log.avgBaselineDistance}</div>
                        <div>Est. Ratio: {typeof log.estimatedRatio === 'number' ? log.estimatedRatio.toFixed(2) : log.estimatedRatio} | Band: {log.thresholdBand}</div>
                        <div>Classification: <span className={cn(
                          log.classification.includes('No finding') ? 'text-muted-foreground' : 'text-warning'
                        )}>{log.classification}</span></div>
                      </div>
                    ) : (
                      <div className="text-warning/80">{log.message}</div>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Per-element debug info */}
        {elements.map((element, idx) => {
          const debug = (element as any)._debug;
          if (!debug) return null;
          return null; // Debug info is shown in the panel above
        })}
      </CardContent>
    </Card>
  );
}
