import { CheckCircle2, FileText, TrendingUp, Target, Award, FileCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ToolBadge } from '@/components/ui/tool-badge';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { Project } from '@/types/project';
import { rules } from '@/data/rules';

// New sub-components
import { BaselineAssessment } from './final-summary/BaselineAssessment';
import { IterationMetadata, getIterationMetadataSummary } from './final-summary/IterationMetadata';
import { CategoryTrendIndicator, TrendSparkline } from './final-summary/CategoryTrendIndicator';
import { RuleStatusByCategory } from './final-summary/RuleStatusByCategory';
import { CrossProjectComparison } from './final-summary/CrossProjectComparison';
import { MethodologyStatement } from './final-summary/MethodologyStatement';

interface FinalAnalysisSummaryProps {
  project: Project;
}

export function FinalAnalysisSummary({ project }: FinalAnalysisSummaryProps) {
  const iterations = project.iterations.filter(i => i.analysis !== null);
  const totalIterations = iterations.length;
  
  const firstIteration = iterations[0];
  const lastIteration = iterations[iterations.length - 1];
  
  const initialIssues = firstIteration?.analysis?.totalViolations ?? 0;
  const finalIssues = lastIteration?.analysis?.totalViolations ?? 0;
  const overallImprovement = initialIssues > 0 
    ? Math.round(((initialIssues - finalIssues) / initialIssues) * 100) 
    : 0;

  // Detect baseline-compliant UI (converged at iteration 1)
  const isBaselineCompliant = totalIterations === 1 && firstIteration?.analysis?.isAcceptable === true;

  // Category-level stats with trend data
  const categoryStats = ['accessibility', 'usability', 'ethics'].map(category => {
    const initial = firstIteration?.analysis?.violationsByCategory[category] ?? 0;
    const final = lastIteration?.analysis?.violationsByCategory[category] ?? 0;
    const improvement = initial > 0 
      ? Math.round(((initial - final) / initial) * 100) 
      : (final === 0 ? 100 : 0);
    
    // Build trend data across all iterations
    const trendData = iterations.map(iter => ({
      violationCount: iter.analysis?.violationsByCategory[category] ?? 0,
    }));
    
    const sparklineData = iterations.map(iter => 
      iter.analysis?.violationsByCategory[category] ?? 0
    );
    
    return { category, initial, final, improvement, trendData, sparklineData };
  });

  // Collect all selected rules from the last iteration
  const evaluatedRuleIds = lastIteration?.selectedRules ?? [];
  const finalViolationRuleIds = new Set(
    lastIteration?.analysis?.violations.map(v => v.ruleId) ?? []
  );

  // Determine rule status
  const ruleStatuses = evaluatedRuleIds.map(ruleId => {
    const rule = rules.find(r => r.id === ruleId);
    const hasViolation = finalViolationRuleIds.has(ruleId);
    const violationCount = lastIteration?.analysis?.violations.filter(v => v.ruleId === ruleId).length ?? 0;
    
    return {
      ruleId,
      ruleName: rule?.name ?? ruleId,
      category: rule?.category ?? 'unknown',
      status: hasViolation ? (violationCount <= 1 ? 'warning' : 'remaining') : 'passed' as 'passed' | 'warning' | 'remaining',
      count: violationCount,
    };
  });

  const categoryLabels: Record<string, string> = {
    accessibility: 'Accessibility',
    usability: 'Usability',
    ethics: 'Ethics',
  };

  const categoryColors: Record<string, string> = {
    accessibility: 'category-accessibility',
    usability: 'category-usability',
    ethics: 'category-ethics',
  };

  return (
    <div className="space-y-8 animate-fade-in print:space-y-6">
      {/* ============================================= */}
      {/* SECTION 1: Header - Final Analysis Summary */}
      {/* ============================================= */}
      <div className="border-b border-border pb-6 print:pb-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground print:text-xl">
                Final Analysis Summary
              </h1>
              <Badge 
                variant="outline" 
                className="gap-1.5 bg-success/10 text-success border-success/30 font-medium"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {isBaselineCompliant 
                  ? 'Baseline-Compliant – No Refinement Needed'
                  : 'Converged – Acceptance Threshold Reached'
                }
              </Badge>
            </div>
            <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{project.name}</span>
              <span className="text-muted-foreground/50">•</span>
              <ToolBadge tool={project.toolUsed} />
              <span className="text-muted-foreground/50">•</span>
              <span>{totalIterations} iteration{totalIterations !== 1 ? 's' : ''} executed</span>
            </div>
          </div>
          <div className="flex items-center gap-3 print:hidden">
            <CrossProjectComparison currentProjectId={project.id} />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>Research Artifact</span>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================= */}
      {/* SECTION 1.5: Baseline Assessment (if applicable) */}
      {/* ============================================= */}
      <BaselineAssessment 
        isBaselineCompliant={isBaselineCompliant}
        iterationsRequired={totalIterations}
        finalIssues={finalIssues}
      />

      {/* ============================================= */}
      {/* SECTION 2: Overall Improvement Summary */}
      {/* ============================================= */}
      {!isBaselineCompliant && (
        <Card className="border-2 border-success/20 bg-success/5 print:border print:bg-transparent">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="h-5 w-5 text-success" />
              Overall Improvement Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg text-foreground">
              Total issues reduced from{' '}
              <span className="font-bold text-destructive">{initialIssues}</span>
              {' → '}
              <span className="font-bold text-success">{finalIssues}</span>
              {' '}
              {overallImprovement > 0 && (
                <span className="text-success font-medium">
                  ({overallImprovement}% improvement)
                </span>
              )}
              {overallImprovement === 0 && initialIssues === finalIssues && finalIssues > 0 && (
                <span className="text-muted-foreground">(no change)</span>
              )}
              {initialIssues === 0 && finalIssues === 0 && (
                <span className="text-success font-medium">(no issues detected)</span>
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ============================================= */}
      {/* SECTION 3: Iteration Progress Overview */}
      {/* ============================================= */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5 text-primary" />
            Iteration Progress Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-24">Iteration</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Accessibility</TableHead>
                  <TableHead className="text-right">Usability</TableHead>
                  <TableHead className="text-right">Ethical UI</TableHead>
                  <TableHead className="w-32">Metadata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {iterations.map((iter, idx) => {
                  const analysis = iter.analysis!;
                  const isLast = idx === iterations.length - 1;
                  const metadata = getIterationMetadataSummary(iter);
                  
                  return (
                    <TableRow 
                      key={iter.id} 
                      className={cn(isLast && 'bg-success/5 font-medium')}
                    >
                      <TableCell className="font-mono">
                        #{iter.iterationNumber}
                        {isLast && (
                          <Badge variant="outline" className="ml-2 text-xs bg-success/10 text-success border-success/30">
                            Final
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {analysis.totalViolations}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {analysis.violationsByCategory['accessibility'] ?? 0}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {analysis.violationsByCategory['usability'] ?? 0}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {analysis.violationsByCategory['ethics'] ?? 0}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0">
                            {metadata.inputType}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0">
                            {metadata.rulePreset}
                          </Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground mt-3 italic">
            This table supports reproducibility and cross-project comparison. Metadata columns show input type and rule preset for each iteration.
          </p>
        </CardContent>
      </Card>

      {/* ============================================= */}
      {/* SECTION 4: Category-Level Improvement with Trends */}
      {/* ============================================= */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Award className="h-5 w-5 text-primary" />
            Category-Level Improvement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {categoryStats.map(({ category, initial, final, improvement, trendData, sparklineData }) => (
              <div 
                key={category} 
                className="p-4 rounded-lg border bg-muted/30 space-y-3"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className={cn('category-badge', categoryColors[category])}>
                    {categoryLabels[category]}
                  </span>
                  <div className="flex items-center gap-2">
                    {improvement > 0 && (
                      <span className="text-sm font-medium text-success">
                        +{improvement}%
                      </span>
                    )}
                    <CategoryTrendIndicator 
                      iterations={trendData} 
                      category={category} 
                    />
                  </div>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground">{final}</span>
                  <span className="text-sm text-muted-foreground">
                    issues remaining
                  </span>
                  {totalIterations > 1 && (
                    <TrendSparkline data={sparklineData} />
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  Initial: {initial} → Final: {final}
                </div>
                <Progress 
                  value={initial > 0 ? ((initial - final) / initial) * 100 : (final === 0 ? 100 : 0)} 
                  className="h-2"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ============================================= */}
      {/* SECTION 5: Convergence Statement */}
      {/* ============================================= */}
      <Card className="bg-muted/30">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-full bg-success/10">
              <CheckCircle2 className="h-6 w-6 text-success" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-foreground">Convergence Statement</h3>
              <p className="text-muted-foreground leading-relaxed">
                {isBaselineCompliant ? (
                  <>
                    The evaluation process terminated at Iteration 1 because the initial UI 
                    already satisfied the predefined acceptance threshold of{' '}
                    <span className="font-medium text-foreground">{project.threshold} violations</span>.
                    No iterative refinement was required. The baseline state contains {finalIssues} issue{finalIssues !== 1 ? 's' : ''}.
                  </>
                ) : (
                  <>
                    The iterative refinement process terminated at Iteration {totalIterations} because 
                    all evaluation rules satisfied the predefined acceptance threshold of{' '}
                    <span className="font-medium text-foreground">{project.threshold} violations</span>.
                    The final state contains {finalIssues} remaining issue{finalIssues !== 1 ? 's' : ''}, 
                    which is within the acceptable range.
                  </>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ============================================= */}
      {/* SECTION 6: Final Rule Status Snapshot - Grouped by Category */}
      {/* ============================================= */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileCheck className="h-5 w-5 text-primary" />
            Final Rule Status Snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <RuleStatusByCategory ruleStatuses={ruleStatuses} type="passed" />
          <RuleStatusByCategory ruleStatuses={ruleStatuses} type="warning" />
          <RuleStatusByCategory ruleStatuses={ruleStatuses} type="remaining" />

          {evaluatedRuleIds.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No rules were evaluated in this project.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ============================================= */}
      {/* SECTION 7: Methodology Statement */}
      {/* ============================================= */}
      <MethodologyStatement />

      {/* Print Footer */}
      <div className="hidden print:block pt-6 border-t border-border text-xs text-muted-foreground">
        <p>Generated by UI Critic Tool • {new Date().toLocaleDateString()}</p>
        <p className="mt-1">Methodology: Fixed rule set • Static analysis only • Tool-agnostic evaluation • Acceptance-threshold convergence</p>
      </div>
    </div>
  );
}
