import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Bug } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Analysis } from '@/types/project';
import { runUIAnalysis } from '@/lib/api/analysis';

const STORAGE_KEY = 'a3-debug-enabled';

interface A3DebugEntry {
  type: string;
  blockId?: string;
  screenshotRef?: string;
  detectedLines?: number | string;
  avgTextHeight?: number | string;
  avgBaselineDistance?: number | string;
  estimatedRatio?: number | string;
  thresholdBand?: string;
  classification?: string;
  rawDiagnosis?: string;
  rawEvidence?: string;
  message?: string;
}

interface A3DebugSummary {
  debugEnabled: boolean;
  lastRunAt: string | null;
  inputType: string;
  numTextBlocksDetected: number;
  numMultiLineBlocks: number;
  numBaselineEstimatesSucceeded: number;
  numA3CandidatesEvaluated: number;
  numPotentialFlagsTriggered: number;
  status: 'OK' | 'NO_BLOCKS_DETECTED' | 'ANALYZER_NOT_CALLED';
  entries: A3DebugEntry[];
}

function getDebugEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === 'true'; // default ON
  } catch {
    return true;
  }
}

function buildSummary(analysis: Analysis | null): A3DebugSummary {
  const enabled = getDebugEnabled();

  if (!analysis) {
    return {
      debugEnabled: enabled,
      lastRunAt: null,
      inputType: 'unknown',
      numTextBlocksDetected: 0,
      numMultiLineBlocks: 0,
      numBaselineEstimatesSucceeded: 0,
      numA3CandidatesEvaluated: 0,
      numPotentialFlagsTriggered: 0,
      status: 'ANALYZER_NOT_CALLED',
      entries: [],
    };
  }

  const a3Violation = analysis.violations.find(v => v.ruleId === 'A3' && v.isA3Aggregated);
  const debugLogs: A3DebugEntry[] = (a3Violation as any)?._a3DebugLogs || [];
  const a3Elements = a3Violation?.a3Elements || [];

  const inputType = a3Violation?.inputType || 
    analysis.violations.find(v => v.inputType)?.inputType || 'unknown';

  const blockAnalyses = debugLogs.filter(e => e.type === 'block_analysis');
  const singleLineEntries = debugLogs.filter(e => e.type === 'single_line');
  const failedEntries = debugLogs.filter(e => e.type === 'estimation_failed');
  const noBlocksEntries = debugLogs.filter(e => e.type === 'no_blocks');

  const numTextBlocksDetected = blockAnalyses.length + singleLineEntries.length + failedEntries.length;
  const multiLine = blockAnalyses.filter(e => {
    const lines = typeof e.detectedLines === 'number' ? e.detectedLines : 0;
    return lines >= 2 || e.detectedLines === 'unknown';
  });
  const estimatesSucceeded = blockAnalyses.filter(e => typeof e.estimatedRatio === 'number');
  const potentialFlags = a3Elements.length;

  let status: A3DebugSummary['status'] = 'OK';
  if (noBlocksEntries.length > 0 || (numTextBlocksDetected === 0 && debugLogs.length === 0)) {
    status = debugLogs.length === 0 ? 'ANALYZER_NOT_CALLED' : 'NO_BLOCKS_DETECTED';
  }

  return {
    debugEnabled: enabled,
    lastRunAt: analysis.analyzedAt ? new Date(analysis.analyzedAt).toISOString() : null,
    inputType,
    numTextBlocksDetected,
    numMultiLineBlocks: multiLine.length,
    numBaselineEstimatesSucceeded: estimatesSucceeded.length,
    numA3CandidatesEvaluated: blockAnalyses.length,
    numPotentialFlagsTriggered: potentialFlags,
    status,
    entries: debugLogs.slice(0, 20),
  };
}

interface A3DebugPanelProps {
  analysis: Analysis | null;
  currentIteration?: {
    inputType: string;
    selectedRules: string[];
    inputData: any;
  };
}

