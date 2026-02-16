import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A3ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PotentialSubtypeBadge, SubtypeAdvisoryGuidance } from './PotentialSubtypeUI';

interface A3AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

/** Derive missing-requirement chips from evidence/explanation */
function getMissingChips(evidence?: string, explanation?: string): string[] {
  const chips: string[] = [];
  const src = (evidence || '') + ' ' + (explanation || '');
  if (/missing\s+role|lacks?\s+role/i.test(src)) chips.push('missing role');
  if (/missing.*tabIndex|lacks?.*tabIndex|no\s+tabIndex|not\s+focusable/i.test(src)) chips.push('missing tabIndex');
  if (/missing.*onKeyDown|no\s+onKeyDown|missing.*key\s*handler/i.test(src)) chips.push('missing onKeyDown');
  if (/missing.*onKeyPress|onKeyPress/i.test(src)) chips.push('missing onKeyPress');
  if (/missing.*onKeyUp|onKeyUp/i.test(src)) chips.push('missing onKeyUp');
  if (/non.?semantic|div.*instead|clickable\s+<?(div|span|li)/i.test(src)) chips.push('non-semantic element');
  if (/tabIndex.*-1/i.test(src)) chips.push('tabIndex={-1}');
  if (/no\s+valid\s+href|no\s+href/i.test(src)) chips.push('missing href');
  if (chips.length === 0) chips.push('missing keyboard support');
  return chips;
}

/** Extract a short detection reason */
function getDetection(element: A3ElementSubItem): string {
  if (element.detection) return element.detection;
  const tag = element.elementType || 'element';
  return `Clickable non-semantic <${tag}> without keyboard support`;
}

/** Extract a short 1–2 sentence explanation */
function getShortExplanation(element: A3ElementSubItem): string {
  if (element.explanation.includes('Issue reason:')) {
    const match = element.explanation.match(/Issue reason:\s*(.+?)(?:\n|$)/);
    if (match) return match[1].trim();
  }
  return 'Element is mouse-operable but cannot be reached or activated via Tab, Enter, or Space.';
}

function A3ElementItem({ element, isConfirmed, compact = false }: {
  element: A3ElementSubItem;
  isConfirmed: boolean;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const displayLabel = element.sourceLabel || element.elementLabel;
  const missingChips = getMissingChips(element.evidence, element.explanation);
  const detection = getDetection(element);
  const shortExplanation = getShortExplanation(element);
  const needsNameRole = missingChips.some(c => c === 'missing role');

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn(
        'rounded-lg border space-y-2',
        isConfirmed
          ? 'bg-destructive/5 border-destructive/20'
          : 'bg-warning/5 border-warning/20',
        compact ? 'p-2' : 'p-3'
      )}>
        {/* Header row — matches A2 */}
        <CollapsibleTrigger className="w-full">
          <div className="flex items-start justify-between gap-2 cursor-pointer">
            <div className="flex items-center gap-2 flex-wrap text-left">
              <span className={cn('font-medium', compact ? 'text-sm' : '')}>
                {displayLabel}
              </span>
              {element.elementType && (
                <span className={cn(
                  'text-muted-foreground italic truncate max-w-48',
                  compact ? 'text-xs' : 'text-sm'
                )}>
                  {element.elementType}
                </span>
              )}
              {element.potentialSubtype === 'borderline' && (
                <Badge variant="outline" className="text-xs border-warning/50 text-warning">
                  Borderline
                </Badge>
              )}
              {element.potentialSubtype === 'accuracy' && (
                <PotentialSubtypeBadge subtype="accuracy" compact={compact} />
              )}
              {element.classificationCode && (
                <Badge variant="outline" className="text-xs border-muted-foreground/30 text-muted-foreground">
                  {element.classificationCode}
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

        {/* Location (always visible) — matches A2 */}
        <div className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          <span className="font-medium">📍 </span>
          {element.location}
        </div>

        {/* Expandable details — matches A2 field style */}
        <CollapsibleContent>
          <div className={cn('space-y-2 pt-2 border-t border-border/50', compact ? 'text-xs' : 'text-sm')}>
            {/* Detection */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-20">Detection:</span>
              <span className="font-mono">{detection}</span>
            </div>

            {/* Evidence — chips */}
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-20 flex-shrink-0">Evidence:</span>
              <div className="flex flex-wrap gap-1">
                {missingChips.map((chip, i) => (
                  <span key={i} className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            {/* Confidence */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-20">Confidence:</span>
              <span className={cn(
                'font-mono font-medium',
                isConfirmed ? 'text-destructive' : 'text-warning'
              )}>
                {Math.round(element.confidence * 100)}%
                {isConfirmed ? ' — deterministic' : ' — heuristic'}
              </span>
            </div>

            {/* Requirement */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-20">Requirement:</span>
              <span>
                WCAG 2.1.1 Keyboard
                {needsNameRole && ', WCAG 4.1.2 Name, Role, Value'}
              </span>
            </div>

            {/* Short explanation */}
            <div className="pt-1">
              <p className="text-foreground leading-relaxed">{shortExplanation}</p>
            </div>
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
          <span className="font-bold text-base">Incomplete Keyboard Operability</span>
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
          {elements.length} interactive element{elements.length !== 1 ? 's' : ''} with {isConfirmed ? 'confirmed' : 'potential'} keyboard operability issue{elements.length !== 1 ? 's' : ''} detected.
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

        {!isConfirmed && (
          <SubtypeAdvisoryGuidance
            ruleId="A3"
            potentialSubtype={violation.potentialSubtype}
            fallbackGuidance={violation.advisoryGuidance}
            compact={compact}
          />
        )}
      </CardContent>
    </Card>
  );
}
