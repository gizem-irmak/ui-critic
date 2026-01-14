import { Link } from 'react-router-dom';
import { Calendar, Layers, Target, ChevronRight, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ToolBadge } from '@/components/ui/tool-badge';
import type { Project } from '@/types/project';
import { format } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface ProjectCardProps {
  project: Project;
  onDelete: (id: string) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const latestIteration = project.iterations[project.iterations.length - 1];
  const isConverged = latestIteration?.analysis?.isAcceptable ?? false;

  return (
    <Card className="group relative hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
              {project.name}
            </h3>
            <ToolBadge tool={project.toolUsed} />
          </div>
          <div className="flex items-center gap-1">
            {isConverged && (
              <span className="status-badge status-acceptable">
                Converged
              </span>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Project</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{project.name}"? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDelete(project.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Layers className="h-4 w-4" />
            <span>{project.iterations.length} iteration{project.iterations.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Target className="h-4 w-4" />
            <span>Threshold: {project.threshold}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground col-span-2">
            <Calendar className="h-4 w-4" />
            <span>{format(new Date(project.createdAt), 'MMM d, yyyy')}</span>
          </div>
        </div>

        <Link to={`/projects/${project.id}`}>
          <Button variant="outline" className="w-full group/btn">
            View Project
            <ChevronRight className="ml-2 h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
