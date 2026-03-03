import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A2ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PotentialSubtypeBadge, SubtypeAdvisoryGuidance } from './PotentialSubtypeUI';
import { LocationBadge } from './LocationBadge';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue, CodeTag,
  ConfidenceValue, MethodBadge, AdvisoryBlock,
} from './CardTypography';

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
  const elementSubtype = (element as any).elementSubtype;
  const isBorderline = element.potentialSubtype === 'borderline';
  const effectiveFilePath = element.filePath || element.location;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <ElementItemWrapper isConfirmed={isConfirmed} compact={compact}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-2 cursor-pointer">
            <div className="flex items-center gap-2 flex-wrap text-left">
              <ComponentTitle>{displayLabel}</ComponentTitle>
              {elementSubtype && elementSubtype !== element.elementTag && (
                <span className="text-xs text-muted-foreground font-mono">({elementSubtype})</span>
              )}
              {element.affectedComponents && element.affectedComponents.length > 1 && (
                <Badge variant="outline" className="text-xs font-medium border-muted-foreground/40 text-muted-foreground">
                  {element.affectedComponents.length} components
                </Badge>
              )}
              {isBorderline && (
                <Badge variant="outline" className="text-xs font-medium border-warning/50 text-warning">
                  Borderline
                </Badge>
              )}
              {element.potentialSubtype === 'accuracy' && (
                <PotentialSubtypeBadge subtype="accuracy" compact={compact} />
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <LocationBadge filePath={effectiveFilePath} compact={compact} startLine={element.startLine} endLine={element.endLine} />
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
            <DetailContainer>
              {/* Element metadata */}
              <FieldRow>
                <FieldLabel>Element:</FieldLabel>
                <FieldValue mono>
                  {element.elementName && element.elementName !== 'unknown'
                    ? element.elementName
                    : (element.elementTag || element.elementType || 'unknown')}
                  {element.elementSource === 'html_tag_fallback' && ' (fallback)'}
                  {element.sourceLabel && element.sourceLabel !== element.elementLabel && element.sourceLabel !== element.elementName ? ` (${element.sourceLabel})` : ''}
                  {element.selectorHints && element.selectorHints.length > 0 ? ` — ${element.selectorHints.join(' — ')}` : ''}
                  {' — Focusable: '}
                  {element.focusable === 'yes' ? 'Yes' : element.focusable === 'no' ? 'No' : 'Unknown'}
                </FieldValue>
              </FieldRow>

              {/* Affected components (when grouped) */}
              {element.affectedComponents && element.affectedComponents.length > 1 && (
                <FieldRow>
                  <FieldLabel>Components:</FieldLabel>
                  <FieldValue mono>{element.affectedComponents.join(', ')}</FieldValue>
                </FieldRow>
              )}

              <FieldRow>
                <FieldLabel>Detection:</FieldLabel>
                <div className="flex flex-col gap-0.5">
                  {(element.detection || '').split('\n').filter(Boolean).map((line, i) => (
                    <span key={i} className="text-sm font-mono text-foreground">{line}</span>
                  ))}
                </div>
              </FieldRow>

              {/* Requirement */}
              <FieldRow>
                <FieldLabel>Requirement:</FieldLabel>
                <FieldValue>WCAG 2.4.7 Focus Visible</FieldValue>
              </FieldRow>

              {/* Source location */}
              {effectiveFilePath && (
                <FieldRow>
                  <FieldLabel>Source:</FieldLabel>
                  <FieldValue mono>
                    {(() => {
                      const fp = effectiveFilePath;
                      const basename = fp.replace(/\\/g, '/').split('/').pop() || fp;
                      if (element.startLine != null) {
                        const end = element.endLine != null && element.endLine !== element.startLine
                          ? `–${element.endLine}` : '';
                        return `${basename}:${element.startLine}${end}`;
                      }
                      return basename;
                    })()}
                  </FieldValue>
                </FieldRow>
              )}
            </DetailContainer>
          ) : (
            <DetailContainer>
              {/* Element metadata */}
              <FieldRow>
                <FieldLabel>Element:</FieldLabel>
                <FieldValue mono>
                  {element.elementName && element.elementName !== 'unknown'
                    ? element.elementName
                    : (element.elementTag || element.elementType || 'unknown')}
                  {element.elementSource === 'html_tag_fallback' && ' (fallback)'}
                  {element.sourceLabel && element.sourceLabel !== element.elementLabel && element.sourceLabel !== element.elementName ? ` (${element.sourceLabel})` : ''}
                  {element.selectorHints && element.selectorHints.length > 0 ? ` — ${element.selectorHints.join(' — ')}` : ''}
                  {' — Focusable: '}
                  {element.focusable === 'yes' ? 'Yes' : element.focusable === 'no' ? 'No' : 'Unknown'}
                </FieldValue>
              </FieldRow>

              {/* Detection */}
              {element.detection && (
                <FieldRow>
                  <FieldLabel>Detection:</FieldLabel>
                  <div className="flex flex-col gap-0.5">
                    {element.detection.split('\n').filter(Boolean).map((line, i) => (
                      <span key={i} className="text-sm font-mono text-foreground">{line}</span>
                    ))}
                  </div>
                </FieldRow>
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
                    <FieldRow>
                      <FieldLabel>Reason:</FieldLabel>
                      <span className="text-sm text-warning">{parts.join(' + ')}</span>
                    </FieldRow>
                  );
                }
                return null;
              })()}

              {/* Focus classes */}
              {element.focusClasses && element.focusClasses.length > 0 && (
                <FieldRow>
                  <FieldLabel>Classes:</FieldLabel>
                  <div className="flex flex-wrap gap-1">
                    {element.focusClasses.map((cls, i) => (
                      <CodeTag key={i}>{cls}</CodeTag>
                    ))}
                  </div>
                </FieldRow>
              )}

              {/* Confidence */}
              <FieldRow>
                <FieldLabel>Confidence:</FieldLabel>
                <ConfidenceValue value={element.confidence} />
              </FieldRow>

              {/* Method */}
              <FieldRow>
                <FieldLabel>Method:</FieldLabel>
                <MethodBadge method={element.detectionMethod || 'deterministic'} />
              </FieldRow>

              {/* Requirement */}
              <FieldRow>
                <FieldLabel>Requirement:</FieldLabel>
                <FieldValue>WCAG 2.4.7 Focus Visible</FieldValue>
              </FieldRow>

              {/* Source location */}
              {effectiveFilePath && (
                <FieldRow>
                  <FieldLabel>Source:</FieldLabel>
                  <FieldValue mono>
                    {(() => {
                      const fp = effectiveFilePath;
                      const basename = fp.replace(/\\/g, '/').split('/').pop() || fp;
                      if (element.startLine != null) {
                        const end = element.endLine != null && element.endLine !== element.startLine
                          ? `–${element.endLine}` : '';
                        return `${basename}:${element.startLine}${end}`;
                      }
                      return basename;
                    })()}
                  </FieldValue>
                </FieldRow>
              )}

              {/* Potential reason */}
              {element.potentialReason && (
                <FieldRow>
                  <FieldLabel>Reason:</FieldLabel>
                  <span className="text-sm text-warning italic">{element.potentialReason}</span>
                </FieldRow>
              )}

              {/* Explanation */}
              <div className="pt-1">
                {element.explanation.includes('Issue reason:') && element.explanation.includes('Recommended fix:') ? (
                  <>
                    {element.explanation.split('\n').filter(Boolean).map((line, i) => {
                      const isLabel = /^(Issue reason|Recommended fix):/.test(line.trim());
                      return (
                        <p key={i} className={cn(
                          'text-sm leading-relaxed',
                          isLabel ? 'font-medium text-foreground' : 'text-foreground'
                        )}>
                          {line.trim()}
                        </p>
                      );
                    })}
                  </>
                ) : (
                  <p className="text-sm text-foreground leading-relaxed">{element.explanation}</p>
                )}
              </div>
            </DetailContainer>
          )}
        </CollapsibleContent>
      </ElementItemWrapper>
    </Collapsible>
  );
}

