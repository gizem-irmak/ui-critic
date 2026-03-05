import { AlertTriangle } from 'lucide-react';
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
  FieldRow, FieldLabel, FieldValue, AdvisoryBlock,
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

function A1ScreenshotElementItem({ element, compact = false }: {
  element: A1ElementSubItem;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const cleanLabel = element.elementLabel.replace(/\s*\([^)]*\.tsx?\)/, '');
  const cleanLocation = element.location.replace(/^.*?([\w/-]+\.\w+).*$/, '$1');

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <ElementItemWrapper isConfirmed={false} compact={compact}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-2 cursor-pointer">
            <div className="flex items-center gap-2">
              <ComponentTitle>{cleanLabel}</ComponentTitle>
              <Badge variant="outline" className="text-[10px] font-medium border-amber-500/40 text-amber-600">
                Perceptual
              </Badge>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <LocationBadge filePath={cleanLocation} displayName={cleanLocation} compact={compact} />
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
            {element.perceptualRationale && (
              <FieldRow>
                <FieldLabel>Visual rationale:</FieldLabel>
                <FieldValue>{element.perceptualRationale}</FieldValue>
              </FieldRow>
            )}

            <FieldRow>
              <FieldLabel>Requirement:</FieldLabel>
              <FieldValue>
                WCAG 2.1 — 1.4.3 Contrast (Minimum) — {element.textType === 'large' ? 'Large text: 3:1' : 'Normal text: 4.5:1'}
              </FieldValue>
            </FieldRow>

            {element.confidence != null && (
              <FieldRow>
                <FieldLabel>Confidence:</FieldLabel>
                <span className="text-sm font-medium text-warning">
                  {Math.round((element.confidence as number) * 100)}%
                </span>
              </FieldRow>
            )}
          </DetailContainer>
        </CollapsibleContent>
      </ElementItemWrapper>
    </Collapsible>
  );
}
function A1CodeElementItem({ element, isConfirmed, compact = false }: { 
  element: A1ElementSubItem; 
  isConfirmed: boolean;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const fgResolved = element.foreground?.resolved ?? element.resolutionStatus?.fg !== 'unresolved';
  const bgResolved = element.background?.resolved ?? element.resolutionStatus?.bg !== 'unresolved';
  const insufficientColorContext = !fgResolved || !bgResolved || element.backgroundStatus === 'uncertain' || element.backgroundStatus === 'unmeasurable' || !!element.contrastNotMeasurable;

  const cleanLabel = element.elementLabel.replace(/\s*\([^)]*\.tsx?\)/, '');
  const cleanLocation = element.location.replace(/^.*?([\w/-]+\.\w+).*$/, '$1');
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <ElementItemWrapper isConfirmed={isConfirmed} compact={compact}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-2 cursor-pointer">
            <div className="flex items-center gap-2">
              <ComponentTitle>{cleanLabel}</ComponentTitle>
              {element.variant && (
                <Badge variant="outline" className="text-[10px] font-medium border-amber-500/40 text-amber-600">
                  {element.variant} state
                </Badge>
              )}
            </div>
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
            {isConfirmed ? (
              <>
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
                  {(!insufficientColorContext && element.contrastRatio !== undefined) ? (
                    <span className="text-sm">
                      <span className="font-mono font-medium text-destructive">
                        Contrast: {element.contrastRatio.toFixed(1)}:1
                      </span>
                      <span className="text-muted-foreground ml-1">
                        vs {element.thresholdUsed}:1
                      </span>
                    </span>
                  ) : (!insufficientColorContext && element.contrastRange) ? (
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
                  {(!bgResolved || element.backgroundStatus === 'uncertain' || element.backgroundStatus === 'unmeasurable') ? (
                    <span className="flex items-center gap-1 text-sm">
                      <span className="text-muted-foreground italic">unresolved</span>
                      <Badge variant="outline" className="text-xs font-medium border-warning/50 text-warning">
                        uncertain
                      </Badge>
                    </span>
                  ) : element.backgroundHex ? (
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
                  <FieldLabel>Contrast:</FieldLabel>
                  {insufficientColorContext ? (
                    <span className="text-sm text-muted-foreground italic">Not computed (insufficient color context)</span>
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
                    <span className="text-sm text-muted-foreground italic">Not computed (insufficient color context)</span>
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
  const isScreenshot = violation.inputType === 'screenshots';
  const isPerceptual = violation.evaluationMethod === 'llm_assisted' || isScreenshot;
  
  // Determine subtitle based on modality
  const getSubtitle = () => {
    if (isScreenshot || isPerceptual) {
      return 'Perceptual analysis suggests potential contrast issues. Exact contrast ratios could not be computed from the screenshot and require manual verification.';
    }
    if (isConfirmed) {
      return 'Text contrast falls below WCAG AA minimum thresholds.';
    }
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
  };

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
          {(isPerceptual || isScreenshot) && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-violet-500/10 text-violet-600 border-violet-500/20">
              Perceptual (Screenshot)
            </span>
          )}
        </CardTitle>
        <CardDescription compact={compact}>
          {getSubtitle()}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((element, idx) =>
          (isScreenshot || isPerceptual) ? (
            <A1ScreenshotElementItem
              key={element.deduplicationKey || idx}
              element={element}
              compact={compact}
            />
          ) : (
            <A1CodeElementItem 
              key={element.deduplicationKey || idx} 
              element={element} 
              isConfirmed={isConfirmed}
              compact={compact}
            />
          )
        )}
        
        {(isPerceptual || isScreenshot) && (
          <div className={cn(
            'rounded-lg bg-violet-500/5 border border-violet-500/20 mt-3',
            compact ? 'p-2' : 'p-3'
          )}>
            <p className="text-sm text-violet-600 italic">
              Screenshot-based contrast assessment is perceptual. Verify contrast using browser dev tools or a color picker. Target WCAG 2.1 SC 1.4.3: 4.5:1 for normal text, 3:1 for large text.
            </p>
          </div>
        )}

        {!isConfirmed && !isPerceptual && !isScreenshot && elements.some(e =>
          (!e.foreground?.resolved || !e.background?.resolved || e.backgroundStatus === 'uncertain' || e.backgroundStatus === 'unmeasurable' || e.contrastNotMeasurable) &&
          e.contrastRatio === undefined && !e.contrastRange
        ) && (
          <AdvisoryBlock compact={compact}>
            Background color could not be resolved through static analysis. Provide a rendered screenshot or enable runtime contrast sampling to compute effective contrast.
          </AdvisoryBlock>
        )}
        
      </CardContent>
    </Card>
  );
}
