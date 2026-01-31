import { CheckCircle, Calendar, Target, Layers, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Project } from '@/types/project';

interface ConvergedSummaryCardProps {
  project: Project;
  onOpenFinalReport: () => void;
}

export function ConvergedSummaryCard({ project, onOpenFinalReport }: ConvergedSummaryCardProps) {
  // Use immutable convergence data
  const convergenceIteration = project.convergedAtIteration;
  const convergenceDate = project.convergedAt 
    ? new Date(project.convergedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Unknown';
  
  // Get the iteration where convergence was reached for final issue count
  const convergenceIterationData = project.iterations.find(
    i => i.iterationNumber === convergenceIteration
  );
  const finalIssueCount = convergenceIterationData?.analysis?.confirmedViolations ?? 0;
  
  // Count post-convergence iterations
  const postConvergenceCount = convergenceIteration 
    ? project.iterations.filter(i => i.iterationNumber > convergenceIteration).length 
    : 0;

  return (
    <Card className="border-success/30 bg-success/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <CheckCircle className="h-5 w-5 text-success" />
          Project Converged at Iteration #{convergenceIteration}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Convergence Iterations</p>
              <p className="text-lg font-semibold">
                {convergenceIteration}
                {postConvergenceCount > 0 && (
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    (+{postConvergenceCount} post)
                  </span>
                )}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Final Issues</p>
              <p className="text-lg font-semibold">{finalIssueCount}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Threshold</p>
              <p className="text-lg font-semibold">≤ {project.threshold}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Converged On</p>
              <p className="text-sm font-medium">{convergenceDate}</p>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <Button onClick={onOpenFinalReport} className="w-full gap-2">
            <FileText className="h-4 w-4" />
            Open Final Report
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
