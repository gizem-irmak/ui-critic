import { useState } from 'react';
import { CheckCircle, XCircle, Copy, Check, TrendingDown, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { Analysis, Project } from '@/types/project';

interface AnalysisResultsProps {
  analysis: Analysis;
  project: Project;
  iterationNumber: number;
  onStartNextIteration: () => void;
}

export function AnalysisResults({
  analysis,
  project,
  iterationNumber,
  onStartNextIteration,
}: AnalysisResultsProps) {
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(analysis.correctivePrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Calculate improvement from previous iteration
  const previousIteration = project.iterations[iterationNumber - 2];
  const previousViolations = previousIteration?.analysis?.totalViolations ?? null;
  const improvement = previousViolations !== null 
    ? previousViolations - analysis.totalViolations 
    : null;

  const categoryColors: Record<string, string> = {
    accessibility: 'category-accessibility',
    usability: 'category-usability',
    ethics: 'category-ethics',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Status Banner */}
      <div className={cn(
        'flex items-center gap-4 p-6 rounded-lg border-2',
        analysis.isAcceptable
          ? 'bg-success/5 border-success/30'
          : 'bg-destructive/5 border-destructive/30'
      )}>
        {analysis.isAcceptable ? (
          <CheckCircle className="h-10 w-10 text-success" />
        ) : (
          <XCircle className="h-10 w-10 text-destructive" />
        )}
        <div>
          <h2 className={cn(
            'text-xl font-semibold',
            analysis.isAcceptable ? 'text-success' : 'text-destructive'
          )}>
            {analysis.isAcceptable ? 'Acceptable' : 'Not Acceptable'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {analysis.totalViolations} violation{analysis.totalViolations !== 1 ? 's' : ''} detected
            {' '}(threshold: {project.threshold})
          </p>
        </div>
        {analysis.isAcceptable && (
          <div className="ml-auto px-4 py-2 bg-success/10 rounded-lg">
            <span className="text-sm font-medium text-success">
              Converged at iteration {iterationNumber}
            </span>
          </div>
        )}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Violations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{analysis.totalViolations}</div>
            {improvement !== null && improvement > 0 && (
              <div className="flex items-center gap-1 text-sm text-success mt-1">
                <TrendingDown className="h-4 w-4" />
                <span>-{improvement} from previous</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Threshold
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{project.threshold}</div>
            <Progress
              value={Math.min(100, (analysis.totalViolations / Math.max(project.threshold, 1)) * 100)}
              className="mt-2 h-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Iteration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">#{iterationNumber}</div>
            <p className="text-sm text-muted-foreground mt-1">
              {project.iterations.length} total
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Violations by Category */}
      <Card>
        <CardHeader>
          <CardTitle>Violations by Category</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Object.entries(analysis.violationsByCategory).map(([category, count]) => (
              <div key={category} className="flex items-center gap-4">
                <span className={cn('category-badge w-28 justify-center', categoryColors[category])}>
                  {category}
                </span>
                <div className="flex-1">
                  <Progress
                    value={(count / Math.max(analysis.totalViolations, 1)) * 100}
                    className="h-2"
                  />
                </div>
                <span className="w-12 text-right font-mono text-sm">{count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Violation Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Detected Violations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {analysis.violations.map((violation, idx) => (
              <div
                key={idx}
                className="p-4 rounded-lg bg-muted/50 border border-border space-y-2"
              >
                {/* Header: Rule ID, Name, Confidence */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      'category-badge flex-shrink-0',
                      categoryColors[violation.category]
                    )}>
                      {violation.ruleId}
                    </span>
                    <span className="font-medium">{violation.ruleName}</span>
                  </div>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    {Math.round(violation.confidence * 100)}%
                  </span>
                </div>

                {/* Diagnosis only */}
                <p className="text-sm text-foreground leading-relaxed pl-1">
                  {violation.diagnosis}
                </p>
              </div>
            ))}
            {analysis.violations.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No violations detected
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Corrective Prompt Section - includes all corrective prompts and hints */}
      {analysis.violations.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Corrective Prompts</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={copyPrompt}
              className="gap-2"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy All
                </>
              )}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {analysis.violations.map((violation, idx) => (
              <div key={idx} className="space-y-2 pb-4 border-b border-border last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'category-badge flex-shrink-0 text-xs',
                    categoryColors[violation.category]
                  )}>
                    {violation.ruleId}
                  </span>
                  <span className="text-sm font-medium">{violation.ruleName}</span>
                </div>
                <p className="text-sm bg-primary/5 p-3 rounded border-l-2 border-primary">
                  {violation.correctivePrompt}
                </p>
                {violation.contextualHint && (
                  <p className="text-xs text-muted-foreground italic pl-1">
                    💡 {violation.contextualHint}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Next Iteration Button */}
      {!analysis.isAcceptable && (
        <div className="flex justify-center pt-4">
          <Button size="lg" onClick={onStartNextIteration} className="gap-2">
            Start Next Iteration
          </Button>
        </div>
      )}
    </div>
  );
}
