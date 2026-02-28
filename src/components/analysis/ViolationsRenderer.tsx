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
import { U3AggregatedCard } from './U3AggregatedCard';
import { U4AggregatedCard } from './U4AggregatedCard';
import { U5AggregatedCard } from './U5AggregatedCard';
import { U6AggregatedCard } from './U6AggregatedCard';
import { E1AggregatedCard } from './E1AggregatedCard';
import { E2AggregatedCard } from './E2AggregatedCard';
import { E3AggregatedCard } from './E3AggregatedCard';
import { getRuleById } from '@/data/rules';
import {
  SectionHeader, RuleIdBadge, RuleHeader, CardDescription,
  DetailContainer, FieldRow, FieldLabel, FieldValue,
} from './CardTypography';

const categoryColors: Record<string, string> = {
  accessibility: 'category-accessibility',
  usability: 'category-usability',
  ethics: 'category-ethics',
};

interface ViolationsRendererProps {
  violations: Violation[];
  compact?: boolean;
}

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
          <span className={cn('category-badge flex-shrink-0 text-xs font-medium', categoryColors[violation.category])}>
            {violation.ruleId}
          </span>
          <span className="text-lg font-semibold">{violation.ruleName}</span>
          <EvaluationMethodBadge method={violation.evaluationMethod} />
        </div>
        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded flex-shrink-0">
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
  if (v.ruleId === 'U3') return true;
  if (v.ruleId === 'U4' && v.isU4Aggregated) return true;
  if (v.ruleId === 'U5' && v.isU5Aggregated) return true;
  if (v.ruleId === 'U6' && v.isU6Aggregated) return true;
  if (v.ruleId === 'E1' && v.isE1Aggregated) return true;
  if (v.ruleId === 'E2' && v.isE2Aggregated) return true;
  if (v.ruleId === 'E3' && v.isE3Aggregated) return true;
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
  if (violation.ruleId === 'U3') {
    return <U3AggregatedCard violation={violation} compact={compact} />;
  }
  if (violation.ruleId === 'U4' && violation.isU4Aggregated) {
    return <U4AggregatedCard violation={violation} compact={compact} />;
  }
  if (violation.ruleId === 'U5' && violation.isU5Aggregated) {
    return <U5AggregatedCard violation={violation} compact={compact} />;
  }
  if (violation.ruleId === 'U6' && violation.isU6Aggregated) {
    return <U6AggregatedCard violation={violation} compact={compact} />;
  }
  if (violation.ruleId === 'E1' && violation.isE1Aggregated) {
    return <E1AggregatedCard violation={violation} compact={compact} />;
  }
  if (violation.ruleId === 'E2' && violation.isE2Aggregated) {
    return <E2AggregatedCard violation={violation} compact={compact} />;
  }
  if (violation.ruleId === 'E3' && violation.isE3Aggregated) {
    return <E3AggregatedCard violation={violation} compact={compact} />;
  }
  return null;
}

export function ViolationsRenderer({ violations, compact = false }: ViolationsRendererProps) {
  const hasAggregatedA6 = violations.some(v => v.ruleId === 'A6' && v.isA6Aggregated);
  const deduped = hasAggregatedA6
    ? violations.filter(v => v.ruleId !== 'A6' || v.isA6Aggregated)
    : violations;

  const confirmedViolations = deduped.filter(v => v.status !== 'potential' && v.status !== 'informational');
  const potentialViolations = deduped.filter(v => v.status === 'potential');
  const informationalViolations = deduped.filter(v => v.status === 'informational');

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
          <SectionHeader
            icon={<AlertTriangle className="h-5 w-5 text-destructive" />}
            count={confirmedViolations.length}
          >
            Confirmed Violations (Blocking)
          </SectionHeader>

          {confirmedAggregated.map((v, idx) => (
            <AggregatedCard key={`confirmed-agg-${v.ruleId}-${idx}`} violation={v} compact={compact} />
          ))}

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
          <SectionHeader
            icon={<AlertCircle className="h-5 w-5 text-warning" />}
            count={totalPotential}
          >
            Potential Risks (Non-blocking)
          </SectionHeader>

          {potentialAggregated.map((v, idx) => (
            <AggregatedCard key={`potential-agg-${v.ruleId}-${idx}`} violation={v} compact={compact} />
          ))}

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
          <SectionHeader
            icon={<Info className="h-5 w-5 text-muted-foreground" />}
            count={informationalViolations.length}
          >
            Rules Not Evaluated (Input Limitation)
          </SectionHeader>

          {informationalViolations.map((v, idx) => {
            const rule = getRuleById(v.ruleId);
            return (
              <Card key={`not-eval-${v.ruleId}-${idx}`} className="border-muted-foreground/20 bg-muted/5">
                <CardContent className={cn('space-y-3', compact ? 'pt-3 pb-3' : 'pt-4 pb-4')}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="category-badge flex-shrink-0 text-xs font-medium category-accessibility">
                      {v.ruleId}
                    </span>
                    <span className="text-lg font-semibold">{v.ruleName || rule?.name || v.ruleId}</span>
                  </div>

                  <div className="h-1" />

                  <FieldRow>
                    <FieldLabel>Status:</FieldLabel>
                    <FieldValue>Not evaluated</FieldValue>
                  </FieldRow>

                  <FieldRow>
                    <FieldLabel>Input type:</FieldLabel>
                    <FieldValue>{v.inputType === 'screenshots' ? 'Screenshot' : v.inputType || 'Unknown'}</FieldValue>
                  </FieldRow>

                  <div className="text-sm">
                    <span className="font-medium text-muted-foreground">Reason:</span>
                    <p className="text-sm text-foreground leading-relaxed mt-1">{v.diagnosis}</p>
                  </div>

                  {v.contextualHint && (
                    <div className="bg-muted/30 rounded-md p-3 border border-muted-foreground/10 text-sm">
                      <span className="font-medium text-muted-foreground">Advisory:</span>
                      <p className="text-sm text-foreground leading-relaxed mt-1">{v.contextualHint}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

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
