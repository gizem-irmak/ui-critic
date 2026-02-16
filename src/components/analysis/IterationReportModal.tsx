import { 
  CheckCircle, XCircle, TrendingDown, 
  FileText
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { Iteration, Project } from '@/types/project';
import { ViolationsRenderer } from './ViolationsRenderer';
import { CorrectivePromptsSection } from './CorrectivePromptsSection';

interface IterationReportModalProps {
  iteration: Iteration | null;
  project: Project;
  previousIteration: Iteration | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IterationReportModal({
  iteration,
  project,
  previousIteration,
  open,
  onOpenChange,
}: IterationReportModalProps) {
  

  if (!iteration?.analysis) return null;

  const analysis = iteration.analysis;
  const prevAnalysis = previousIteration?.analysis;

  // Calculate comparison metrics
  const violationDiff = prevAnalysis 
    ? prevAnalysis.totalViolations - analysis.totalViolations 
    : null;
  const violationsFixed = violationDiff !== null && violationDiff > 0 ? violationDiff : 0;
  const violationsAdded = violationDiff !== null && violationDiff < 0 ? Math.abs(violationDiff) : 0;

  const categoryColors: Record<string, string> = {
    accessibility: 'category-accessibility',
    usability: 'category-usability',
    ethics: 'category-ethics',
  };


  const inputTypeLabels: Record<string, string> = {
    screenshots: 'Screenshots',
    zip: 'ZIP Archive',
    github: 'GitHub Repository',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <DialogTitle className="text-lg">
                Iteration #{iteration.iterationNumber} Report
              </DialogTitle>
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
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only report • Analyzed on {new Date(analysis.analyzedAt).toLocaleDateString()}
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-120px)]">
          <div className="p-6 space-y-6">
            {/* Status Banner */}
            <div className={cn(
              'flex items-center gap-4 p-4 rounded-lg border',
              analysis.isAcceptable
                ? 'bg-success/5 border-success/30'
                : 'bg-destructive/5 border-destructive/30'
            )}>
              {analysis.isAcceptable ? (
                <CheckCircle className="h-8 w-8 text-success flex-shrink-0" />
              ) : (
                <XCircle className="h-8 w-8 text-destructive flex-shrink-0" />
              )}
              <div className="flex-1">
                <h3 className={cn(
                  'font-semibold',
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
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Confirmed Issues
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">{analysis.confirmedViolations}</div>
                  <p className="text-xs text-muted-foreground">Affects convergence</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Potential Risks
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-warning">{analysis.potentialRisks}</div>
                  <p className="text-xs text-muted-foreground">Non-blocking</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Threshold
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{project.threshold}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Selected Rules
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{iteration.selectedRules.length}</div>
                </CardContent>
              </Card>
            </div>


            {/* Violations by Category */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Violations by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(analysis.violationsByCategory).map(([category, count]) => (
                    <div key={category} className="flex items-center gap-3">
                      <span className={cn('category-badge w-24 justify-center text-xs', categoryColors[category])}>
                        {category}
                      </span>
                      <div className="flex-1">
                        <Progress
                          value={(count / Math.max(analysis.totalViolations, 1)) * 100}
                          className="h-2"
                        />
                      </div>
                      <span className="w-8 text-right font-mono text-sm">{count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Violations — single source of truth renderer */}
            <ViolationsRenderer violations={analysis.violations} compact />

            {/* Corrective Prompts — shared component (single source of truth) */}
            <CorrectivePromptsSection violations={analysis.violations} />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
