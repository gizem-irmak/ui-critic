import { AlertTriangle, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Analysis, Violation } from '@/types/project';
import { PotentialRisksSection } from './PotentialRiskItem';
import { A1AggregatedCard } from './A1AggregatedCard';

const categoryColors: Record<string, string> = {
  accessibility: 'category-accessibility',
  usability: 'category-usability',
  ethics: 'category-ethics',
};

interface ViolationsRendererProps {
  violations: Violation[];
  compact?: boolean;
}

/**
 * Renders a single non-aggregated violation card (for rules that don't have aggregated rendering).
 */
function GenericViolationCard({ violation, isConfirmed, compact = false }: {
  violation: Violation;
  isConfirmed: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border space-y-3',
        isConfirmed
          ? 'bg-destructive/5 border-destructive/20'
          : 'bg-warning/5 border-warning/20',
        compact ? 'p-3' : 'p-4'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('category-badge flex-shrink-0 text-xs', categoryColors[violation.category])}>
            {violation.ruleId}
          </span>
          <span className="font-bold text-base">{violation.ruleName}</span>
        </div>
        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded flex-shrink-0">
          {Math.round(violation.confidence * 100)}%
        </span>
      </div>

      <div className="h-1" />

      {violation.evidence && (
        <p className="text-sm text-muted-foreground italic pl-1">📍 {violation.evidence}</p>
      )}
      <p className="text-sm text-foreground leading-relaxed pl-1">{violation.diagnosis}</p>
    </div>
  );
}

function isAggregated(v: Violation): boolean {
  return !!(v.ruleId === 'A1' && v.isA1Aggregated);
}

function AggregatedCard({ violation, compact }: { violation: Violation; compact?: boolean }) {
  if (violation.ruleId === 'A1' && violation.isA1Aggregated) {
    return <A1AggregatedCard violation={violation} compact={compact} />;
  }
  return null;
}

/**
 * Single source of truth for rendering confirmed + potential violation sections.
 * Used by AnalysisResults, IterationReport, and IterationReportModal.
 */
export function ViolationsRenderer({ violations, compact = false }: ViolationsRendererProps) {
  // Split into confirmed vs potential
  const confirmedViolations = violations.filter(v => v.status !== 'potential' && v.status !== 'informational');
  const potentialViolations = violations.filter(v => v.status === 'potential');

  // Separate aggregated from non-aggregated
  const confirmedAggregated = confirmedViolations.filter(isAggregated);
  const confirmedOther = confirmedViolations.filter(v => !isAggregated(v));

  const potentialAggregated = potentialViolations.filter(isAggregated);
  const potentialOther = potentialViolations.filter(v => !isAggregated(v));

  const hasConfirmed = confirmedViolations.length > 0;
  const hasPotential = potentialViolations.length > 0;
  const totalPotential = potentialAggregated.length + potentialOther.length;

  return (
    <>
      {/* Confirmed Violations (Blocking) */}
      {hasConfirmed && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 pt-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <h3 className="text-xl font-bold text-foreground">Confirmed Violations (Blocking)</h3>
            <span className="text-sm text-muted-foreground">
              — {confirmedViolations.length} issue{confirmedViolations.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Aggregated rule cards (A1, A2, A3, A4) */}
          {confirmedAggregated.map((v, idx) => (
            <AggregatedCard key={`confirmed-agg-${v.ruleId}-${idx}`} violation={v} compact={compact} />
          ))}

          {/* Other confirmed issues */}
          {confirmedOther.length > 0 && (
            <Card className="border-destructive/30">
              <CardContent className="pt-4 space-y-3">
                {confirmedOther.map((violation, idx) => (
                  <GenericViolationCard
                    key={idx}
                    violation={violation}
                    isConfirmed={true}
                    compact={compact}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Potential Risks (Non-blocking) */}
      {hasPotential && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 pt-2">
            <AlertCircle className="h-5 w-5 text-warning" />
            <h3 className="text-xl font-bold text-foreground">Potential Risks (Non-blocking)</h3>
            <span className="text-sm text-muted-foreground">
              — {totalPotential} issue{totalPotential !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Aggregated potential cards */}
          {potentialAggregated.map((v, idx) => (
            <AggregatedCard key={`potential-agg-${v.ruleId}-${idx}`} violation={v} compact={compact} />
          ))}

          {/* Other potential risks */}
          {potentialOther.length > 0 && (
            <Card className="border-warning/30">
              <CardContent className="pt-4">
                <PotentialRisksSection violations={potentialOther} compact={compact} />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Empty state */}
      {violations.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground">
            No violations detected
          </CardContent>
        </Card>
      )}
    </>
  );
}