export function A2AggregatedCard({ violation, compact = false }: A2AggregatedCardProps) {
  if (!violation.isA2Aggregated || !violation.a2Elements) {
    return null;
  }

  const isConfirmed = violation.status === 'confirmed';
  const elements = [...violation.a2Elements].sort((a, b) => {
    const fpA = (a.filePath || a.location || '').toLowerCase();
    const fpB = (b.filePath || b.location || '').toLowerCase();
    if (fpA !== fpB) return fpA.localeCompare(fpB);
    const lnA = a.startLine ?? Infinity;
    const lnB = b.startLine ?? Infinity;
    if (lnA !== lnB) return lnA - lnB;
    return (a.deduplicationKey || '').localeCompare(b.deduplicationKey || '');
  });

  return (
    <Card className={cn(
      'border',
      isConfirmed ? 'border-destructive/30' : 'border-warning/30'
    )}>
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <RuleIdBadge ruleId="A2" isConfirmed={isConfirmed} categoryClass="category-accessibility" />
          <RuleHeader ruleId="A2" title="Poor Focus Visibility" />
          <ElementCountBadge count={elements.length} isConfirmed={isConfirmed} />
        </CardTitle>
        <CardDescription compact={compact}>
          {isConfirmed
            ? 'Elements remove the default focus outline. Flag as a violation only if no visible focus indicator (ring/border/outline/shadow) is provided.'
            : violation.diagnosis}
        </CardDescription>
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
