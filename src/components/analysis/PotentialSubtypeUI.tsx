import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Small badge shown beside element labels inside Potential Risks section.
 * Distinguishes "Accuracy" (measurement uncertainty) from "Borderline" (below recommended).
 */
export function PotentialSubtypeBadge({ subtype, compact = false }: {
  subtype: 'accuracy' | 'borderline';
  compact?: boolean;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs font-normal',
        subtype === 'accuracy'
          ? 'border-warning/50 text-warning'
          : 'border-accent-foreground/50 text-accent-foreground',
        compact ? 'px-1.5 py-0' : ''
      )}
    >
      {subtype === 'accuracy' ? 'Accuracy' : 'Borderline'}
    </Badge>
  );
}

/**
 * Advisory guidance box that renders different content based on potentialSubtype.
 *
 * - Accuracy: recommends uploading ZIP/GitHub for deterministic verification.
 * - Borderline: recommends improvement (no mention of uploading other inputs).
 * - Fallback: uses the violation-level advisoryGuidance string.
 */

const ACCURACY_GUIDANCE: Record<string, string> = {
  A2: 'Static visual estimation cannot determine exact computed font sizes. For deterministic verification, upload ZIP source code or provide a GitHub repository.',
  A3: 'Visual estimation cannot determine exact computed line-height ratios. For deterministic verification, upload the rendered source code (ZIP file) or provide a GitHub repository.',
  A4: 'Screenshot estimation cannot guarantee exact target sizes. For deterministic measurement, upload ZIP source code or provide a GitHub repository.',
};

const BORDERLINE_GUIDANCE: Record<string, string> = {
  A2: 'Font size meets the technical minimum but is below the recommended 16px baseline for comfortable reading. Consider increasing body text to at least 16px for improved readability.',
  A3: 'Line spacing is near the lower bound. Consider increasing line-height to ~1.45–1.6 for improved readability.',
  A4: 'Target size meets the minimum 20px threshold but is below the recommended 24×24px comfort size. Consider increasing for easier clicking.',
};

export function SubtypeAdvisoryGuidance({ ruleId, potentialSubtype, fallbackGuidance, compact = false }: {
  ruleId: string;
  potentialSubtype?: 'accuracy' | 'borderline';
  fallbackGuidance?: string;
  compact?: boolean;
}) {
  let guidanceText: string | undefined;

  if (potentialSubtype === 'accuracy') {
    guidanceText = ACCURACY_GUIDANCE[ruleId] || fallbackGuidance;
  } else if (potentialSubtype === 'borderline') {
    guidanceText = BORDERLINE_GUIDANCE[ruleId] || fallbackGuidance;
  } else {
    guidanceText = fallbackGuidance;
  }

  if (!guidanceText) return null;

  return (
    <div className={cn(
      'rounded-lg bg-muted/30 border border-border mt-3',
      compact ? 'p-2' : 'p-3'
    )}>
      <p className={cn('font-medium text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
        💡 Advisory Guidance
      </p>
      <p className={cn('text-muted-foreground mt-1', compact ? 'text-xs' : 'text-sm')}>
        {guidanceText}
      </p>
    </div>
  );
}
