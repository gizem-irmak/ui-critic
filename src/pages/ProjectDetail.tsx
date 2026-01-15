import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Play, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToolBadge } from '@/components/ui/tool-badge';
import { InputSelector } from '@/components/analysis/InputSelector';
import { RuleSelector } from '@/components/analysis/RuleSelector';
import { AnalysisResults } from '@/components/analysis/AnalysisResults';
import { useProjectStore } from '@/stores/projectStore';
import { rules } from '@/data/rules';
import { runUIAnalysis, fileToBase64 } from '@/lib/api/analysis';
import type { InputType, ScreenshotInput, ZipInput, GithubInput, Analysis } from '@/types/project';
import { useToast } from '@/hooks/use-toast';

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const { getProject, createIteration, updateIteration, setAnalysis } = useProjectStore();
  const project = getProject(projectId || '');
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentView, setCurrentView] = useState<'setup' | 'results'>('setup');
  
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

  const latestIteration = project.iterations[project.iterations.length - 1];
  const isConverged = latestIteration?.analysis?.isAcceptable;

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
      // Convert images to base64 for analysis
      let images: string[] = [];
      
      if (inputType === 'screenshots') {
        const screenshotInput = inputData as ScreenshotInput;
        images = await Promise.all(
          screenshotInput.files.map(file => fileToBase64(file))
        );
      } else {
        // For ZIP and GitHub, we'll need a different approach (future enhancement)
        toast({
          title: 'Input Type Not Supported',
          description: 'Currently only screenshot analysis is supported. ZIP and GitHub analysis coming soon.',
          variant: 'destructive',
        });
        setIsAnalyzing(false);
        return;
      }

      // Call the AI analysis backend
      const result = await runUIAnalysis({
        images,
        categories: selectedCategories,
        selectedRules,
        inputType,
        toolUsed: project.toolUsed,
      });

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
      setCurrentView('results');

      toast({
        title: 'Analysis Complete',
        description: `Found ${violations.length} violation${violations.length !== 1 ? 's' : ''}`,
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
    setCurrentView('setup');
    setInputType('screenshots');
    setInputData({ type: 'screenshots', files: [], previews: [] });
  };

  const updatedProject = getProject(project.id);
  const currentIteration = updatedProject?.iterations[updatedProject.iterations.length - 1];

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
      </div>

      {/* Content */}
      {currentView === 'results' && currentIteration?.analysis ? (
        <AnalysisResults
          analysis={currentIteration.analysis}
          project={updatedProject!}
          iterationNumber={currentIteration.iterationNumber}
          onStartNextIteration={startNextIteration}
        />
      ) : (
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
      )}

      {/* Iteration History */}
      {project.iterations.length > 0 && currentView === 'setup' && (
        <Card>
          <CardHeader>
            <CardTitle>Previous Iterations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[...project.iterations].reverse().map((iter) => (
                <div
                  key={iter.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-medium">
                      #{iter.iterationNumber}
                    </span>
                    <span className="text-sm text-muted-foreground capitalize">
                      {iter.inputType}
                    </span>
                  </div>
                  {iter.analysis && (
                    <div className="flex items-center gap-3">
                      <span className="text-sm">
                        {iter.analysis.totalViolations} violation{iter.analysis.totalViolations !== 1 ? 's' : ''}
                      </span>
                      <span className={`status-badge ${
                        iter.analysis.isAcceptable ? 'status-acceptable' : 'status-not-acceptable'
                      }`}>
                        {iter.analysis.isAcceptable ? 'Acceptable' : 'Not Acceptable'}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
