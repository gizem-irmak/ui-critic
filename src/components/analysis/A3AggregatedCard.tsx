import { Info, BarChart3 } from 'lucide-react';
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
                  ? '1.35 readability baseline'
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

/** Summary-only card for A3 when no risk is detected or no multi-line blocks found */
function A3EstimationSummaryCard({ violation, compact = false }: A3AggregatedCardProps) {
  const summary = violation.a3EstimationSummary;
  if (!summary) return null;

  const isNoMultiLine = summary.decision === 'no_multiline_blocks';
  const decisionLabel = isNoMultiLine
    ? 'No multi-line text blocks found'
    : 'No risk detected (heuristic)';

  return (
    <Card className="border-border/50">
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap text-base">
          <span className="category-badge flex-shrink-0 text-xs bg-muted/30 text-muted-foreground border border-border">
            A3
          </span>
          <span className="font-bold text-base">Heuristic Estimation Summary (Screenshot)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Summary metrics */}
        <div className={cn('grid grid-cols-2 gap-3', compact ? 'text-xs' : 'text-sm')}>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-medium">Blocks evaluated:</span>
            <span className="font-mono">{summary.blocksEvaluated}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-medium">Multi-line blocks:</span>
            <span className="font-mono">{summary.multiLineBlocks}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-medium">Estimated ratio (median):</span>
            <span className="font-mono">
              {summary.medianRatio !== undefined ? `≈${summary.medianRatio.toFixed(2)}` : '—'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-medium">Decision:</span>
            <Badge variant="outline" className="text-xs">
              {decisionLabel}
            </Badge>
          </div>
        </div>

        {/* Per-block details (top 3) */}
        {summary.perBlockDetails && summary.perBlockDetails.length > 0 && (
          <div className={cn('space-y-2 pt-2 border-t border-border/50', compact ? 'text-xs' : 'text-sm')}>
            <p className="text-muted-foreground font-medium flex items-center gap-1">
              <BarChart3 className="h-3.5 w-3.5" />
              Per-block measurements (top {summary.perBlockDetails.length})
            </p>
            {summary.perBlockDetails.map((block) => (
              <div key={block.blockIndex} className="flex flex-wrap gap-x-4 gap-y-1 pl-2 text-muted-foreground">
                <span>Block #{block.blockIndex}</span>
                <span>Lines: <span className="font-mono text-foreground">{block.linesDetected}</span></span>
                <span>Ratio: <span className="font-mono text-foreground">≈{block.estimatedRatio.toFixed(2)}</span></span>
                <span>Text H: <span className="font-mono text-foreground">{block.textHeightPx}px</span></span>
                <span>Step: <span className="font-mono text-foreground">{block.lineStepPx}px</span></span>
                <span>Conf: <span className="font-mono text-foreground">{Math.round(block.confidence * 100)}%</span></span>
              </div>
            ))}
          </div>
        )}

        {/* No multi-line blocks guidance */}
        {isNoMultiLine && (
          <div className={cn('rounded-lg bg-muted/30 border border-border', compact ? 'p-2' : 'p-3')}>
            <p className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
              A3 requires multi-line paragraph text. Upload ZIP/GitHub for deterministic measurement.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function A3AggregatedCard({ violation, compact = false }: A3AggregatedCardProps) {
  if (!violation.isA3Aggregated) return null;

  // If status is 'informational' (no risk / no blocks), show summary-only card
  if (violation.status === 'informational') {
    return <A3EstimationSummaryCard violation={violation} compact={compact} />;
  }

  const isConfirmed = violation.status === 'confirmed';
  const elements = violation.a3Elements || [];
  const summary = violation.a3EstimationSummary;

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
        {/* Estimation summary (always visible for screenshot) */}
        {summary && (
          <div className={cn('rounded-lg bg-muted/20 border border-border/50 space-y-2', compact ? 'p-2 text-xs' : 'p-3 text-sm')}>
            <p className="text-muted-foreground font-medium flex items-center gap-1">
              <BarChart3 className="h-3.5 w-3.5" />
              Estimation Summary
            </p>
            <div className="grid grid-cols-2 gap-2">
              <span className="text-muted-foreground">Blocks evaluated: <span className="font-mono text-foreground">{summary.blocksEvaluated}</span></span>
              <span className="text-muted-foreground">Multi-line blocks: <span className="font-mono text-foreground">{summary.multiLineBlocks}</span></span>
              <span className="text-muted-foreground">Median ratio: <span className="font-mono text-foreground">{summary.medianRatio !== undefined ? `≈${summary.medianRatio.toFixed(2)}` : '—'}</span></span>
              <span className="text-muted-foreground">Decision: <span className="font-mono text-foreground">Potential Risk</span></span>
            </div>
            {/* Per-block details */}
            {summary.perBlockDetails && summary.perBlockDetails.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-border/30">
                {summary.perBlockDetails.map((block) => (
                  <div key={block.blockIndex} className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                    <span>Block #{block.blockIndex}</span>
                    <span>Lines: <span className="font-mono text-foreground">{block.linesDetected}</span></span>
                    <span>Ratio: <span className="font-mono text-foreground">≈{block.estimatedRatio.toFixed(2)}</span></span>
                    <span>Conf: <span className="font-mono text-foreground">{Math.round(block.confidence * 100)}%</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Element cards */}
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
      </CardContent>
    </Card>
  );
}
