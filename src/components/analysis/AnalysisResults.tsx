import { CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { Analysis, Project } from '@/types/project';
import { ViolationsRenderer } from './ViolationsRenderer';
import { CorrectivePromptsSection } from './CorrectivePromptsSection';
interface AnalysisResultsProps {
  analysis: Analysis;
  project: Project;
  iterationNumber: number;
  onStartNextIteration: () => void;
  onViewFinalReport?: () => void;
}

export function AnalysisResults({
  analysis,
  project,
  iterationNumber,
  onStartNextIteration,
  onViewFinalReport,
}: AnalysisResultsProps) {
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
          {analysis.confirmedViolations} confirmed violation{analysis.confirmedViolations !== 1 ? 's' : ''} detected
          {' '}(threshold: {project.threshold})
          {analysis.potentialRisks > 0 && (
            <span className="text-warning"> + {analysis.potentialRisks} potential risk{analysis.potentialRisks !== 1 ? 's' : ''}</span>
          )}
        </p>
      </div>
      {analysis.isAcceptable && (
        <div className="ml-auto px-4 py-2 bg-success/10 rounded-lg">
          <span className="text-sm font-medium text-success">
            {project.convergedAtIteration 
              ? `Converged at iteration #${project.convergedAtIteration}`
              : `Converged at iteration #${iterationNumber}`
            }
          </span>
        </div>
      )}
      </div>


      {/* Metrics Grid */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Confirmed Issues
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-destructive">{analysis.confirmedViolations}</div>
            <p className="text-xs text-muted-foreground mt-1">Affects convergence</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Potential Risks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-warning">{analysis.potentialRisks}</div>
            <p className="text-xs text-muted-foreground mt-1">Non-blocking</p>
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
              value={Math.min(100, (analysis.confirmedViolations / Math.max(project.threshold, 1)) * 100)}
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

      {/* Violations — single source of truth renderer */}
      <ViolationsRenderer violations={analysis.violations} />

      {/* Corrective Prompts — shared component */}
      <CorrectivePromptsSection violations={analysis.violations} />

      {/* Action Buttons */}
      <div className="flex justify-center gap-4 pt-4">
        {analysis.isAcceptable ? (
          <>
            <Button size="lg" onClick={onViewFinalReport} className="gap-2">
              View Final Report
            </Button>
            <Button size="lg" variant="outline" onClick={onStartNextIteration} className="gap-2">
              Re-Iterate
            </Button>
          </>
        ) : (
          <Button size="lg" onClick={onStartNextIteration} className="gap-2">
            Start Next Iteration
          </Button>
        )}
      </div>
    </div>
  );
}