export function A3DebugPanel({ analysis, currentIteration }: A3DebugPanelProps) {
  const [debugEnabled, setDebugEnabled] = useState(getDebugEnabled);
  const [isOpen, setIsOpen] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [rerunResult, setRerunResult] = useState<A3DebugSummary | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(debugEnabled));
    } catch { /* ignore */ }
  }, [debugEnabled]);

  const summary = rerunResult || buildSummary(analysis);

  const handleRerun = useCallback(async () => {
    if (!currentIteration) return;
    setRerunning(true);
    try {
      const result = await runUIAnalysis({
        images: currentIteration.inputData?.previews,
        categories: ['accessibility'],
        selectedRules: ['A3'],
        inputType: currentIteration.inputType as any,
        toolUsed: 'debug-rerun',
      });
      if (result.success && result.violations) {
        const fakeAnalysis: Analysis = {
          id: 'debug-rerun',
          iterationId: 'debug',
          violations: result.violations,
          totalViolations: result.violations.length,
          confirmedViolations: result.violations.filter(v => v.status === 'confirmed').length,
          potentialRisks: result.violations.filter(v => v.status === 'potential').length,
          violationsByCategory: {},
          correctivePrompt: '',
          isAcceptable: false,
          analyzedAt: new Date(),
        };
        setRerunResult(buildSummary(fakeAnalysis));
      }
    } catch (e) {
      console.error('A3 debug rerun failed:', e);
    } finally {
      setRerunning(false);
    }
  }, [currentIteration]);

  if (!debugEnabled) {
    return (
      <div className="flex items-center gap-3 py-2 px-3 rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20">
        <Bug className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">A3 debug is inactive</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Show A3 Debug</span>
          <Switch checked={debugEnabled} onCheckedChange={setDebugEnabled} />
        </div>
      </div>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border border-dashed border-warning/40 bg-warning/5">
        {/* Header — always visible */}
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center gap-2 p-3 cursor-pointer">
            <Bug className="h-4 w-4 text-warning" />
            <Badge variant="outline" className="text-xs font-mono border-warning/50 text-warning">DEBUG</Badge>
            <span className="text-sm font-medium text-warning">A3 debug is active ✅</span>
            <div className="ml-auto flex items-center gap-2">
              {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CollapsibleTrigger>

        {/* Toggle — outside collapsible content so it's always accessible */}
        <div className="flex items-center gap-2 px-3 pb-2" onClick={e => e.stopPropagation()}>
          <span className="text-xs text-muted-foreground">Show A3 Debug</span>
          <Switch checked={debugEnabled} onCheckedChange={setDebugEnabled} />
          {currentIteration?.inputData?.previews && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto text-xs h-7 gap-1 border-warning/40 text-warning hover:bg-warning/10"
              onClick={handleRerun}
              disabled={rerunning}
            >
              {rerunning ? 'Running…' : 'Run A3 Debug Now'}
            </Button>
          )}
        </div>

        <CollapsibleContent>
          <div className="border-t border-warning/20 p-3 space-y-3">
            {/* Summary table */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
              <SummaryRow label="debugEnabled" value={String(summary.debugEnabled)} />
              <SummaryRow label="lastRunAt" value={summary.lastRunAt || '—'} />
              <SummaryRow label="inputType" value={summary.inputType} />
              <SummaryRow label="status" value={summary.status} highlight={summary.status !== 'OK'} />
              <SummaryRow label="numTextBlocksDetected" value={String(summary.numTextBlocksDetected)} />
              <SummaryRow label="numMultiLineBlocks" value={String(summary.numMultiLineBlocks)} />
              <SummaryRow label="numBaselineEstimatesSucceeded" value={String(summary.numBaselineEstimatesSucceeded)} />
              <SummaryRow label="numA3CandidatesEvaluated" value={String(summary.numA3CandidatesEvaluated)} />
              <SummaryRow label="numPotentialFlagsTriggered" value={String(summary.numPotentialFlagsTriggered)} />
            </div>

            {/* Per-block entries */}
            {summary.entries.length > 0 ? (
              <div className="space-y-1.5 pt-2 border-t border-warning/20">
                <span className="text-xs font-medium text-muted-foreground">Per-block entries ({summary.entries.length})</span>
                {summary.entries.map((entry, i) => (
                  <DebugEntryRow key={i} entry={entry} />
                ))}
              </div>
            ) : (
              <div className="pt-2 border-t border-warning/20">
                <span className="text-xs text-muted-foreground italic">
                  {summary.status === 'NO_BLOCKS_DETECTED'
                    ? 'No multi-line paragraph blocks detected in screenshot.'
                    : summary.status === 'ANALYZER_NOT_CALLED'
                    ? 'A3 analyzer was not called for this iteration (rule not selected or no data).'
                    : 'No per-block entries available.'}
                </span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function SummaryRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <>
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn(highlight ? 'text-warning font-semibold' : 'text-foreground')}>{value}</span>
    </>
  );
}

function DebugEntryRow({ entry }: { entry: A3DebugEntry }) {
  if (entry.type === 'block_analysis') {
    return (
      <div className="text-xs font-mono text-muted-foreground rounded bg-muted/30 p-2 space-y-0.5">
        <div>
          <span className="text-foreground font-semibold">[{entry.blockId}]</span>{' '}
          {entry.screenshotRef}
        </div>
        <div>
          Lines: {entry.detectedLines} | Text H: {entry.avgTextHeight} | Baseline: {entry.avgBaselineDistance}
        </div>
        <div>
          Ratio: {typeof entry.estimatedRatio === 'number' ? entry.estimatedRatio.toFixed(2) : entry.estimatedRatio} | Band: {entry.thresholdBand}
        </div>
        <div>
          Classification:{' '}
          <span className={cn(
            entry.classification?.includes('No finding') ? 'text-muted-foreground' : 'text-warning'
          )}>
            {entry.classification}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="text-xs font-mono text-warning/80 rounded bg-muted/30 p-2">
      [{entry.type}] {entry.message}
    </div>
  );
}
