import { FileText } from 'lucide-react';

export function MethodologyStatement() {
  return (
    <div className="border-t border-border pt-6 mt-8">
      <div className="flex items-start gap-3 text-xs text-muted-foreground">
        <FileText className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium text-foreground/80">Methodology</p>
          <p>
            Fixed rule set • Static analysis only • Tool-agnostic evaluation • Acceptance-threshold convergence
          </p>
        </div>
      </div>
    </div>
  );
}
