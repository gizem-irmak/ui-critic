import { useState } from 'react';
import { 
  CheckCircle, XCircle, Copy, Check, TrendingDown, TrendingUp, 
  AlertTriangle, ShieldCheck, AlertCircle, FileText, X 
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { Iteration, Project } from '@/types/project';
import { PotentialRisksSection } from './PotentialRiskItem';
import { A1AggregatedCard } from './A1AggregatedCard';

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
  const [copied, setCopied] = useState(false);

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

  // Deduplicate prompts - ONLY for confirmed violations
  const confirmedViolations = analysis.violations.filter(v => v.status !== 'potential');
  
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

            {/* Aggregated A1 Confirmed Card (if exists) */}
            {analysis.violations.find(v => v.ruleId === 'A1' && v.isA1Aggregated && v.status === 'confirmed') && (
              <A1AggregatedCard 
                violation={analysis.violations.find(v => v.ruleId === 'A1' && v.isA1Aggregated && v.status === 'confirmed')!} 
                compact 
              />
            )}

            {/* Other Confirmed Issues (Blocking) - excluding A1 aggregated */}
            {(() => {
              const nonA1Confirmed = analysis.violations.filter(v => 
                v.status !== 'potential' && 
                !(v.ruleId === 'A1' && v.isA1Aggregated)
              );
              return nonA1Confirmed.length > 0 && (
                <Card className="border-destructive/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg font-bold">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      Confirmed Violations (Blocking) — {nonA1Confirmed.length}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {nonA1Confirmed.map((violation, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-destructive/5 border border-destructive/20 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={cn('category-badge text-xs', categoryColors[violation.category])}>
                                {violation.ruleId}
                              </span>
                              <span className="font-medium text-sm">{violation.ruleName}</span>
                              <Badge className="gap-1 text-xs bg-destructive/10 text-destructive border-destructive/30">
                                <ShieldCheck className="h-3 w-3" />
                                Confirmed
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                              {Math.round(violation.confidence * 100)}%
                            </span>
                          </div>

                          {violation.evidence && (
                            <p className="text-xs text-muted-foreground italic">📍 {violation.evidence}</p>
                          )}

                          <p className="text-sm text-foreground leading-relaxed">{violation.diagnosis}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {/* Aggregated A1 Potential Card (if exists) */}
            {analysis.violations.find(v => v.ruleId === 'A1' && v.isA1Aggregated && v.status === 'potential') && (
              <A1AggregatedCard 
                violation={analysis.violations.find(v => v.ruleId === 'A1' && v.isA1Aggregated && v.status === 'potential')!} 
                compact 
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
                    <CardTitle className="flex items-center gap-2 text-lg font-bold">
                      <AlertCircle className="h-5 w-5 text-warning" />
                      Potential Risks (Non-blocking) — {nonA1Potential.length}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <PotentialRisksSection violations={nonA1Potential} compact />
                  </CardContent>
                </Card>
              );
            })()}

            {analysis.violations.length === 0 && (
              <Card>
                <CardContent className="py-6 text-center text-muted-foreground">
                  No violations detected in this iteration
                </CardContent>
              </Card>
            )}

            {/* Corrective Prompt - ONLY for confirmed violations */}
            {confirmedViolations.length > 0 && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-sm">Corrective Prompts</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyPrompt}
                    className="gap-2 h-8"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy All
                      </>
                    )}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {deduplicatedPrompts.map((item, idx) => {
                    const hintsArray = Array.from(item.hints);
                    const ruleIdsArray = Array.from(item.ruleIds);
                    const ruleNamesArray = Array.from(item.ruleNames);
                    
                    return (
                      <div key={idx} className="space-y-1 pb-3 border-b border-border last:border-0 last:pb-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {ruleIdsArray.map((ruleId) => (
                            <span key={ruleId} className={cn('category-badge text-xs', categoryColors[item.category])}>
                              {ruleId}
                            </span>
                          ))}
                          <span className="text-xs font-medium text-muted-foreground">
                            {ruleNamesArray.length === 1 
                              ? ruleNamesArray[0] 
                              : `${ruleNamesArray[0]} (+${ruleNamesArray.length - 1} more)`}
                          </span>
                        </div>
                        <p className="text-sm bg-primary/5 p-2 rounded border-l-2 border-primary">
                          {item.prompt}
                        </p>
                        {hintsArray.length === 1 && (
                          <p className="text-xs text-muted-foreground italic">💡 {hintsArray[0]}</p>
                        )}
                        {hintsArray.length > 1 && (
                          <ul className="text-xs text-muted-foreground italic space-y-0.5">
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
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
