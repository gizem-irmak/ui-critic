import { useState } from 'react';
import { CheckCircle, XCircle, Copy, Check, TrendingDown, AlertTriangle, ShieldCheck, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
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
    if (!analysis?.violations.length) return;
    
    // Group violations by category
    const grouped: Record<string, typeof analysis.violations> = {};
    const categoryLabels: Record<string, string> = {
      accessibility: 'Accessibility',
      usability: 'Usability',
      ethics: 'Ethical Design'
    };
    
    for (const v of analysis.violations) {
      if (!grouped[v.category]) grouped[v.category] = [];
      grouped[v.category].push(v);
    }
    
    // Build formatted text (without numeric ratios or code paths)
    let text = 'Please revise the UI design to address the following issues:\n';
    const categoryOrder = ['accessibility', 'usability', 'ethics'];
    
    for (const cat of categoryOrder) {
      if (!grouped[cat]?.length) continue;
      text += `\n${categoryLabels[cat]}:\n`;
      for (const v of grouped[cat]) {
        text += `- ${v.correctivePrompt}\n`;
        if (v.contextualHint) {
          text += `  Context: ${v.contextualHint}\n`;
        }
      }
    }
    
    try {
      await navigator.clipboard.writeText(text.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
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

  // Check if there are any confirmed or potential A1 violations
  const hasConfirmedA1 = analysis.violations.some(v => v.ruleId === 'A1' && v.status === 'confirmed');
  const hasPotentialA1 = analysis.violations.some(v => v.ruleId === 'A1' && v.status === 'potential');

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

      {/* Confidence Note for A1 */}
      {(hasConfirmedA1 || hasPotentialA1) && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border border-border">
          <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-sm text-muted-foreground">
            <strong>About contrast analysis:</strong> Confirmed issues require computed DOM styles from a running application (via axe-core or browser DevTools). Potential issues are heuristic observations that should be verified with accessibility audit tools.
          </p>
        </div>
      )}

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
                className="p-4 rounded-lg bg-muted/50 border border-border space-y-3"
              >
                {/* Header: Rule ID, Name, Status Badge, Confidence */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={cn(
                      'category-badge flex-shrink-0',
                      categoryColors[violation.category]
                    )}>
                      {violation.ruleId}
                    </span>
                    <span className="font-medium">{violation.ruleName}</span>
                    
                    {/* Status Badge for A1 */}
                    {violation.ruleId === 'A1' && violation.status && (
                      <Badge 
                        variant={violation.status === 'confirmed' ? 'default' : 'secondary'}
                        className={cn(
                          'gap-1 text-xs',
                          violation.status === 'confirmed' 
                            ? 'bg-destructive/10 text-destructive border-destructive/30' 
                            : 'bg-warning/10 text-warning border-warning/30'
                        )}
                      >
                        {violation.status === 'confirmed' ? (
                          <>
                            <ShieldCheck className="h-3 w-3" />
                            Confirmed (Measured)
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-3 w-3" />
                            Potential Risk (Heuristic)
                          </>
                        )}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded flex-shrink-0">
                    {Math.round(violation.confidence * 100)}%
                  </span>
                </div>

                {/* Contrast Ratio Details (for confirmed A1 with computed colors) */}
                {violation.ruleId === 'A1' && violation.status === 'confirmed' && violation.contrastRatio && (
                  <div className="flex flex-wrap items-center gap-4 p-2 rounded bg-destructive/5 border border-destructive/20 text-sm">
                    {violation.elementDescription && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Element:</span>
                        <span className="font-medium">{violation.elementDescription}</span>
                      </div>
                    )}
                    {violation.foregroundHex && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Foreground:</span>
                        <span className="font-mono font-medium">{violation.foregroundHex}</span>
                        <span 
                          className="w-4 h-4 rounded border border-border" 
                          style={{ backgroundColor: violation.foregroundHex }}
                        />
                      </div>
                    )}
                    {violation.backgroundHex && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Background:</span>
                        <span className="font-mono font-medium">{violation.backgroundHex}</span>
                        <span 
                          className="w-4 h-4 rounded border border-border" 
                          style={{ backgroundColor: violation.backgroundHex }}
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Ratio:</span>
                      <span className="font-mono font-medium text-destructive">{violation.contrastRatio}:1</span>
                    </div>
                    {violation.thresholdUsed && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Required:</span>
                        <span className="font-mono font-medium">{violation.thresholdUsed}:1</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Evidence (for A1) */}
                {violation.ruleId === 'A1' && violation.evidence && (
                  <p className="text-sm text-muted-foreground italic pl-1">
                    📍 {violation.evidence}
                  </p>
                )}

                {/* Diagnosis */}
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