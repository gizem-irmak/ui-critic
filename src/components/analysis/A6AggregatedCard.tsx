import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { Violation, A6ElementSubItem } from '@/types/project';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface A6AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

function extractFileName(location: string): string {
  if (!location) return '';
  const parts = location.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || location;
}

function A6ElementItem({ element, compact = false }: {
  element: A6ElementSubItem;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.sourceLabel || element.elementLabel;
  const fileName = extractFileName(element.location);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={cn(
        'rounded-lg border space-y-0 bg-destructive/5 border-destructive/20',
        compact ? 'p-2' : 'p-3'
      )}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-2 cursor-pointer">
            <span className={cn('font-medium text-left', compact ? 'text-sm' : '')}>
              {displayLabel}
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              {fileName && (
                <span className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
                  📍 {fileName}
                </span>
              )}
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className={cn('space-y-2 pt-2 mt-2 border-t border-border/50', compact ? 'text-xs' : 'text-sm')}>

            {element.detection && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-medium w-20">Detection:</span>
                <span className="font-mono text-xs">{element.detection}</span>
              </div>
            )}

            {element.evidence && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground font-medium w-20">Evidence:</span>
                <span className="font-mono text-xs">{element.evidence}</span>
              </div>
            )}

            <div className="flex items-start gap-2">
              <span className="text-muted-foreground font-medium w-20">Requirement:</span>
              <span>WCAG 2.1 — 4.1.2 Name, Role, Value (Level A)</span>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function A6AggregatedCard({ violation, compact = false }: A6AggregatedCardProps) {
  const rawElements: A6ElementSubItem[] = (violation.isA6Aggregated && violation.a6Elements)
    ? violation.a6Elements
    : [{
        elementLabel: violation.evidence || violation.diagnosis?.split('.')[0] || 'Interactive element',
        elementType: undefined,
        location: violation.evidence || '',
        detection: undefined,
        evidence: violation.evidence,
        subCheck: 'A6.1',
        subCheckLabel: 'Missing accessible name',
        classification: 'confirmed',
        explanation: violation.diagnosis || '',
        wcagCriteria: ['4.1.2'],
        correctivePrompt: violation.correctivePrompt,
        deduplicationKey: `${violation.ruleId}-fallback`,
      }];

  // Suppress A6.1 for elements that also have A6.2 (A6.2 takes precedence)
  const a62Keys = new Set(
    rawElements.filter(el => el.subCheck === 'A6.2').map(el => el.deduplicationKey?.replace('-A6.2', '') ?? el.elementLabel)
  );
  const elements = rawElements.filter(el => {
    if (el.subCheck !== 'A6.1') return true;
    const baseKey = el.deduplicationKey?.replace('-A6.1', '') ?? el.elementLabel;
    return !a62Keys.has(baseKey);
  });

  return (
    <Card className="border border-destructive/30">
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap text-base">
          <span className="category-badge flex-shrink-0 text-xs category-accessibility">
            A6
          </span>
          <span className="font-bold text-base">Missing Accessible Names</span>
          <Badge className="gap-1 text-xs bg-destructive/10 text-destructive border-destructive/30">
            {elements.length} element{elements.length !== 1 ? 's' : ''}
          </Badge>
        </CardTitle>
        <p className={cn('text-muted-foreground', compact ? 'text-xs mt-2' : 'text-sm mt-2')}>
          Interactive elements must have programmatic accessible names (WCAG 4.1.2).
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((element, idx) => (
          <A6ElementItem
            key={element.deduplicationKey || idx}
            element={element}
            compact={compact}
          />
        ))}
      </CardContent>
    </Card>
  );
}
