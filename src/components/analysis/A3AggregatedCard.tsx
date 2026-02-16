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

/** Parse "missing X, Y, Z" from evidence into a list */
function parseMissing(evidence?: string, explanation?: string): string[] {
  const missing: string[] = [];
  const src = evidence || explanation || '';
  if (/missing\s+role/i.test(src) || /lacks?\s+role/i.test(src)) missing.push('role (e.g., role="button")');
  if (/missing.*tabIndex/i.test(src) || /lacks?.*tabIndex/i.test(src) || /no\s+tabIndex/i.test(src)) missing.push('tabIndex={0} for keyboard focusability');
  if (/missing.*keyboard/i.test(src) || /lacks?.*keyboard/i.test(src) || /no\s+onKeyDown/i.test(src) || /missing.*key\s*handler/i.test(src)) missing.push('onKeyDown handler for Enter/Space activation');
  if (/tabIndex.*-1/i.test(src)) missing.push('tabIndex removed from tab order (tabIndex={-1})');
  if (/no\s+valid\s+href/i.test(src) || /no\s+href/i.test(src)) missing.push('Valid href attribute or role="button"');
  if (missing.length === 0) missing.push('Keyboard accessibility support');
  return missing;
}

/** Extract issue reason from explanation */
function getIssueReason(element: A3ElementSubItem): string {
  if (element.explanation.includes('Issue reason:')) {
    const match = element.explanation.match(/Issue reason:\s*(.+?)(?:\n|$)/);
    if (match) return match[1].trim();
  }
  return element.explanation;
}

/** Extract recommended fix from explanation, or generate one */
function getRecommendedFix(element: A3ElementSubItem): string {
  if (element.explanation.includes('Recommended fix:')) {
    const match = element.explanation.match(/Recommended fix:\s*(.+?)$/s);
    if (match) return match[1].trim();
  }
  const tag = element.elementType || 'element';
  if (tag === 'a') {
    return 'Replace the <a> with a semantic <button>, or add a valid href for navigation.';
  }
  if (/tabIndex.*-1/i.test(element.evidence || '')) {
    return `Remove tabIndex={-1} from the <${tag}> or provide an alternative keyboard-accessible path.`;
  }
  return `Replace the clickable <${tag}> with a semantic <button> or <a> element, OR add role="button", tabIndex={0}, and an onKeyDown handler that activates on Enter and Space.`;
}

function A3ElementItem({ element, isConfirmed, compact = false }: {
  element: A3ElementSubItem;
  isConfirmed: boolean;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const displayLabel = element.sourceLabel || element.elementLabel;
  const missingItems = parseMissing(element.evidence, element.explanation);
  const issueReason = getIssueReason(element);
  const recommendedFix = getRecommendedFix(element);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn(
        'rounded-lg border space-y-2',
        isConfirmed
          ? 'bg-destructive/5 border-destructive/20'
          : 'bg-warning/5 border-warning/20',
        compact ? 'p-2' : 'p-3'
      )}>
        {/* Header row — matches A1/A2 typography */}
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

        {/* Location (always visible) — matches A1/A2 */}
        <div className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          <span className="font-medium">📍 </span>
          {element.location}
        </div>

        {/* Expandable details — structured rows matching A1/A2 field order */}
        <CollapsibleContent>
          <div className={cn('space-y-2 pt-2 border-t border-border/50', compact ? 'text-xs' : 'text-sm')}>
            {/* Element */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-28">Element:</span>
              <span className="font-mono">{element.elementType || 'unknown'}{element.role ? ` (role="${element.role}")` : ''}</span>
            </div>

            {/* Location */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-28">Location:</span>
              <span className="font-mono text-foreground">{element.location}</span>
            </div>

            {/* Trigger */}
            {element.detection && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-28">Trigger:</span>
                <span className="font-mono">{element.detection}</span>
              </div>
            )}

            {/* Missing */}
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-28 flex-shrink-0">Missing:</span>
              <ul className="list-disc list-inside space-y-0.5">
                {missingItems.map((item, i) => (
                  <li key={i} className="text-foreground">{item}</li>
                ))}
              </ul>
            </div>

            {/* Requirement */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-28">Requirement:</span>
              <span>WCAG 2.1.1 — Keyboard</span>
            </div>

            {/* Impact */}
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-28 flex-shrink-0">Impact:</span>
              <span className="text-foreground leading-relaxed">{issueReason}</span>
            </div>

            {/* Recommended fix */}
            <div className="flex items-start gap-2 pt-1">
              <span className="text-muted-foreground font-medium w-28 flex-shrink-0">Fix:</span>
              <span className="text-foreground leading-relaxed">{recommendedFix}</span>
            </div>

            {/* Confidence */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium w-28">Confidence:</span>
              <span className={cn(
                'font-mono font-medium',
                isConfirmed ? 'text-destructive' : 'text-warning'
              )}>
                {Math.round(element.confidence * 100)}%
              </span>
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
          {elements.length} interactive element{elements.length !== 1 ? 's' : ''} with {isConfirmed ? 'confirmed' : 'potential'} keyboard operability issues detected.
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

        {/* Advisory guidance for potential findings — matches A2 */}
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
