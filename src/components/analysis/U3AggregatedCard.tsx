import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { LocationBadge } from './LocationBadge';
import type { Violation, U3ElementSubItem } from '@/types/project';
import {
  RuleIdBadge, RuleHeader, ElementCountBadge, CardDescription,
  ComponentTitle, ElementItemWrapper, DetailContainer,
  FieldRow, FieldLabel, FieldValue, ConfidenceValue, AdvisoryBlock,
} from './CardTypography';

function U3ScreenshotElementItem({ element, compact = false }: {
  element: U3ElementSubItem;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayLabel = element.elementLabel || element.columnLabel
    ? `Text content region (${element.columnLabel || element.elementLabel})`
    : 'Text content region';

  const recoveryStr = (element as any).recoveryObserved
    || (element.recoverySignals && element.recoverySignals.length > 0
      ? element.recoverySignals.join(', ')
      : 'None observed');

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <ElementItemWrapper isConfirmed={false} compact={compact}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-2 cursor-pointer">
            <ComponentTitle>{displayLabel}</ComponentTitle>
            <div className="flex items-center gap-2 flex-shrink-0">
              <LocationBadge filePath={element.location} displayName={element.location} compact={compact} />
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
            {element.detection && (
              <FieldRow>
                <FieldLabel>Detection:</FieldLabel>
                <FieldValue>{element.detection}</FieldValue>
              </FieldRow>
            )}

            {element.evidence && (
              <FieldRow>
                <FieldLabel>Evidence:</FieldLabel>
                <FieldValue>{element.evidence}</FieldValue>
              </FieldRow>
            )}

            <FieldRow>
              <FieldLabel>Recovery mechanism observed:</FieldLabel>
              <FieldValue>{recoveryStr}</FieldValue>
            </FieldRow>

            <FieldRow>
              <FieldLabel>Location:</FieldLabel>
              <FieldValue>{element.location}</FieldValue>
            </FieldRow>

            {element.confidence != null && (
              <FieldRow>
                <FieldLabel>Confidence:</FieldLabel>
                <ConfidenceValue value={element.confidence} />
              </FieldRow>
            )}
          </DetailContainer>
        </CollapsibleContent>
      </ElementItemWrapper>
    </Collapsible>
  );
}

function U3CodeElementItem({ element, compact = false }: {
  element: U3ElementSubItem;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const isConfirmed = element.classification === 'confirmed';

  // Title: "Truncated "Reason" cell (truncate)" or "Truncated text (slice)"
  const truncType = element.truncationType || 'truncate';
  const displayLabel = element.columnLabel
    ? `Truncated "${element.columnLabel}" cell (${truncType})`
    : `Truncated text (${truncType})`;

  // Compact element summary
  const tagStr = element.elementTag ? `<${element.elementTag}>` : '<element>';
  const kindStr = element.contentKind === 'dynamic' ? 'dynamic'
    : element.contentKind === 'list_mapped' ? 'dynamic(list)'
    : element.contentKind === 'static_long' ? 'static(long)'
    : 'static';
  const expandStr = element.expandDetected ? 'expand: yes' : 'expand: none';
  const elementSummary = `${tagStr} • ${kindStr} • ${truncType} • ${expandStr}`;

  // Recovery line
  const hasRecovery = element.recoverySignals && element.recoverySignals.length > 0;
  const recoveryStr = hasRecovery
    ? element.recoverySignals!.join(', ')
    : 'none (no tooltip/title/expand/modal)';

  // Source line
  const sourceLine = element.startLine
    ? `${element.location}:${element.startLine}${element.endLine && element.endLine !== element.startLine ? `–${element.endLine}` : ''}`
    : element.location;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <ElementItemWrapper isConfirmed={isConfirmed} compact={compact}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between gap-2 cursor-pointer">
            <ComponentTitle>{displayLabel}</ComponentTitle>
            <div className="flex items-center gap-2 flex-shrink-0">
              <LocationBadge filePath={element.location} compact={compact} />
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
            {element.columnLabel && (
              <FieldRow>
                <FieldLabel>Column:</FieldLabel>
                <Badge variant="outline" className="text-xs font-semibold">
                  {element.columnLabel}
                </Badge>
              </FieldRow>
            )}

            <FieldRow>
              <FieldLabel>Element:</FieldLabel>
              <FieldValue mono>{elementSummary}</FieldValue>
            </FieldRow>

            {(element.contentPreview || element.textPreview) && (
              <FieldRow>
                <FieldLabel>Content:</FieldLabel>
                <span className="font-mono text-xs text-foreground/80 truncate max-w-full">
                  {element.contentPreview || element.textPreview}
                </span>
              </FieldRow>
            )}

            {element.truncationTokens && element.truncationTokens.length > 0 && (
              <FieldRow>
                <FieldLabel>Tokens:</FieldLabel>
                <FieldValue mono>{element.truncationTokens.join(', ')}</FieldValue>
              </FieldRow>
            )}

            {(element.truncationKind === 'programmatic' || element.sliceLength != null) && (
              <FieldRow>
                <FieldLabel>Truncation kind:</FieldLabel>
                <FieldValue mono>
                  {element.truncationKind === 'programmatic' ? 'Programmatic' : 'CSS'}
                  {element.sliceLength != null && ` (slice to ${element.sliceLength} chars)`}
                </FieldValue>
              </FieldRow>
            )}

            <FieldRow>
              <FieldLabel>Recovery:</FieldLabel>
              <FieldValue mono>{recoveryStr}</FieldValue>
            </FieldRow>

            <FieldRow>
              <FieldLabel>Source:</FieldLabel>
              <FieldValue mono>{sourceLine}</FieldValue>
            </FieldRow>

            {element.confidence != null && (
              <FieldRow>
                <FieldLabel>Confidence:</FieldLabel>
                <ConfidenceValue value={element.confidence} />
              </FieldRow>
            )}
          </DetailContainer>
        </CollapsibleContent>
      </ElementItemWrapper>
    </Collapsible>
  );
}

