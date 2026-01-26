import { Info, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface BaselineAssessmentProps {
  isBaselineCompliant: boolean;
  iterationsRequired: number;
  finalIssues: number;
}

export function BaselineAssessment({ 
  isBaselineCompliant, 
  iterationsRequired,
  finalIssues 
}: BaselineAssessmentProps) {
  if (!isBaselineCompliant) return null;

  return (
    <Card className="border-2 border-primary/20 bg-primary/5 print:border print:bg-transparent">
      <CardContent className="pt-6">
        <div className="flex items-start gap-4">
          <div className="p-2 rounded-full bg-primary/10">
            <Info className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-foreground">Baseline Assessment</h3>
              <Badge 
                variant="outline" 
                className="gap-1.5 bg-primary/10 text-primary border-primary/30 font-medium text-xs"
              >
                <CheckCircle2 className="h-3 w-3" />
                Baseline-Compliant UI
              </Badge>
            </div>
            <p className="text-muted-foreground leading-relaxed">
              The initial UI met the acceptance threshold upon first evaluation. 
              No iterative refinement was required.
            </p>
            <div className="flex items-center gap-4 text-sm pt-1">
              <span className="text-foreground">
                <span className="font-medium">Total issues:</span>{' '}
                <span className="font-mono">{finalIssues}</span>
                <span className="text-muted-foreground ml-1">(baseline-compliant UI)</span>
              </span>
              <span className="text-muted-foreground/50">•</span>
              <span className="text-foreground">
                <span className="font-medium">Iterations required:</span>{' '}
                <span className="font-mono">{iterationsRequired}</span>
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
