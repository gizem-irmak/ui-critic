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
  BG_ASSUMED_DEFAULT: 'Background assumed (#FFFFFF)',
  BG_UNRESOLVED: 'Background unresolved',
  SIZE_UNKNOWN: 'Text size unknown (using 4.5:1)',
  FG_ANTIALIASING: 'Glyph sampling unstable',
  FG_IMPLAUSIBLE: 'Foreground sampling inconsistent',
  FG_SAMPLING_UNRELIABLE: 'Foreground sampling unreliable',
  FG_BG_AMBIGUITY: 'FG/BG ambiguity in enclosed component',
  LOW_CONFIDENCE: 'Low confidence measurement',
  STATIC_ANALYSIS: 'Static code analysis',
};

function A1ElementItem({ element, isConfirmed, compact = false }: { 
  element: A1ElementSubItem; 
  isConfirmed: boolean;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isPerceptual = !!element.perceivedContrast;
  
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
              {isPerceptual && (
                <Badge variant="outline" className="text-xs border-violet-500/50 text-violet-600">
                  Perceptual Estimate
                </Badge>
              )}
              {!isPerceptual && element.nearThreshold && (
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
            
            {/* PERCEPTUAL MODE: Show perceptual assessment instead of colors/ratio */}
            {isPerceptual ? (
              <>
                {/* Perceived Contrast */}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-medium w-20">Contrast:</span>
                  <Badge variant="outline" className={cn('text-xs',
                    element.perceivedContrast === 'low' ? 'border-warning/50 text-warning' : 'border-muted-foreground/50'
                  )}>
                    {element.perceivedContrast === 'low' ? 'Low (perceptual)' : element.perceivedContrast}
                  </Badge>
                </div>
                
                {/* Rationale */}
                {element.perceptualRationale && (
                  <div className="pt-1">
                    <span className="text-muted-foreground font-medium">Rationale: </span>
                    <span className="text-foreground">{element.perceptualRationale}</span>
                  </div>
                )}
                
                {/* Suggested Fix */}
                {element.suggestedFix && (
                  <div className="pt-1">
                    <span className="text-muted-foreground font-medium">Suggestion: </span>
                    <span className="text-foreground">{element.suggestedFix}</span>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* STRUCTURAL MODE: Show foreground/background/ratio */}
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
              </>
            )}
            
            {/* Explanation */}
            <div className="pt-1">
              <p className="text-foreground leading-relaxed">{element.explanation}</p>
            </div>
            
            {/* Reason codes (for structural potential findings only) */}
            {!isConfirmed && !isPerceptual && element.reasonCodes && element.reasonCodes.length > 0 && (
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
  const isPerceptual = violation.evaluationMethod === 'llm_assisted' || violation.inputType === 'screenshots';
  
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
          <span className="font-bold text-base">Insufficient Text Contrast</span>
          <Badge className={cn(
            "gap-1 text-xs",
            isConfirmed 
              ? "bg-destructive/10 text-destructive border-destructive/30" 
              : "bg-warning/10 text-warning border-warning/30"
          )}>
            {elements.length} element{elements.length !== 1 ? 's' : ''}
          </Badge>
          {/* Modality label */}
          {isPerceptual ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-violet-500/10 text-violet-600 border-violet-500/20">
              LLM-Assisted (Perceptual – Screenshot Modality)
            </span>
          ) : (
            <>
              <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-blue-500/10 text-blue-600 border-blue-500/20">
                Deterministic (Structural Evidence)
              </span>
              {violation.evidenceLevel && (
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded border font-medium",
                  violation.evidenceLevel === 'structural_deterministic'
                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                )}>
                  {violation.evidenceLevel === 'structural_deterministic' ? 'Token-Resolved BG' : 'Estimated BG'}
                </span>
              )}
            </>
          )}
        </CardTitle>
          <p className={cn('text-muted-foreground', compact ? 'text-xs mt-2' : 'text-sm mt-2')}>
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
        
        {/* Perceptual disclaimer for screenshot mode */}
        {isPerceptual && (
          <div className={cn(
            'rounded-lg bg-violet-500/5 border border-violet-500/20 mt-3',
            compact ? 'p-2' : 'p-3'
          )}>
            <p className={cn('text-violet-600 italic', compact ? 'text-xs' : 'text-sm')}>
              ⚠️ Screenshot-based contrast assessment is perceptual and requires manual verification using developer tools for WCAG compliance.
            </p>
          </div>
        )}
        
        {/* Advisory guidance for potential findings */}
        {!isConfirmed && !isPerceptual && violation.advisoryGuidance && (
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
