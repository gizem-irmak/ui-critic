import { useState } from 'react';
import { BarChart3, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ToolBadge } from '@/components/ui/tool-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/stores/projectStore';
import type { Project } from '@/types/project';

interface CrossProjectComparisonProps {
  currentProjectId: string;
}

export function CrossProjectComparison({ currentProjectId }: CrossProjectComparisonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { projects } = useProjectStore();
  
  // Filter to projects with at least one analyzed iteration
  const analyzedProjects = projects.filter(p => 
    p.iterations.some(i => i.analysis !== null)
  );
  
  const getProjectStats = (project: Project) => {
    const analyzedIterations = project.iterations.filter(i => i.analysis !== null);
    const lastIteration = analyzedIterations[analyzedIterations.length - 1];
    const isConverged = lastIteration?.analysis?.isAcceptable ?? false;
    const finalIssues = lastIteration?.analysis?.totalViolations ?? 0;
    
    return {
      iterationsRequired: analyzedIterations.length,
      finalIssues,
      isConverged,
    };
  };

  return (
    <>
      <Button 
        variant="outline" 
        size="sm" 
        onClick={() => setIsOpen(true)}
        className="gap-2 print:hidden"
      >
        <BarChart3 className="h-4 w-4" />
        Compare with other projects
      </Button>
      
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Cross-Project Comparison
            </DialogTitle>
          </DialogHeader>
          
          {analyzedProjects.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No analyzed projects available for comparison.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Read-only comparison of all evaluated projects. This view supports exploratory analysis only.
              </p>
              
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Project</TableHead>
                      <TableHead>Source Tool</TableHead>
                      <TableHead className="text-right">Iterations</TableHead>
                      <TableHead className="text-right">Final Issues</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analyzedProjects.map((project) => {
                      const stats = getProjectStats(project);
                      const isCurrent = project.id === currentProjectId;
                      
                      return (
                        <TableRow 
                          key={project.id}
                          className={cn(isCurrent && 'bg-primary/5')}
                        >
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {project.name}
                              {isCurrent && (
                                <Badge variant="outline" className="text-xs">
                                  Current
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <ToolBadge tool={project.toolUsed} />
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {stats.iterationsRequired}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {stats.finalIssues}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge 
                              variant="outline"
                              className={cn(
                                'text-xs',
                                stats.isConverged 
                                  ? 'bg-success/10 text-success border-success/30'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
                              {stats.isConverged ? 'Converged' : 'In Progress'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              
              <p className="text-xs text-muted-foreground italic mt-4">
                This comparison is for exploratory purposes only and does not imply statistical significance.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
