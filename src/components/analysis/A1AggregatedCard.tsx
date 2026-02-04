import { AlertTriangle, AlertCircle, ShieldCheck, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A1ElementSubItem, A1ReasonCode } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface A1AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

const reasonCodeLabels: Record<A1ReasonCode, string> = {
  BG_MIXED: 'Multiple background colors',
  BG_GRADIENT: 'Gradient background',
  BG_IMAGE: 'Image/textured background',
  BG_OVERLAY: 'Transparency/overlay',
  BG_TOO_SMALL_REGION: 'Insufficient background pixels',
  FG_ANTIALIASING: 'Glyph sampling unstable',
  FG_IMPLAUSIBLE: 'Foreground sampling inconsistent',
  FG_SAMPLING_UNRELIABLE: 'Foreground sampling unreliable',
  LOW_CONFIDENCE: 'Low confidence measurement',
  STATIC_ANALYSIS: 'Static code analysis',
};

function A1ElementItem({ element, isConfirmed, compact = false }: { 
  element: A1ElementSubItem; 
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
              {element.nearThreshold && (
                <Badge variant="outline" className="text-xs border-warning/50 text-warning">
                  near-threshold
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
            {/* Foreground */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-20">Foreground:</span>
              {element.foregroundHex ? (
                <span className="flex items-center gap-1">
                  <span className="font-mono">{element.foregroundHex}</span>
                  <span 
                    className="w-3 h-3 rounded border border-border" 
                    style={{ backgroundColor: element.foregroundHex }} 
                  />
                  {element.foregroundConfidence !== undefined && (
                    <span className="text-muted-foreground">
                      ({Math.round(element.foregroundConfidence * 100)}% conf)
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground italic">not measured</span>
              )}
            </div>
            
            {/* Background */}
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-20">Background:</span>
              <div>
                {element.backgroundStatus === 'certain' && element.backgroundHex ? (
                  <span className="flex items-center gap-1">
                    <span className="font-mono">{element.backgroundHex}</span>
                    <span 
                      className="w-3 h-3 rounded border border-border" 
                      style={{ backgroundColor: element.backgroundHex }} 
                    />
                    <span className="text-muted-foreground">(certain)</span>
                  </span>
                ) : element.backgroundStatus === 'uncertain' && element.backgroundCandidates?.length ? (
                  <div className="space-y-1">
                    <span className="text-warning">(uncertain — multiple candidates)</span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {element.backgroundCandidates.map((c, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <span className="font-mono text-xs">{c.hex}</span>
                          <span 
                            className="w-3 h-3 rounded border border-border" 
                            style={{ backgroundColor: c.hex }} 
                          />
                        </span>
                      ))}
                    </div>
                  </div>
                ) : element.backgroundHex ? (
                  <span className="flex items-center gap-1">
                    <span className="font-mono">{element.backgroundHex}</span>
                    <span 
                      className="w-3 h-3 rounded border border-border" 
                      style={{ backgroundColor: element.backgroundHex }} 
                    />
                    <span className="text-warning">({element.backgroundStatus})</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">unmeasurable</span>
                )}
              </div>
            </div>
            
            {/* Contrast */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-20">Contrast:</span>
              {element.contrastNotMeasurable ? (
                <span className="text-muted-foreground italic">not measurable</span>
              ) : element.contrastRange ? (
                <span>
                  <span className={cn(
                    'font-mono font-medium',
                    isConfirmed ? 'text-destructive' : 'text-warning'
                  )}>
                    {element.contrastRange.min.toFixed(1)}:1 – {element.contrastRange.max.toFixed(1)}:1
                  </span>
                  <span className="text-muted-foreground ml-1">(range)</span>
                </span>
              ) : element.contrastRatio !== undefined ? (
                <span className={cn(
                  'font-mono font-medium',
                  isConfirmed ? 'text-destructive' : 'text-warning'
                )}>
                  {element.contrastRatio.toFixed(1)}:1
                </span>
              ) : (
                <span className="text-muted-foreground italic">not computed</span>
              )}
              <span className="text-muted-foreground">
                vs {element.thresholdUsed}:1 threshold
              </span>
            </div>
            
            {/* Explanation */}
            <div className="pt-1">
              <p className="text-foreground leading-relaxed">{element.explanation}</p>
            </div>
            
            {/* Reason codes (for potential findings) */}
            {!isConfirmed && element.reasonCodes && element.reasonCodes.length > 0 && (
              <div className="flex items-start gap-2 pt-1">
                <Info className="h-3 w-3 text-warning mt-0.5 flex-shrink-0" />
                <div className="flex flex-wrap gap-1">
                  {element.reasonCodes.map((code) => (
                    <Badge 
                      key={code} 
                      variant="outline" 
                      className="text-xs border-warning/50 text-warning"
                    >
                      {reasonCodeLabels[code] || code}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function A1AggregatedCard({ violation, compact = false }: A1AggregatedCardProps) {
  if (!violation.isA1Aggregated || !violation.a1Elements) {
    return null;
  }
  
  const isConfirmed = violation.status === 'confirmed';
  const elements = violation.a1Elements;
  
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
            A1
          </span>
          <span className="font-medium text-sm">Insufficient Text Contrast</span>
          <Badge className={cn(
            "gap-1 text-xs",
            isConfirmed 
              ? "bg-destructive/10 text-destructive border-destructive/30" 
              : "bg-warning/10 text-warning border-warning/30"
          )}>
            {elements.length} element{elements.length !== 1 ? 's' : ''}
          </Badge>
        </CardTitle>
        <p className={cn('text-muted-foreground mt-1', compact ? 'text-xs' : 'text-sm')}>
          {violation.diagnosis}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((element, idx) => (
          <A1ElementItem 
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
