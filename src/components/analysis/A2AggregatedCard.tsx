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
} from './CardTypography';

interface A2AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

/* ─── Build a single concise detection sentence ─── */
function buildDetectionSentence(element: A2ElementSubItem): string {
  const parts: string[] = [];
  const classes = (element.focusClasses || []).join(' ');

  // Outline removal
  if (/outline-none|outline-0/.test(classes)) parts.push('Outline removed');
  else if (/ring-0/.test(classes)) parts.push('Ring reset');

  // Replacement description
  const hasFocusBg = /focus:bg-|data-\[.*\]:bg-/.test(classes);
  const hasFocusText = /focus:text-|data-\[.*\]:text-/.test(classes);
  const hasFocusRing = /focus:ring-|focus:border-|focus:shadow-|focus:outline-/.test(classes);

  if (hasFocusRing) {
    parts.push('has ring/border replacement');
  } else if (hasFocusBg || hasFocusText) {
    const signals: string[] = [];
    if (hasFocusBg) signals.push('bg');
    if (hasFocusText) signals.push('text');
    parts.push(`uses ${signals.join('/')} change — perceptibility not statically verifiable`);
  } else {
    parts.push('no visible focus indicator detected');
  }

  return parts.join('; ');
}

/* ─── Extract matched tokens (minimal trigger set) ─── */
function getMatchedTokens(element: A2ElementSubItem): string[] {
  if (!element.focusClasses || element.focusClasses.length === 0) return [];
  // Return only classes relevant to focus/outline — the trigger set
  return element.focusClasses.filter(cls =>
    /outline|ring|focus:|data-\[.*\]:|border-0/.test(cls)
  );
}

function A2ElementItem({ element, isConfirmed, compact = false }: {
  element: A2ElementSubItem;
  isConfirmed: boolean;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const elementIsConfirmed = element.classification
    ? element.classification === 'confirmed'
    : isConfirmed;
  const displayLabel = element.elementName && element.elementName !== 'unknown'
    ? element.elementName
    : (element.sourceLabel || element.elementLabel);
  const elementSubtype = (element as any).elementSubtype;
  const isBorderline = element.potentialSubtype === 'borderline';
  const effectiveFilePath = element.filePath || element.location;
  const matchedTokens = getMatchedTokens(element);
  const detectionSentence = buildDetectionSentence(element);
  const rawClassName = (element as any).rawClassName;

  // Confidence as small badge value
  const confidencePct = element.confidence != null ? Math.round(element.confidence * 100) : null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <ElementItemWrapper isConfirmed={elementIsConfirmed} compact={compact}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-2 cursor-pointer">
            <div className="flex items-center gap-2 flex-wrap text-left">
              <ComponentTitle>{displayLabel}</ComponentTitle>
              {elementSubtype && elementSubtype !== element.elementTag && (
                <span className="text-xs text-muted-foreground font-mono">({elementSubtype})</span>
              )}
              <Badge
                variant="outline"
                className={cn(
                  'text-xs font-medium',
                  elementIsConfirmed
                    ? 'border-destructive/50 text-destructive'
                    : 'border-warning/50 text-warning'
                )}
              >
                {elementIsConfirmed ? 'Confirmed' : 'Potential'}
              </Badge>
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
              {/* Inline confidence badge for potential items */}
              {!elementIsConfirmed && confidencePct != null && (
                <span className="text-xs font-mono font-medium text-warning">{confidencePct}%</span>
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
          <DetailContainer>
            {/* Element (compact single line) */}
            <FieldRow>
              <FieldLabel>Element:</FieldLabel>
              <FieldValue mono>
                {element.elementName && element.elementName !== 'unknown'
                  ? element.elementName
                  : (element.elementTag || element.elementType || 'unknown')}
                {element.elementSource === 'html_tag_fallback' && ' (fallback)'}
                {element.selectorHints && element.selectorHints.length > 0 ? ` — ${element.selectorHints.join(' — ')}` : ''}
                {' • Focusable: '}
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

            {/* Detection: single concise sentence */}
            <FieldRow>
              <FieldLabel>Detection:</FieldLabel>
              <FieldValue>{detectionSentence}</FieldValue>
            </FieldRow>

            {/* Matched tokens (compact chips) */}
            {matchedTokens.length > 0 && (
              <FieldRow>
                <FieldLabel>Tokens:</FieldLabel>
                <div className="flex flex-wrap gap-1">
                  {matchedTokens.map((cls, i) => (
                    <CodeTag key={i}>{cls}</CodeTag>
                  ))}
                </div>
              </FieldRow>
            )}

            {/* Source */}
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

            {/* Optional expandable raw class */}
            {rawClassName && (
              <div>
                <button
                  onClick={() => setShowRaw(!showRaw)}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  {showRaw ? 'Hide details' : 'Show details'}
                </button>
                {showRaw && (
                  <div className="mt-1">
                    <FieldRow>
                      <FieldLabel>Class Raw:</FieldLabel>
                      <FieldValue mono>{rawClassName}</FieldValue>
                    </FieldRow>
                  </div>
                )}
              </div>
            )}
          </DetailContainer>
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
          <Badge variant="outline" className="text-xs font-medium border-muted-foreground/40 text-muted-foreground">
            WCAG 2.4.7
          </Badge>
          <Badge variant="outline" className="text-xs font-medium border-blue-500/50 text-blue-600">
            Deterministic
          </Badge>
        </CardTitle>
        <CardDescription compact={compact}>
          {isConfirmed
            ? 'Elements remove the default focus outline with no visible replacement indicator.'
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
