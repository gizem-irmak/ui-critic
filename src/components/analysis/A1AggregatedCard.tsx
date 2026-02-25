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
  const isPerceptual = !!element.perceivedContrast && element.a1Method !== 'LLM→Pixel';
  const isHybridPixel = element.a1Method === 'LLM→Pixel';
  const isLLMOnly = element.a1Method === 'LLM-only (measurement failed)';

  // Clean element label: remove parenthesized filename suffix like "A1Contrast (A1Contrast.tsx)"
  const cleanLabel = element.elementLabel.replace(/\s*\([^)]*\.tsx?\)/, '');

  // Clean location: extract just the file path portion
  const cleanLocation = element.location.replace(/^.*?([\w/-]+\.\w+).*$/, '$1');
  
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
                  {cleanLabel}
                </span>
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
        
        {/* Location (always visible) — clean file path only */}
        <div className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          <span className="font-medium">📍 </span>
          {cleanLocation}
        </div>
        
        {/* Expandable details */}
        <CollapsibleContent>
          <div className={cn('space-y-2 pt-2 border-t border-border/50', compact ? 'text-xs' : 'text-sm')}>
            
            {/* PERCEPTUAL MODE (LLM-only, no pixel data): Show perceptual assessment */}
            {(isPerceptual || isLLMOnly) && !isHybridPixel ? (
              <>
                {element.screenshotTextSize && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground font-medium w-20">Text size:</span>
                    <Badge variant="outline" className="text-xs">
                      {element.screenshotTextSize === 'large' ? 'Large text' : element.screenshotTextSize === 'unknown' ? 'Unknown (assumed normal)' : 'Normal text'}
                    </Badge>
                    {element.appliedThreshold && (
                      <span className="text-muted-foreground text-xs">
                        Threshold: {element.appliedThreshold}:1
                      </span>
                    )}
                  </div>
                )}

                {/* Perceived Contrast */}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-medium w-20">Contrast:</span>
                  <Badge variant="outline" className={cn('text-xs',
                    element.perceivedContrast === 'low' ? 'border-warning/50 text-warning' : 'border-muted-foreground/50'
                  )}>
                    {element.perceivedContrast === 'low' ? 'Low (perceptual)' : element.perceivedContrast}
                  </Badge>
                </div>
                
                {element.perceptualRationale && (
                  <div className="pt-1">
                    <span className="text-muted-foreground font-medium">Rationale: </span>
                    <span className="text-foreground">{element.perceptualRationale}</span>
                  </div>
                )}
                
                {element.suggestedFix && (
                  <div className="pt-1">
                    <span className="text-muted-foreground font-medium">Suggestion: </span>
                    <span className="text-foreground">{element.suggestedFix}</span>
                  </div>
                )}
              </>
            ) : isConfirmed ? (
              <>
                {/* CONFIRMED STRUCTURAL MODE — Element → FG → BG → Detection → Requirement → Confidence */}
                
                {/* 1) Element */}
                {element.jsxTag && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground font-medium w-20">Element:</span>
                    <code className="text-foreground font-mono">&lt;{element.jsxTag}&gt;</code>
                  </div>
                )}

                {/* 2) Foreground */}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-medium w-20">Foreground:</span>
                  {element.foregroundHex ? (
                    <span className="flex items-center gap-1">
                      <span className="font-mono">{element.foregroundHex}</span>
                      <span 
                        className="w-3 h-3 rounded border border-border" 
                        style={{ backgroundColor: element.foregroundHex }} 
                      />
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">not measured</span>
                  )}
                </div>

                {/* 3) Background */}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-medium w-20">Background:</span>
                  {element.backgroundHex ? (
                    <span className="flex items-center gap-1">
                      <span className="font-mono">{element.backgroundHex}</span>
                      <span 
                        className="w-3 h-3 rounded border border-border" 
                        style={{ backgroundColor: element.backgroundHex }} 
                      />
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">unmeasurable</span>
                  )}
                </div>

                {/* 4) Detection — ratio vs threshold */}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-medium w-20">Detection:</span>
                  {element.contrastRatio !== undefined ? (
                    <span>
                      <span className="font-mono font-medium text-destructive">
                        Contrast: {element.contrastRatio.toFixed(1)}:1
                      </span>
                      <span className="text-muted-foreground ml-1">
                        vs {element.thresholdUsed}:1
                      </span>
                    </span>
                  ) : element.contrastRange ? (
                    <span>
                      <span className="font-mono font-medium text-destructive">
                        Contrast: {element.contrastRange.min.toFixed(1)}:1 – {element.contrastRange.max.toFixed(1)}:1
                      </span>
                      <span className="text-muted-foreground ml-1">
                        vs {element.thresholdUsed}:1
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">not computed</span>
                  )}
                </div>

                {/* 5) Requirement */}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-medium w-20">Requirement:</span>
                  <span>
                    WCAG 1.4.3 — {element.textType === 'large' ? 'Large text' : 'Normal text'} — {element.appliedThreshold || element.thresholdUsed}:1
                  </span>
                </div>
              </>
            ) : (
              <>
                {/* POTENTIAL STRUCTURAL MODE — mirrors confirmed layout */}

                {/* 1) Element */}
                {element.jsxTag && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground font-medium w-20">Element:</span>
                    <code className="text-foreground font-mono">&lt;{element.jsxTag}&gt;</code>
                  </div>
                )}

                {/* 2) Foreground */}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-medium w-20">Foreground:</span>
                  {element.foregroundHex ? (
                    <span className="flex items-center gap-1">
                      <span className="font-mono">{element.foregroundHex}</span>
                      <span 
                        className="w-3 h-3 rounded border border-border" 
                        style={{ backgroundColor: element.foregroundHex }} 
                      />
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">not measured</span>
                  )}
                </div>

                {/* 3) Background */}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-medium w-20">Background:</span>
                  {element.backgroundHex ? (
                    <span className="flex items-center gap-1">
                      <span className="font-mono">{element.backgroundHex}</span>
                      <span 
                        className="w-3 h-3 rounded border border-border" 
                        style={{ backgroundColor: element.backgroundHex }} 
                      />
                      {element.backgroundStatus === 'uncertain' && (
                        <Badge variant="outline" className="text-xs border-warning/50 text-warning">
                          uncertain
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">unmeasurable</span>
                  )}
                </div>

                {/* 4) Contrast */}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-medium w-20">Contrast:</span>
                  {element.contrastNotMeasurable ? (
                    <span className="text-muted-foreground italic">not measurable</span>
                  ) : element.contrastRange ? (
                    <span>
                      <span className="font-mono font-medium text-warning">
                        {element.contrastRange.min.toFixed(1)}:1 – {element.contrastRange.max.toFixed(1)}:1
                      </span>
                      <span className="text-muted-foreground ml-1">
                        vs {element.thresholdUsed}:1
                      </span>
                    </span>
                  ) : element.contrastRatio !== undefined ? (
                    <span>
                      <span className="font-mono font-medium text-warning">
                        {element.contrastRatio.toFixed(1)}:1
                      </span>
                      <span className="text-muted-foreground ml-1">
                        vs {element.thresholdUsed}:1
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">not computed</span>
                  )}
                </div>

                {/* 5) Requirement */}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-medium w-20">Requirement:</span>
                  <span>
                    WCAG 1.4.3 — {element.textType === 'large' ? 'Large text' : 'Normal text'} — {element.appliedThreshold || element.thresholdUsed}:1
                  </span>
                </div>

              </>
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
  const isHybrid = violation.evaluationMethod === 'hybrid_deterministic';
  
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
          {/* Modality label — only for screenshot modes */}
          {isHybrid ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
              LLM→Pixel Hybrid (Screenshot)
            </span>
          ) : isPerceptual ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-violet-500/10 text-violet-600 border-violet-500/20">
              LLM-Assisted (Perceptual – Screenshot Modality)
            </span>
          ) : null}
        </CardTitle>
        <p className={cn('text-muted-foreground', compact ? 'text-xs mt-2' : 'text-sm mt-2')}>
          {isConfirmed
            ? 'Text contrast falls below WCAG AA minimum thresholds.'
            : 'Static analysis detected a potential contrast issue. Background or text size could not be fully verified.'}
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
        
        {/* Hybrid/Perceptual disclaimer for screenshot mode */}
        {isHybrid && (
          <div className={cn(
            'rounded-lg bg-emerald-500/5 border border-emerald-500/20 mt-3',
            compact ? 'p-2' : 'p-3'
          )}>
            <p className={cn('text-emerald-600 italic', compact ? 'text-xs' : 'text-sm')}>
              🔬 Two-stage hybrid: LLM identified candidate regions → pixel engine measured contrast ratios. Ratios are screenshot estimates — verify with browser DevTools for WCAG compliance.
            </p>
          </div>
        )}
        {isPerceptual && !isHybrid && (
          <div className={cn(
            'rounded-lg bg-violet-500/5 border border-violet-500/20 mt-3',
            compact ? 'p-2' : 'p-3'
          )}>
            <p className={cn('text-violet-600 italic', compact ? 'text-xs' : 'text-sm')}>
              ⚠️ Screenshot-based contrast assessment is perceptual and requires manual verification using developer tools for WCAG compliance.
            </p>
          </div>
        )}
        
      </CardContent>
    </Card>
  );
}