interface U3AggregatedCardProps {
  violation: Violation;
  compact?: boolean;
}

export function U3AggregatedCard({ violation, compact = false }: U3AggregatedCardProps) {
  const isScreenshot = violation.inputType === 'screenshots';

  const elements: U3ElementSubItem[] = (violation.isU3Aggregated && violation.u3Elements)
    ? violation.u3Elements
    : [{
        elementLabel: violation.evidence?.split('.')[0] || 'Content element',
        elementType: 'text',
        location: violation.evidence || 'Unknown',
        detection: violation.diagnosis || '',
        evidence: violation.evidence || '',
        subCheck: 'U3.D1' as const,
        subCheckLabel: isScreenshot ? 'Visual content truncation' : 'Line clamp / ellipsis truncation',
        confidence: violation.confidence,
        advisoryGuidance: violation.advisoryGuidance || violation.contextualHint,
        deduplicationKey: `${violation.ruleId}-fallback`,
      }];

  const hasConfirmed = !isScreenshot && elements.some(el => el.classification === 'confirmed');
  const hasPotentialOnly = elements.some(el => el.classification !== 'confirmed');
  const cardBorderClass = hasConfirmed ? 'border border-destructive/40' : 'border border-warning/30';

  // Advisory only for potential-only cards; confirmed cards get corrective prompts instead
  const showAdvisory = !hasConfirmed && hasPotentialOnly && (violation.advisoryGuidance || violation.contextualHint);

  const subtitle = isScreenshot
    ? 'Visual inspection suggests content may be clipped; verify in context.'
    : hasConfirmed
      ? 'CSS truncation detected without accessible recovery mechanism.'
      : 'Static analysis flagged potential content truncation; verify in context.';

  return (
    <Card className={cardBorderClass}>
      <CardHeader className={compact ? 'pb-2' : 'pb-3'}>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <RuleIdBadge ruleId="U3" isConfirmed={hasConfirmed} categoryClass="category-usability" />
          <RuleHeader ruleId="U3" title="Truncated or Inaccessible Content" />
          <ElementCountBadge count={elements.length} isConfirmed={hasConfirmed} />
        </CardTitle>
        <CardDescription compact={compact}>
          {subtitle}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {elements.map((el, idx) =>
          isScreenshot ? (
            <U3ScreenshotElementItem
              key={el.deduplicationKey || idx}
              element={el}
              compact={compact}
            />
          ) : (
            <U3CodeElementItem
              key={el.deduplicationKey || idx}
              element={el}
              compact={compact}
            />
          )
        )}

        {showAdvisory && (
          <AdvisoryBlock compact={compact}>{violation.advisoryGuidance || violation.contextualHint}</AdvisoryBlock>
        )}
      </CardContent>
    </Card>
  );
}
