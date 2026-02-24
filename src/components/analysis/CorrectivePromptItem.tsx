import { cn } from '@/lib/utils';

interface CorrectivePromptItemProps {
  elementLabel: string;
  roleOrTag: string;
  fileName: string;
  issueReason: string;
  recommendedFix: string;
}

export function CorrectivePromptItem({
  elementLabel,
  roleOrTag,
  fileName,
  issueReason,
  recommendedFix,
}: CorrectivePromptItemProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground font-medium pl-1">
        📍 {elementLabel} ({roleOrTag}) — {fileName}
      </p>
      <div className="text-sm bg-primary/5 p-3 rounded border-l-2 border-primary space-y-2">
        <div>
          <span className="font-semibold">Issue reason:</span>
          <br />
          {issueReason}
        </div>
        <div>
          <span className="font-semibold">Recommended fix:</span>
          <br />
          {recommendedFix}
        </div>
      </div>
    </div>
  );
}
