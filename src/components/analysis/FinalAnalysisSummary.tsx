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

  // Category-level stats
  const categoryStats = ['accessibility', 'usability', 'ethics'].map(category => {
    const initial = firstIteration?.analysis?.violationsByCategory[category] ?? 0;
    const final = lastIteration?.analysis?.violationsByCategory[category] ?? 0;
    const improvement = initial > 0 
      ? Math.round(((initial - final) / initial) * 100) 
      : (final === 0 ? 100 : 0);
    return { category, initial, final, improvement };
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
      status: hasViolation ? (violationCount <= 1 ? 'warning' : 'remaining') : 'passed',
      count: violationCount,
    };
  });

  const passedRules = ruleStatuses.filter(r => r.status === 'passed');
  const warningRules = ruleStatuses.filter(r => r.status === 'warning');
  const remainingRules = ruleStatuses.filter(r => r.status === 'remaining');

  const categoryLabels: Record<string, string> = {
    accessibility: 'Accessibility',
    usability: 'Usability',
    ethics: 'Ethical UI',
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
                Converged – Acceptance Threshold Reached
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground print:hidden">
            <FileText className="h-4 w-4" />
            <span>Research Artifact</span>
          </div>
        </div>
      </div>

      {/* ============================================= */}
      {/* SECTION 2: Overall Improvement Summary */}
      {/* ============================================= */}
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {iterations.map((iter, idx) => {
                  const analysis = iter.analysis!;
                  const isLast = idx === iterations.length - 1;
                  
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
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground mt-3 italic">
            This table supports reproducibility and cross-project comparison.
          </p>
        </CardContent>
      </Card>

      {/* ============================================= */}
      {/* SECTION 4: Category-Level Improvement */}
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
            {categoryStats.map(({ category, initial, final, improvement }) => (
              <div 
                key={category} 
                className="p-4 rounded-lg border bg-muted/30 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className={cn('category-badge', categoryColors[category])}>
                    {categoryLabels[category]}
                  </span>
                  {improvement > 0 && (
                    <span className="text-sm font-medium text-success">
                      +{improvement}%
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-foreground">{final}</span>
                  <span className="text-sm text-muted-foreground">
                    issues remaining
                  </span>
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
                The iterative refinement process terminated at Iteration {totalIterations} because 
                all evaluation rules satisfied the predefined acceptance threshold of{' '}
                <span className="font-medium text-foreground">{project.threshold} violations</span>.
                The final state contains {finalIssues} remaining issue{finalIssues !== 1 ? 's' : ''}, 
                which is within the acceptable range.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ============================================= */}
      {/* SECTION 6: Final Rule Status Snapshot */}
      {/* ============================================= */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileCheck className="h-5 w-5 text-primary" />
            Final Rule Status Snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Passed Rules */}
          {passedRules.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-success/10 text-success border-success/30 gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Passed
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {passedRules.length} rule{passedRules.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {passedRules.map(rule => (
                  <span 
                    key={rule.ruleId}
                    className="px-2 py-1 rounded text-xs bg-success/10 text-success border border-success/20"
                  >
                    {rule.ruleId}: {rule.ruleName}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Warning Rules (1 issue remaining) */}
          {warningRules.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 gap-1">
                  Low-Severity Remaining
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {warningRules.length} rule{warningRules.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {warningRules.map(rule => (
                  <span 
                    key={rule.ruleId}
                    className="px-2 py-1 rounded text-xs bg-warning/10 text-warning border border-warning/20"
                  >
                    {rule.ruleId}: {rule.ruleName} ({rule.count})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Remaining Rules (2+ issues) */}
          {remainingRules.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 gap-1">
                  Issues Remaining
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {remainingRules.length} rule{remainingRules.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {remainingRules.map(rule => (
                  <span 
                    key={rule.ruleId}
                    className="px-2 py-1 rounded text-xs bg-destructive/10 text-destructive border border-destructive/20"
                  >
                    {rule.ruleId}: {rule.ruleName} ({rule.count})
                  </span>
                ))}
              </div>
            </div>
          )}

          {evaluatedRuleIds.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No rules were evaluated in this project.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Print Footer */}
      <div className="hidden print:block pt-6 border-t border-border text-xs text-muted-foreground">
        <p>Generated by UI Critic Tool • {new Date().toLocaleDateString()}</p>
      </div>
    </div>
  );
}
