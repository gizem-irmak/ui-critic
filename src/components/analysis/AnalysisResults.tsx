import { useState } from 'react';
import { CheckCircle, XCircle, Copy, Check, AlertTriangle, ShieldCheck, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Analysis, Project } from '@/types/project';
import { PotentialRisksSection } from './PotentialRiskItem';
import { A1AggregatedCard } from './A1AggregatedCard';
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
  const [copied, setCopied] = useState(false);

  // Deduplicate prompts: group by prompt text, collect unique hints
  // ONLY include confirmed violations - potential risks don't get corrective prompts
  const confirmedViolations = analysis.violations.filter(v => v.status === 'confirmed' || v.status !== 'potential');
  
  const deduplicatedPrompts = (() => {
    const promptMap = new Map<string, { 
      prompt: string; 
      hints: Set<string>; 
      ruleIds: Set<string>;
      ruleNames: Set<string>;
      category: string;
    }>();
    
    for (const v of confirmedViolations) {
      const key = v.correctivePrompt;
      if (!promptMap.has(key)) {
        promptMap.set(key, {
          prompt: v.correctivePrompt,
          hints: new Set(),
          ruleIds: new Set([v.ruleId]),
          ruleNames: new Set([v.ruleName]),
          category: v.category,
        });
      }
      const entry = promptMap.get(key)!;
      if (v.contextualHint) {
        entry.hints.add(v.contextualHint);
      }
      entry.ruleIds.add(v.ruleId);
      entry.ruleNames.add(v.ruleName);
    }
    
    return Array.from(promptMap.values());
  })();

  const copyPrompt = async () => {
    if (!confirmedViolations.length) return;
    
    // Group by category for clipboard - only confirmed violations
    const categoryLabels: Record<string, string> = {
      accessibility: 'Accessibility',
      usability: 'Usability',
      ethics: 'Ethics'
    };
    
    const grouped: Record<string, typeof deduplicatedPrompts> = {};
    for (const item of deduplicatedPrompts) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }
    
    let text = 'Please revise the UI design to address the following issues:\n';
    const categoryOrder = ['accessibility', 'usability', 'ethics'];
    
    for (const cat of categoryOrder) {
      if (!grouped[cat]?.length) continue;
      text += `\n${categoryLabels[cat]}:\n`;
      for (const item of grouped[cat]) {
        text += `- ${item.prompt}\n`;
        const hintsArray = Array.from(item.hints);
        if (hintsArray.length === 1) {
          text += `  Context: ${hintsArray[0]}\n`;
        } else if (hintsArray.length > 1) {
          for (const hint of hintsArray) {
            text += `  • ${hint}\n`;
          }
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

      {/* Confirmed Issues (Blocking) - all confirmed violations */}
      {(() => {
        const confirmedViolationsList = analysis.violations.filter(v => v.status !== 'potential');
        const a1Aggregated = confirmedViolationsList.find(v => v.ruleId === 'A1' && v.isA1Aggregated);
        const otherConfirmed = confirmedViolationsList.filter(v => !(v.ruleId === 'A1' && v.isA1Aggregated));
        
        return confirmedViolationsList.length > 0 && (
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Confirmed Issues (Blocking) — {confirmedViolationsList.length}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* A1 Aggregated Card if exists */}
              {a1Aggregated && (
                <A1AggregatedCard violation={a1Aggregated} />
              )}
              
              {/* Other confirmed issues */}
              {otherConfirmed.length > 0 && (
                <div className="space-y-3">
                  {otherConfirmed.map((violation, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-lg bg-destructive/5 border border-destructive/20 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className={cn('category-badge flex-shrink-0', categoryColors[violation.category])}>
                            {violation.ruleId}
                          </span>
                          <span className="font-medium">{violation.ruleName}</span>
                          <Badge className="gap-1 text-xs bg-destructive/10 text-destructive border-destructive/30">
                            <ShieldCheck className="h-3 w-3" />
                            Confirmed
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded flex-shrink-0">
                          {Math.round(violation.confidence * 100)}%
                        </span>
                      </div>

                      {violation.evidence && (
                        <p className="text-sm text-muted-foreground italic pl-1">📍 {violation.evidence}</p>
                      )}
                      <p className="text-sm text-foreground leading-relaxed pl-1">{violation.diagnosis}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Aggregated A1 Potential Card (if exists) */}
      {analysis.violations.find(v => v.ruleId === 'A1' && v.isA1Aggregated && v.status === 'potential') && (
        <A1AggregatedCard 
          violation={analysis.violations.find(v => v.ruleId === 'A1' && v.isA1Aggregated && v.status === 'potential')!} 
        />
      )}

      {/* Other Potential Risks (Non-blocking) - excluding A1 aggregated */}
      {(() => {
        const nonA1Potential = analysis.violations.filter(v => 
          v.status === 'potential' && 
          !(v.ruleId === 'A1' && v.isA1Aggregated)
        );
        return nonA1Potential.length > 0 && (
          <Card className="border-warning/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-warning" />
                Other Potential Risks (Non-blocking) — {nonA1Potential.length}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Reported for awareness only. These findings do not affect convergence.
              </p>
            </CardHeader>
            <CardContent>
              <PotentialRisksSection violations={nonA1Potential} />
            </CardContent>
          </Card>
        );
      })()}

      {analysis.violations.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No violations detected
          </CardContent>
        </Card>
      )}

      {/* Corrective Prompt Section - ONLY for confirmed violations */}
      {confirmedViolations.length > 0 && (
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
            {deduplicatedPrompts.map((item, idx) => {
              const hintsArray = Array.from(item.hints);
              const ruleIdsArray = Array.from(item.ruleIds);
              const ruleNamesArray = Array.from(item.ruleNames);
              
              return (
                <div key={idx} className="space-y-2 pb-4 border-b border-border last:border-0 last:pb-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {ruleIdsArray.map((ruleId, rIdx) => (
                      <span key={ruleId} className={cn(
                        'category-badge flex-shrink-0 text-xs',
                        categoryColors[item.category]
                      )}>
                        {ruleId}
                      </span>
                    ))}
                    <span className="text-sm font-medium">
                      {ruleNamesArray.length === 1 
                        ? ruleNamesArray[0] 
                        : `${ruleNamesArray[0]} (+${ruleNamesArray.length - 1} more)`}
                    </span>
                  </div>
                  <p className="text-sm bg-primary/5 p-3 rounded border-l-2 border-primary">
                    {item.prompt}
                  </p>
                  {hintsArray.length === 1 && (
                    <p className="text-xs text-muted-foreground italic pl-1">
                      💡 {hintsArray[0]}
                    </p>
                  )}
                  {hintsArray.length > 1 && (
                    <ul className="text-xs text-muted-foreground italic pl-1 space-y-1">
                      {hintsArray.map((hint, hIdx) => (
                        <li key={hIdx}>💡 {hint}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

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