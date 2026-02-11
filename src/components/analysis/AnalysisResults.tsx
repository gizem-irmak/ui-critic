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
import { A2AggregatedCard } from './A2AggregatedCard';
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

  // Collect ALL corrective prompts from confirmed violations, including A1 element-level prompts
  // ONLY include confirmed violations - potential risks don't get corrective prompts
  const confirmedViolations = analysis.violations.filter(v => v.status === 'confirmed' || v.status !== 'potential');
  
  // Group prompts by rule code, with element references for traceability
  const groupedPrompts = (() => {
    const ruleGroups = new Map<string, {
      ruleId: string;
      ruleName: string;
      category: string;
      prompts: Array<{
        prompt: string;
        elementRef?: string; // e.g., "navigation 'Departments' — Screenshot #1"
      }>;
    }>();
    
    for (const v of confirmedViolations) {
      // Handle A1 aggregated violations with element-level prompts
      if (v.ruleId === 'A1' && v.isA1Aggregated && v.a1Elements) {
        if (!ruleGroups.has('A1')) {
          ruleGroups.set('A1', {
            ruleId: 'A1',
            ruleName: v.ruleName,
            category: v.category,
            prompts: [],
          });
        }
        const group = ruleGroups.get('A1')!;
        
        for (const el of v.a1Elements) {
          if (el.correctivePrompt) {
            // Build element reference from available data
            const elementRef = [
              el.uiRole || el.elementLabel,
              el.textSnippet ? `'${el.textSnippet}'` : null,
              el.location ? `— ${el.location}` : null,
            ].filter(Boolean).join(' ');
            
            group.prompts.push({
              prompt: el.correctivePrompt,
              elementRef: elementRef || el.elementLabel,
            });
          }
        }
      } else if (v.ruleId === 'A2' && v.isA2Aggregated && v.a2Elements) {
        // Handle A2 aggregated violations with element-level prompts
        if (!ruleGroups.has('A2')) {
          ruleGroups.set('A2', {
            ruleId: 'A2',
            ruleName: v.ruleName,
            category: v.category,
            prompts: [],
          });
        }
        const group = ruleGroups.get('A2')!;
        
        for (const el of v.a2Elements) {
          if (el.correctivePrompt) {
            const elementRef = [
              el.elementLabel,
              el.location ? `— ${el.location}` : null,
            ].filter(Boolean).join(' ');
            
            group.prompts.push({
              prompt: el.correctivePrompt,
              elementRef: elementRef || el.elementLabel,
            });
          }
        }
      } else if (v.correctivePrompt) {
        // Handle non-aggregated violations
        const key = v.ruleId;
        if (!ruleGroups.has(key)) {
          ruleGroups.set(key, {
            ruleId: v.ruleId,
            ruleName: v.ruleName,
            category: v.category,
            prompts: [],
          });
        }
        const group = ruleGroups.get(key)!;
        
        // Deduplicate by prompt text within the same rule
        const existing = group.prompts.find(p => p.prompt === v.correctivePrompt);
        if (!existing) {
          group.prompts.push({
            prompt: v.correctivePrompt,
            elementRef: v.contextualHint || v.evidence,
          });
        }
      }
    }
    
    return Array.from(ruleGroups.values()).filter(g => g.prompts.length > 0);
  })();

  const copyPrompt = async () => {
    if (!groupedPrompts.length) return;
    
    // Group by category for clipboard - only confirmed violations
    const categoryLabels: Record<string, string> = {
      accessibility: 'Accessibility',
      usability: 'Usability',
      ethics: 'Ethics'
    };
    
    const grouped: Record<string, typeof groupedPrompts> = {};
    for (const item of groupedPrompts) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }
    
    let text = 'Please revise the UI design to address the following issues:\n';
    const categoryOrder = ['accessibility', 'usability', 'ethics'];
    
    for (const cat of categoryOrder) {
      if (!grouped[cat]?.length) continue;
      text += `\n${categoryLabels[cat]}:\n`;
      for (const ruleGroup of grouped[cat]) {
        text += `\n[${ruleGroup.ruleId}] ${ruleGroup.ruleName}:\n`;
        for (const item of ruleGroup.prompts) {
          if (item.elementRef) {
            text += `  • ${item.elementRef}\n`;
          }
          text += `    ${item.prompt.replace(/\n/g, '\n    ')}\n`;
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
        const a2Aggregated = confirmedViolationsList.find(v => v.ruleId === 'A2' && v.isA2Aggregated);
        const otherConfirmed = confirmedViolationsList.filter(v => 
          !(v.ruleId === 'A1' && v.isA1Aggregated) && 
          !(v.ruleId === 'A2' && v.isA2Aggregated)
        );
        
        return confirmedViolationsList.length > 0 && (
          <div className="space-y-4">
            {/* Section Header */}
            <div className="flex items-center gap-2 pt-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h3 className="text-xl font-bold text-foreground">Confirmed Violations (Blocking)</h3>
              <span className="text-sm text-muted-foreground">
                — {confirmedViolationsList.length} issue{confirmedViolationsList.length !== 1 ? 's' : ''}
              </span>
            </div>
            
            {/* A1 Aggregated Card if exists */}
            {a1Aggregated && (
              <A1AggregatedCard violation={a1Aggregated} />
            )}
            
            {/* A2 Aggregated Card if exists */}
            {a2Aggregated && (
              <A2AggregatedCard violation={a2Aggregated} />
            )}
            {/* Other confirmed issues */}
            {otherConfirmed.length > 0 && (
              <Card className="border-destructive/30">
                <CardContent className="pt-4 space-y-3">
                  {otherConfirmed.map((violation, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-lg bg-destructive/5 border border-destructive/20 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn('category-badge flex-shrink-0 text-xs', categoryColors[violation.category])}>
                            {violation.ruleId}
                          </span>
                          <span className="font-bold text-base">{violation.ruleName}</span>
                        </div>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded flex-shrink-0">
                          {Math.round(violation.confidence * 100)}%
                        </span>
                      </div>
                      
                      {/* Spacing separator */}
                      <div className="h-1" />

                      {violation.evidence && (
                        <p className="text-sm text-muted-foreground italic pl-1">📍 {violation.evidence}</p>
                      )}
                      <p className="text-sm text-foreground leading-relaxed pl-1">{violation.diagnosis}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        );
      })()}

      {/* Potential Issues Section */}
      {(() => {
        const a1Potential = analysis.violations.find(v => v.ruleId === 'A1' && v.isA1Aggregated && v.status === 'potential');
        const a2Potential = analysis.violations.find(v => v.ruleId === 'A2' && v.isA2Aggregated && v.status === 'potential');
        const nonAggregatedPotential = analysis.violations.filter(v => 
          v.status === 'potential' && 
          !(v.ruleId === 'A1' && v.isA1Aggregated) &&
          !(v.ruleId === 'A2' && v.isA2Aggregated)
        );
        const hasPotentialIssues = a1Potential || a2Potential || nonAggregatedPotential.length > 0;
        const totalPotential = (a1Potential ? 1 : 0) + (a2Potential ? 1 : 0) + nonAggregatedPotential.length;
        
        return hasPotentialIssues && (
          <div className="space-y-4">
            {/* Section Header */}
            <div className="flex items-center gap-2 pt-2">
              <AlertCircle className="h-5 w-5 text-warning" />
              <h3 className="text-xl font-bold text-foreground">Potential Risks (Non-blocking)</h3>
              <span className="text-sm text-muted-foreground">
                — {totalPotential} issue{totalPotential !== 1 ? 's' : ''}
              </span>
            </div>
            
            {/* A1 Potential Card */}
            {a1Potential && (
              <A1AggregatedCard violation={a1Potential} />
            )}
            
            {/* A2 Potential Card */}
            {a2Potential && (
              <A2AggregatedCard violation={a2Potential} />
            )}
            
            {/* Other Potential Risks */}
            {nonAggregatedPotential.length > 0 && (
              <Card className="border-warning/30">
                <CardContent className="pt-4">
                  <PotentialRisksSection violations={nonAggregatedPotential} />
                </CardContent>
              </Card>
            )}
          </div>
        );
      })()}

      {analysis.violations.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No violations detected
          </CardContent>
        </Card>
      )}

      {/* Corrective Prompt Section - ONLY for confirmed violations, grouped by rule */}
      {groupedPrompts.length > 0 && (
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
          <CardContent className="space-y-6">
            {groupedPrompts.map((group, idx) => (
              <div key={idx} className="space-y-3 pb-4 border-b border-border last:border-0 last:pb-0">
                {/* Rule header */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    'category-badge flex-shrink-0 text-xs',
                    categoryColors[group.category]
                  )}>
                    {group.ruleId}
                  </span>
                  <span className="text-sm font-medium">{group.ruleName}</span>
                  {group.prompts.length > 1 && (
                    <Badge variant="outline" className="text-xs">
                      {group.prompts.length} elements
                    </Badge>
                  )}
                </div>
                
                {/* Individual prompts with element references */}
                <div className="space-y-3">
                  {group.prompts.map((item, pIdx) => (
                    <div key={pIdx} className="space-y-1">
                      {/* Element reference */}
                      {item.elementRef && (
                        <p className="text-xs text-muted-foreground font-medium pl-1">
                          📍 {item.elementRef}
                        </p>
                      )}
                      {/* Prompt text */}
                      <div className="text-sm bg-primary/5 p-3 rounded border-l-2 border-primary whitespace-pre-line">
                        {item.prompt}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
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