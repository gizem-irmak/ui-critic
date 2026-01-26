import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Play, Loader2, ChevronRight, CheckCircle, XCircle, FileText, Printer, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToolBadge } from '@/components/ui/tool-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { InputSelector } from '@/components/analysis/InputSelector';
import { RuleSelector } from '@/components/analysis/RuleSelector';
import { AnalysisResults } from '@/components/analysis/AnalysisResults';

import { FinalAnalysisSummary } from '@/components/analysis/FinalAnalysisSummary';
import { ConvergedSummaryCard } from '@/components/projects/ConvergedSummaryCard';
import { useProjectStore } from '@/stores/projectStore';
import { rules } from '@/data/rules';
import { runUIAnalysis, fileToBase64, fileToRawBase64 } from '@/lib/api/analysis';
import type { InputType, ScreenshotInput, ZipInput, GithubInput, Analysis, Iteration } from '@/types/project';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const { getProject, createIteration, updateIteration, setAnalysis } = useProjectStore();
  const project = getProject(projectId || '');
  
  // Determine if project is converged
  const latestIteration = project?.iterations[project.iterations.length - 1];
  const isConverged = latestIteration?.analysis?.isAcceptable ?? false;
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // Default tab based on convergence status
  const [activeTab, setActiveTab] = useState<string>(isConverged ? 'final-report' : 'new-iteration');
  const [currentView, setCurrentView] = useState<'setup' | 'results' | 'final'>(isConverged ? 'final' : 'setup');
  
  
  // Current iteration state
  const [inputType, setInputType] = useState<InputType>('screenshots');
  const [inputData, setInputData] = useState<ScreenshotInput | ZipInput | GithubInput>({
    type: 'screenshots',
    files: [],
    previews: [],
  });
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['accessibility', 'usability', 'ethics']);
  const [selectedRules, setSelectedRules] = useState<string[]>(rules.map(r => r.id));

  useEffect(() => {
    if (!project) {
      navigate('/projects');
    }
  }, [project, navigate]);

  if (!project) return null;

  const handleInputTypeChange = (type: InputType) => {
    setInputType(type);
    if (type === 'screenshots') {
      setInputData({ type: 'screenshots', files: [], previews: [] });
    } else if (type === 'zip') {
      setInputData({ type: 'zip', file: null as any, fileName: '' });
    } else {
      setInputData({ type: 'github', url: '' });
    }
  };

  const canRunAnalysis = () => {
    if (selectedRules.length === 0) return false;
    
    switch (inputType) {
      case 'screenshots':
        return (inputData as ScreenshotInput).files.length > 0;
      case 'zip':
        return !!(inputData as ZipInput).file;
      case 'github':
        return !!(inputData as GithubInput).url.trim();
    }
  };

  const runAnalysis = async () => {
    if (!canRunAnalysis()) return;

    setIsAnalyzing(true);

    // Create a new iteration
    const iteration = createIteration(project.id, inputType);
    updateIteration(project.id, iteration.id, {
      inputData,
      selectedCategories,
      selectedRules,
    });

    try {
      let analysisRequest: Parameters<typeof runUIAnalysis>[0];
      
      if (inputType === 'screenshots') {
        const screenshotInput = inputData as ScreenshotInput;
        const images = await Promise.all(
          screenshotInput.files.map(file => fileToBase64(file))
        );
        analysisRequest = {
          images,
          categories: selectedCategories,
          selectedRules,
          inputType,
          toolUsed: project.toolUsed,
        };
      } else if (inputType === 'zip') {
        const zipInput = inputData as ZipInput;
        const zipBase64 = await fileToRawBase64(zipInput.file);
        analysisRequest = {
          zipBase64,
          categories: selectedCategories,
          selectedRules,
          inputType,
          toolUsed: project.toolUsed,
        };
      } else {
        // GitHub analysis not yet supported
        toast({
          title: 'Input Type Not Supported',
          description: 'GitHub repository analysis coming soon.',
          variant: 'destructive',
        });
        setIsAnalyzing(false);
        return;
      }

      // Call the AI analysis backend
      const result = await runUIAnalysis(analysisRequest);

      if (!result.success) {
        throw new Error(result.error || 'Analysis failed');
      }

      const violations = result.violations || [];

      // Calculate violations by category
      const violationsByCategory: Record<string, number> = {
        accessibility: 0,
        usability: 0,
        ethics: 0,
      };
      violations.forEach(v => {
        if (violationsByCategory[v.category] !== undefined) {
          violationsByCategory[v.category]++;
        }
      });

      // Generate corrective prompt from violations
      const correctivePrompt = violations.length > 0
        ? violations
            .map(v => `• ${v.correctivePrompt}`)
            .filter((v, i, a) => a.indexOf(v) === i)
            .join('\n\n')
        : '';

      const analysis: Analysis = {
        id: Math.random().toString(36).substring(2),
        iterationId: iteration.id,
        violations,
        totalViolations: violations.length,
        violationsByCategory,
        correctivePrompt,
        isAcceptable: violations.length <= project.threshold,
        analyzedAt: new Date(),
        passNotes: result.passNotes,
      };

      setAnalysis(project.id, iteration.id, analysis);
      
      // Switch to iterations tab to show results - user must explicitly navigate to final report
      setActiveTab('iterations');
      setCurrentView('results');

      toast({
        title: analysis.isAcceptable ? 'Convergence Reached' : 'Analysis Complete',
        description: analysis.isAcceptable 
          ? `Acceptance threshold met with ${violations.length} violation${violations.length !== 1 ? 's' : ''}`
          : `Found ${violations.length} violation${violations.length !== 1 ? 's' : ''}`,
      });
    } catch (error) {
      console.error('Analysis error:', error);
      toast({
        title: 'Analysis Failed',
        description: error instanceof Error ? error.message : 'Failed to analyze UI',
        variant: 'destructive',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startNextIteration = () => {
    setActiveTab('new-iteration');
    setCurrentView('setup');
    setInputType('screenshots');
    setInputData({ type: 'screenshots', files: [], previews: [] });
  };

  const openIterationReport = (iter: Iteration) => {
    navigate(`/projects/${project.id}/iterations/${iter.id}`);
  };


  const inputTypeLabels: Record<string, string> = {
    screenshots: 'Screenshots',
    zip: 'ZIP',
    github: 'GitHub',
  };

  const updatedProject = getProject(project.id);
  const currentIteration = updatedProject?.iterations[updatedProject.iterations.length - 1];

  const handleViewFinalSummary = () => {
    setActiveTab('final-report');
    setCurrentView('final');
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === 'final-report') {
      setCurrentView('final');
    } else if (value === 'new-iteration') {
      setCurrentView('setup');
    }
  };

  return (
    <div className="page-container space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/projects">
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
        {activeTab === 'final-report' && (
          <Button 
            variant="outline" 
            onClick={() => window.print()}
            className="gap-2 print:hidden"
          >
            <Printer className="h-4 w-4" />
            Print / Export PDF
          </Button>
        )}
      </div>

      {/* Converged Banner */}
      {isConverged && (
        <Alert className="border-success/30 bg-success/5">
          <CheckCircle className="h-4 w-4 text-success" />
          <AlertDescription className="text-success-foreground">
            <strong>Converged</strong> — Acceptance threshold reached. This project is read-only.
          </AlertDescription>
        </Alert>
      )}

      {/* Tab Navigation */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger 
            value="final-report" 
            disabled={!isConverged}
            className={cn(!isConverged && "opacity-50 cursor-not-allowed")}
          >
            <FileText className="h-4 w-4 mr-2" />
            Final Report
          </TabsTrigger>
          <TabsTrigger value="iterations">
            Iterations
          </TabsTrigger>
          {!isConverged && (
            <TabsTrigger value="new-iteration">
              New Iteration
            </TabsTrigger>
          )}
        </TabsList>

        {/* Final Report Tab */}
        <TabsContent value="final-report" className="mt-6">
          {isConverged && updatedProject && (
            <FinalAnalysisSummary project={updatedProject} />
          )}
        </TabsContent>

        {/* Iterations Tab */}
        <TabsContent value="iterations" className="mt-6">
          {/* Show current iteration results if viewing results */}
          {currentView === 'results' && currentIteration?.analysis && (
            <div className="space-y-6">
              <AnalysisResults
                analysis={currentIteration.analysis}
                project={updatedProject!}
                iterationNumber={currentIteration.iterationNumber}
                onStartNextIteration={startNextIteration}
                onViewFinalReport={handleViewFinalSummary}
              />
            </div>
          )}

          {/* Converged Summary Card (when converged and not viewing results) */}
          {isConverged && currentView !== 'results' && (
            <div className="mb-6">
              <ConvergedSummaryCard 
                project={project} 
                onOpenFinalReport={handleViewFinalSummary} 
              />
            </div>
          )}

          {/* Previous Iterations List */}
          {project.iterations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {isConverged ? 'All Iterations' : 'Previous Iterations'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[...project.iterations].reverse().map((iter) => (
                    <button
                      key={iter.id}
                      onClick={() => openIterationReport(iter)}
                      className={cn(
                        'w-full flex items-center justify-between p-3 rounded-lg border transition-all',
                        'hover:bg-muted/80 hover:border-primary/30 hover:shadow-sm',
                        'focus:outline-none focus:ring-2 focus:ring-primary/20',
                        iter.analysis?.isAcceptable
                          ? 'bg-success/5 border-success/20'
                          : 'bg-muted/50 border-border'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {iter.analysis && (
                          iter.analysis.isAcceptable ? (
                            <CheckCircle className="h-4 w-4 text-success" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )
                        )}
                        <span className="font-mono text-sm font-medium">
                          #{iter.iterationNumber}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {inputTypeLabels[iter.inputType]}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {iter.analysis && (
                          <>
                            <span className="text-sm text-muted-foreground">
                              {iter.analysis.totalViolations} violation{iter.analysis.totalViolations !== 1 ? 's' : ''}
                            </span>
                            <span className={cn(
                              'status-badge',
                              iter.analysis.isAcceptable ? 'status-acceptable' : 'status-not-acceptable'
                            )}>
                              {iter.analysis.isAcceptable ? 'Acceptable' : 'Not Acceptable'}
                            </span>
                          </>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {project.iterations.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <p>No iterations yet. Start by running your first analysis.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* New Iteration Tab (only for non-converged) */}
        {!isConverged && (
          <TabsContent value="new-iteration" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Input Section */}
              <Card>
                <CardHeader>
                  <CardTitle>Iteration #{project.iterations.length + 1} - Input</CardTitle>
                </CardHeader>
                <CardContent>
                  <InputSelector
                    inputType={inputType}
                    onInputTypeChange={handleInputTypeChange}
                    inputData={inputData}
                    onInputDataChange={setInputData}
                  />
                </CardContent>
              </Card>

              {/* Rules Section */}
              <Card>
                <CardHeader>
                  <CardTitle>Rule Selection</CardTitle>
                </CardHeader>
                <CardContent>
                  <RuleSelector
                    selectedCategories={selectedCategories}
                    selectedRules={selectedRules}
                    onCategoriesChange={setSelectedCategories}
                    onRulesChange={setSelectedRules}
                  />
                </CardContent>
              </Card>

              {/* Run Analysis Button */}
              <div className="lg:col-span-2 flex justify-center">
                <Button
                  size="lg"
                  onClick={runAnalysis}
                  disabled={!canRunAnalysis() || isAnalyzing}
                  className="gap-2 min-w-48"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Play className="h-5 w-5" />
                      Run Automated Analysis
                    </>
                  )}
                </Button>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>

    </div>
  );
}
