import { Link } from 'react-router-dom';
import { FolderOpen, TrendingUp, CheckCircle, XCircle, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/stores/projectStore';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';

export default function Dashboard() {
  const { projects } = useProjectStore();

  const stats = {
    totalProjects: projects.length,
    totalIterations: projects.reduce((acc, p) => acc + p.iterations.length, 0),
    convergedProjects: projects.filter(p => {
      const lastIter = p.iterations[p.iterations.length - 1];
      return lastIter?.analysis?.isAcceptable;
    }).length,
    activeProjects: projects.filter(p => {
      const lastIter = p.iterations[p.iterations.length - 1];
      return !lastIter?.analysis?.isAcceptable && p.iterations.length > 0;
    }).length,
  };

  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="page-container space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">
            Automated UI evaluation for iterative improvement
          </p>
        </div>
        <CreateProjectDialog />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              Total Projects
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalProjects}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Total Iterations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalIterations}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-success" />
              Converged
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-success">{stats.convergedProjects}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <XCircle className="h-4 w-4 text-warning" />
              In Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-warning">{stats.activeProjects}</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Projects */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Projects</CardTitle>
          <Link to="/projects">
            <Button variant="outline" size="sm">
              View All
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {recentProjects.length === 0 ? (
            <div className="text-center py-12">
              <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No projects yet</h3>
              <p className="text-muted-foreground mb-4">
                Create your first project to start evaluating UIs
              </p>
              <CreateProjectDialog />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentProjects.map((project) => {
                const lastIter = project.iterations[project.iterations.length - 1];
                const isConverged = lastIter?.analysis?.isAcceptable;
                
                return (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="flex items-center justify-between py-3 hover:bg-muted/50 -mx-2 px-2 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${
                        isConverged ? 'bg-success' : 
                        project.iterations.length > 0 ? 'bg-warning' : 'bg-muted-foreground'
                      }`} />
                      <div>
                        <div className="font-medium">{project.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {project.iterations.length} iteration{project.iterations.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {project.toolUsed}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
