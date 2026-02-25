import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Analysis, Violation } from '@/types/project';
import { PotentialRisksSection } from './PotentialRiskItem';
import { A1AggregatedCard } from './A1AggregatedCard';
import { A2AggregatedCard } from './A2AggregatedCard';
import { A3AggregatedCard } from './A3AggregatedCard';
import { A4AggregatedCard } from './A4AggregatedCard';
import { A5AggregatedCard } from './A5AggregatedCard';
import { A6AggregatedCard } from './A6AggregatedCard';
import { U1AggregatedCard } from './U1AggregatedCard';
import { U2AggregatedCard } from './U2AggregatedCard';
import { getRuleById } from '@/data/rules';

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
function EvaluationMethodBadge({ method }: { method?: Violation['evaluationMethod'] }) {
  if (!method) return null;
  const labels: Record<string, { text: string; className: string }> = {
    deterministic: { text: 'Deterministic (static analysis)', className: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
    llm_assisted: { text: 'AI-assisted (vision/LLM)', className: 'bg-violet-500/10 text-violet-600 border-violet-500/20' },
    hybrid_deterministic: { text: 'Hybrid — deterministic signal', className: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
    hybrid_llm_fallback: { text: 'Hybrid — AI fallback', className: 'bg-violet-500/10 text-violet-600 border-violet-500/20' },
  };
  const config = labels[method];
  if (!config) return null;
  return (
    <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', config.className)}>
      {config.text}
    </span>
  );
}

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
          <EvaluationMethodBadge method={violation.evaluationMethod} />
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
  if (v.ruleId === 'A3') return true;
  if (v.ruleId === 'A4') return true;
  if (v.ruleId === 'A5') return true;
  if (v.ruleId === 'A6') return true;
  if (v.ruleId === 'U1' && v.isU1Aggregated) return true;
  if (v.ruleId === 'U2') return true;
  return !!(v.ruleId === 'A1' && v.isA1Aggregated) || !!(v.ruleId === 'A2' && v.isA2Aggregated);
}

function AggregatedCard({ violation, compact }: { violation: Violation; compact?: boolean }) {
  if (violation.ruleId === 'A1' && violation.isA1Aggregated) {
    return <A1AggregatedCard violation={violation} compact={compact} />;
  }
  if (violation.ruleId === 'A2' && violation.isA2Aggregated) {
    return <A2AggregatedCard violation={violation} compact={compact} />;
  }
  if (violation.ruleId === 'A3') {
    return <A3AggregatedCard violation={violation} compact={compact} />;
  }
  if (violation.ruleId === 'A4') {
    return <A4AggregatedCard violation={violation} compact={compact} />;
  }
  if (violation.ruleId === 'A5') {
    return <A5AggregatedCard violation={violation} compact={compact} />;
  }
  if (violation.ruleId === 'A6') {
    return <A6AggregatedCard violation={violation} compact={compact} />;
  }
  if (violation.ruleId === 'U1' && violation.isU1Aggregated) {
    return <U1AggregatedCard violation={violation} compact={compact} />;
  }
  if (violation.ruleId === 'U2') {
    return <U2AggregatedCard violation={violation} compact={compact} />;
  }
  return null;
}

/**
 * Single source of truth for rendering confirmed + potential violation sections.
 * Used by AnalysisResults, IterationReport, and IterationReportModal.
 */
export function ViolationsRenderer({ violations, compact = false }: ViolationsRendererProps) {
  // Deduplicate A6: if an aggregated A6 card exists, drop non-aggregated A6 violations
  const hasAggregatedA6 = violations.some(v => v.ruleId === 'A6' && v.isA6Aggregated);
  const deduped = hasAggregatedA6
    ? violations.filter(v => v.ruleId !== 'A6' || v.isA6Aggregated)
    : violations;

  // Split into confirmed vs potential vs informational (not evaluated)
  const confirmedViolations = deduped.filter(v => v.status !== 'potential' && v.status !== 'informational');
  const potentialViolations = deduped.filter(v => v.status === 'potential');
  const informationalViolations = deduped.filter(v => v.status === 'informational');

  // Separate aggregated from non-aggregated
  const confirmedAggregated = confirmedViolations.filter(isAggregated);
  const confirmedOther = confirmedViolations.filter(v => !isAggregated(v));

  const potentialAggregated = potentialViolations.filter(isAggregated);
  const potentialOther = potentialViolations.filter(v => !isAggregated(v));

  const hasConfirmed = confirmedViolations.length > 0;
  const hasPotential = potentialViolations.length > 0;
  const hasNotEvaluated = informationalViolations.length > 0;
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

      {/* Rules Not Evaluated (Input Limitation) */}
      {hasNotEvaluated && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 pt-2">
            <Info className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-xl font-bold text-foreground">Rules Not Evaluated (Input Limitation)</h3>
            <span className="text-sm text-muted-foreground">
              — {informationalViolations.length} rule{informationalViolations.length !== 1 ? 's' : ''}
            </span>
          </div>

          {informationalViolations.map((v, idx) => {
            const rule = getRuleById(v.ruleId);
            return (
              <Card key={`not-eval-${v.ruleId}-${idx}`} className="border-muted-foreground/20 bg-muted/5">
                <CardContent className={cn('space-y-3', compact ? 'pt-3 pb-3' : 'pt-4 pb-4')}>
                  {/* Rule ID + Title */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="category-badge flex-shrink-0 text-xs category-accessibility">
                      {v.ruleId}
                    </span>
                    <span className="font-bold text-base">{v.ruleName || rule?.name || v.ruleId}</span>
                  </div>

                  <div className="h-1" />

                  {/* Status */}
                  <div className={cn('flex items-center gap-2', compact ? 'text-xs' : 'text-sm')}>
                    <span className="text-muted-foreground font-medium w-24">Status:</span>
                    <span className="text-muted-foreground">Not evaluated</span>
                  </div>

                  {/* Input type */}
                  <div className={cn('flex items-center gap-2', compact ? 'text-xs' : 'text-sm')}>
                    <span className="text-muted-foreground font-medium w-24">Input type:</span>
                    <span className="text-foreground">{v.inputType === 'screenshots' ? 'Screenshot' : v.inputType || 'Unknown'}</span>
                  </div>

                  {/* Reason */}
                  <div className={cn(compact ? 'text-xs' : 'text-sm')}>
                    <span className="text-muted-foreground font-medium">Reason:</span>
                    <p className="text-foreground leading-relaxed mt-1">{v.diagnosis}</p>
                  </div>

                  {/* Advisory */}
                  {v.contextualHint && (
                    <div className={cn('bg-muted/30 rounded-md p-3 border border-muted-foreground/10', compact ? 'text-xs' : 'text-sm')}>
                      <span className="text-muted-foreground font-medium">Advisory:</span>
                      <p className="text-foreground leading-relaxed mt-1">{v.contextualHint}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
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
