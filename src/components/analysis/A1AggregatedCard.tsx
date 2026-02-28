import { AlertTriangle, AlertCircle, ShieldCheck, Info } from 'lucide-react';
import { LocationBadge } from './LocationBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A1ElementSubItem, A1ReasonCode } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue,
} from './CardTypography';

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

  const cleanLabel = element.elementLabel.replace(/\s*\([^)]*\.tsx?\)/, '');
  const cleanLocation = element.location.replace(/^.*?([\w/-]+\.\w+).*$/, '$1');
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <ElementItemWrapper isConfirmed={isConfirmed} compact={compact}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-2 cursor-pointer">
            <ComponentTitle>{cleanLabel}</ComponentTitle>
            <div className="flex items-center gap-2 flex-shrink-0">
              <LocationBadge filePath={cleanLocation} compact={compact} />
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <DetailContainer>
            {/* PERCEPTUAL MODE */}
            {(isPerceptual || isLLMOnly) && !isHybridPixel ? (
              <>
                {element.screenshotTextSize && (
                  <FieldRow>
                    <FieldLabel>Text size:</FieldLabel>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs font-medium">
                        {element.screenshotTextSize === 'large' ? 'Large text' : element.screenshotTextSize === 'unknown' ? 'Unknown (assumed normal)' : 'Normal text'}
                      </Badge>
                      {element.appliedThreshold && (
                        <span className="text-sm text-muted-foreground">
                          Threshold: {element.appliedThreshold}:1
                        </span>
                      )}
                    </div>
                  </FieldRow>
                )}

                <FieldRow>
                  <FieldLabel>Contrast:</FieldLabel>
                  <Badge variant="outline" className={cn('text-xs font-medium',
                    element.perceivedContrast === 'low' ? 'border-warning/50 text-warning' : 'border-muted-foreground/50'
                  )}>
                    {element.perceivedContrast === 'low' ? 'Low (perceptual)' : element.perceivedContrast}
                  </Badge>
                </FieldRow>
                
                {element.perceptualRationale && (
                  <FieldRow>
                    <FieldLabel>Rationale:</FieldLabel>
                    <FieldValue>{element.perceptualRationale}</FieldValue>
                  </FieldRow>
                )}
                
                {element.suggestedFix && (
                  <FieldRow>
                    <FieldLabel>Suggestion:</FieldLabel>
                    <FieldValue>{element.suggestedFix}</FieldValue>
                  </FieldRow>
                )}
              </>
            ) : isConfirmed ? (
              <>
                {/* CONFIRMED STRUCTURAL MODE */}
                {element.jsxTag && (
                  <FieldRow>
                    <FieldLabel>Element:</FieldLabel>
                    <FieldValue mono>&lt;{element.jsxTag}&gt;</FieldValue>
                  </FieldRow>
                )}

                <FieldRow>
                  <FieldLabel>Foreground:</FieldLabel>
                  {element.foregroundHex ? (
                    <span className="flex items-center gap-1 text-sm">
                      <span className="font-mono">{element.foregroundHex}</span>
                      <span 
                        className="w-3 h-3 rounded border border-border" 
                        style={{ backgroundColor: element.foregroundHex }} 
                      />
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">not measured</span>
                  )}
                </FieldRow>

                <FieldRow>
                  <FieldLabel>Background:</FieldLabel>
                  {element.backgroundHex ? (
                    <span className="flex items-center gap-1 text-sm">
                      <span className="font-mono">{element.backgroundHex}</span>
                      <span 
                        className="w-3 h-3 rounded border border-border" 
                        style={{ backgroundColor: element.backgroundHex }} 
                      />
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">unmeasurable</span>
                  )}
                </FieldRow>

                <FieldRow>
                  <FieldLabel>Detection:</FieldLabel>
                  {element.contrastRatio !== undefined ? (
                    <span className="text-sm">
                      <span className="font-mono font-medium text-destructive">
                        Contrast: {element.contrastRatio.toFixed(1)}:1
                      </span>
                      <span className="text-muted-foreground ml-1">
                        vs {element.thresholdUsed}:1
                      </span>
                    </span>
                  ) : element.contrastRange ? (
                    <span className="text-sm">
                      <span className="font-mono font-medium text-destructive">
                        Contrast: {element.contrastRange.min.toFixed(1)}:1 – {element.contrastRange.max.toFixed(1)}:1
                      </span>
                      <span className="text-muted-foreground ml-1">
                        vs {element.thresholdUsed}:1
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">not computed</span>
                  )}
                </FieldRow>

                <FieldRow>
                  <FieldLabel>Requirement:</FieldLabel>
                  <FieldValue>
                    WCAG 1.4.3 — {element.textType === 'large' ? 'Large text' : 'Normal text'} — {element.appliedThreshold || element.thresholdUsed}:1
                  </FieldValue>
                </FieldRow>
              </>
            ) : (
              <>
                {/* POTENTIAL STRUCTURAL MODE */}
                {element.jsxTag && (
                  <FieldRow>
                    <FieldLabel>Element:</FieldLabel>
                    <FieldValue mono>&lt;{element.jsxTag}&gt;</FieldValue>
                  </FieldRow>
                )}

                <FieldRow>
                  <FieldLabel>Foreground:</FieldLabel>
                  {element.foregroundHex ? (
                    <span className="flex items-center gap-1 text-sm">
                      <span className="font-mono">{element.foregroundHex}</span>
                      <span 
                        className="w-3 h-3 rounded border border-border" 
                        style={{ backgroundColor: element.foregroundHex }} 
                      />
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">not measured</span>
                  )}
                </FieldRow>

                <FieldRow>
                  <FieldLabel>Background:</FieldLabel>
                  {element.backgroundHex ? (
                    <span className="flex items-center gap-1 text-sm">
                      <span className="font-mono">{element.backgroundHex}</span>
                      <span 
                        className="w-3 h-3 rounded border border-border" 
                        style={{ backgroundColor: element.backgroundHex }} 
                      />
                      {element.backgroundStatus === 'uncertain' && (
                        <Badge variant="outline" className="text-xs font-medium border-warning/50 text-warning">
                          uncertain
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">unmeasurable</span>
                  )}
                </FieldRow>

                <FieldRow>
                  <FieldLabel>Contrast:</FieldLabel>
                  {element.contrastNotMeasurable ? (
                    <span className="text-sm text-muted-foreground italic">not measurable</span>
                  ) : element.contrastRange ? (
                    <span className="text-sm">
                      <span className="font-mono font-medium text-warning">
                        {element.contrastRange.min.toFixed(1)}:1 – {element.contrastRange.max.toFixed(1)}:1
                      </span>
                      <span className="text-muted-foreground ml-1">
                        vs {element.thresholdUsed}:1
                      </span>
                    </span>
                  ) : element.contrastRatio !== undefined ? (
                    <span className="text-sm">
                      <span className="font-mono font-medium text-warning">
                        {element.contrastRatio.toFixed(1)}:1
                      </span>
                      <span className="text-muted-foreground ml-1">
                        vs {element.thresholdUsed}:1
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">not computed</span>
                  )}
                </FieldRow>

                <FieldRow>
                  <FieldLabel>Requirement:</FieldLabel>
                  <FieldValue>
                    WCAG 1.4.3 — {element.textType === 'large' ? 'Large text' : 'Normal text'} — {element.appliedThreshold || element.thresholdUsed}:1
                  </FieldValue>
                </FieldRow>
              </>
            )}
          </DetailContainer>
        </CollapsibleContent>
      </ElementItemWrapper>
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
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <RuleIdBadge ruleId="A1" isConfirmed={isConfirmed} categoryClass="category-accessibility" />
          <RuleHeader ruleId="A1" title="Insufficient Text Contrast" />
          <ElementCountBadge count={elements.length} isConfirmed={isConfirmed} />
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
        <CardDescription compact={compact}>
          {isConfirmed
            ? 'Text contrast falls below WCAG AA minimum thresholds.'
            : (() => {
                const bgUncertain = elements.some(e => e.backgroundStatus === 'uncertain' || e.backgroundStatus === 'unmeasurable');
                const sizeUnknown = elements.some(e => !e.textType || e.textType === 'normal' && e.appliedThreshold === 4.5 && e.reasonCodes?.includes('SIZE_UNKNOWN'));
                if (bgUncertain && sizeUnknown) {
                  return 'Static analysis detected a potential contrast issue. Background color and text size could not be fully verified.';
                }
                if (bgUncertain) {
                  return 'Static analysis detected a potential contrast issue. The background color could not be deterministically resolved.';
                }
                if (sizeUnknown) {
                  return 'Static analysis detected a potential contrast issue. Text size could not be deterministically verified; the 4.5:1 normal-text threshold was applied.';
                }
                return 'Static analysis detected a potential contrast issue. Background or text size could not be fully verified.';
              })()}
        </CardDescription>
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
        
        {isHybrid && (
          <div className={cn(
            'rounded-lg bg-emerald-500/5 border border-emerald-500/20 mt-3',
            compact ? 'p-2' : 'p-3'
          )}>
            <p className={cn('text-sm text-emerald-600 italic')}>
              🔬 Two-stage hybrid: LLM identified candidate regions → pixel engine measured contrast ratios. Ratios are screenshot estimates — verify with browser DevTools for WCAG compliance.
            </p>
          </div>
        )}
        {isPerceptual && !isHybrid && (
          <div className={cn(
            'rounded-lg bg-violet-500/5 border border-violet-500/20 mt-3',
            compact ? 'p-2' : 'p-3'
          )}>
            <p className="text-sm text-violet-600 italic">
              ⚠️ Screenshot-based contrast assessment is perceptual and requires manual verification using developer tools for WCAG compliance.
            </p>
          </div>
        )}
        
      </CardContent>
    </Card>
  );
}
