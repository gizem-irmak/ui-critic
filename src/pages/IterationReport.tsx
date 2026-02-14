import { useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ArrowLeft, CheckCircle, XCircle, TrendingDown, 
  FileText, Printer 
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ToolBadge } from '@/components/ui/tool-badge';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/stores/projectStore';
import type { Iteration, Project } from '@/types/project';
import { ViolationsRenderer } from '@/components/analysis/ViolationsRenderer';
import { CorrectivePromptsSection } from '@/components/analysis/CorrectivePromptsSection';
const categoryColors: Record<string, string> = {
  accessibility: 'category-accessibility',
  usability: 'category-usability',
  ethics: 'category-ethics',
};

const categoryLabels: Record<string, string> = {
  accessibility: 'Accessibility',
  usability: 'Usability',
  ethics: 'Ethics',
};

const inputTypeLabels: Record<string, string> = {
  screenshots: 'Screenshots',
  zip: 'ZIP Archive',
  github: 'GitHub Repository',
};

export default function IterationReport() {
  const { projectId, iterationId } = useParams<{ projectId: string; iterationId: string }>();
  const navigate = useNavigate();
  const { getProject } = useProjectStore();
  
  

  const project = getProject(projectId || '');
  const iteration = project?.iterations.find(i => i.id === iterationId);
  const previousIteration = iteration 
    ? project?.iterations.find((_, idx, arr) => arr[idx + 1]?.id === iterationId) 
    : null;

  useEffect(() => {
    if (!project || !iteration) {
      navigate(`/projects/${projectId}`);
    }
  }, [project, iteration, projectId, navigate]);

  if (!project || !iteration?.analysis) {
    return null;
  }

  const analysis = iteration.analysis;
  const prevAnalysis = previousIteration?.analysis;

  // Calculate comparison metrics
  const violationDiff = prevAnalysis 
    ? prevAnalysis.totalViolations - analysis.totalViolations 
    : null;
  const violationsFixed = violationDiff !== null && violationDiff > 0 ? violationDiff : 0;
  const violationsAdded = violationDiff !== null && violationDiff < 0 ? Math.abs(violationDiff) : 0;





  const isConverged = project.iterations[project.iterations.length - 1]?.analysis?.isAcceptable;
  const isFinalIteration = iteration.id === project.iterations[project.iterations.length - 1]?.id && analysis.isAcceptable;

  return (
    <div className="page-container space-y-6 print:space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4 print:hidden">
        <Link to={`/projects/${projectId}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
            <ToolBadge tool={project.toolUsed} />
            {isConverged && (
              <span className="status-badge status-acceptable">Converged</span>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
            <span>Threshold: {project.threshold} violations</span>
            <span>•</span>
            <span>{project.iterations.length} iteration{project.iterations.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <Button 
          variant="outline" 
          onClick={() => window.print()}
          className="gap-2"
        >
          <Printer className="h-4 w-4" />
          Print / Export PDF
        </Button>
      </div>

      {/* Report Header */}
      <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-border">
        <FileText className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-xl font-semibold">
          Iteration #{iteration.iterationNumber} Report
        </h2>
        <Badge variant="outline" className="font-normal">
          {inputTypeLabels[iteration.inputType]}
        </Badge>
        <Badge 
          variant={analysis.isAcceptable ? 'default' : 'destructive'}
          className={cn(
            analysis.isAcceptable 
              ? 'bg-success/10 text-success border-success/30 hover:bg-success/20' 
              : 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20'
          )}
        >
          {analysis.isAcceptable ? 'Acceptable' : 'Not Acceptable'}
        </Badge>
        {isFinalIteration && (
          <Badge className="bg-primary/10 text-primary border-primary/30">
            Final Iteration
          </Badge>
        )}
        <span className="text-sm text-muted-foreground ml-auto">
          Analyzed on {new Date(analysis.analyzedAt).toLocaleDateString()} at {new Date(analysis.analyzedAt).toLocaleTimeString()}
        </span>
      </div>

      {/* Back Navigation */}
      <div className="flex items-center gap-2 text-sm print:hidden">
        <Link 
          to={`/projects/${projectId}`}
          state={{ tab: 'iterations' }}
          className="text-primary hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Iterations
        </Link>
      </div>

      {/* Status Banner */}
      <div className={cn(
        'flex items-center gap-4 p-6 rounded-lg border-2',
        analysis.isAcceptable
          ? 'bg-success/5 border-success/30'
          : 'bg-destructive/5 border-destructive/30'
      )}>
        {analysis.isAcceptable ? (
          <CheckCircle className="h-10 w-10 text-success flex-shrink-0" />
        ) : (
          <XCircle className="h-10 w-10 text-destructive flex-shrink-0" />
        )}
        <div className="flex-1">
          <h3 className={cn(
            'text-xl font-semibold',
            analysis.isAcceptable ? 'text-success' : 'text-destructive'
          )}>
            {analysis.isAcceptable ? 'Acceptable' : 'Not Acceptable'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {analysis.confirmedViolations} confirmed violation{analysis.confirmedViolations !== 1 ? 's' : ''} detected (threshold: {project.threshold})
            {analysis.potentialRisks > 0 && (
              <span className="text-warning"> + {analysis.potentialRisks} potential risk{analysis.potentialRisks !== 1 ? 's' : ''}</span>
            )}
          </p>
        </div>
      </div>

      {/* Comparison with Previous Iteration */}
      {prevAnalysis && (
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              Comparison with Iteration #{iteration.iterationNumber - 1}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold text-muted-foreground">
                  {prevAnalysis.totalViolations}
                </div>
                <div className="text-xs text-muted-foreground">Previous Violations</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className={cn(
                  'text-2xl font-bold',
                  violationsFixed > 0 ? 'text-success' : violationsAdded > 0 ? 'text-destructive' : 'text-muted-foreground'
                )}>
                  {violationsFixed > 0 ? `-${violationsFixed}` : violationsAdded > 0 ? `+${violationsAdded}` : '0'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {violationsFixed > 0 ? 'Fixed' : violationsAdded > 0 ? 'New Issues' : 'No Change'}
                </div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold">{analysis.totalViolations}</div>
                <div className="text-xs text-muted-foreground">Remaining</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
              Selected Rules
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{iteration.selectedRules.length}</div>
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
      <div className="flex justify-center gap-4 pt-4 print:hidden">
        <Link to={`/projects/${projectId}`} state={{ tab: 'iterations' }}>
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Iterations
          </Button>
        </Link>
        {isFinalIteration && isConverged && (
          <Link to={`/projects/${projectId}`}>
            <Button className="gap-2">
              <FileText className="h-4 w-4" />
              View Final Report
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
