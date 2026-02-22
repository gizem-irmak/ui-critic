import { MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Violation } from '@/types/project';

interface PotentialRiskItemProps {
  violation: Violation;
  compact?: boolean;
}

const categoryColors: Record<string, string> = {
  accessibility: 'category-accessibility',
  usability: 'category-usability',
  ethics: 'category-ethics',
};

/**
 * Cleans diagnosis text by removing all redundant status language and location 
 * references that are already conveyed by section context and structured UI elements.
 */
function cleanDiagnosisText(diagnosis?: string): string {
  if (!diagnosis) return '';
  
  return diagnosis
    // Remove status statements (already conveyed by section title)
    .replace(/\(?Heuristic\)?/gi, '')
    .replace(/This finding is labeled as ['"]?Potential Risk.*?['".]?\s*/gi, '')
    .replace(/This finding does not block convergence\.?\s*/gi, '')
    .replace(/This is reported as a potential risk\.?\s*/gi, '')
    .replace(/reported as a potential risk\.?\s*/gi, '')
    // Remove ALL convergence-related phrases (policy communicated at section level only)
    .replace(/and does not block convergence\.?\s*/gi, '')
    .replace(/does not block convergence\.?\s*/gi, '')
    .replace(/,?\s*and is non-blocking\.?\s*/gi, '')
    .replace(/,?\s*which is non-blocking\.?\s*/gi, '')
    .replace(/\(?non-blocking\)?\.?\s*/gi, '')
    .replace(/blocking/gi, '')
    .replace(/convergence/gi, '')
    .replace(/threshold/gi, '')
    // Remove static analysis mentions (redundant with input type badge)
    .replace(/Detected via static analysis\.?\s*/gi, '')
    .replace(/based on static analysis\.?\s*/gi, '')
    .replace(/via static code analysis\.?\s*/gi, '')
    // Remove location mentions that will be shown in structured Location row
    .replace(/in (the )?following (components?|files?|locations?):?\s*/gi, '')
    .replace(/Found in:?\s*/gi, '')
    .replace(/Detected in:?\s*/gi, '')
    .replace(/Occurs in:?\s*/gi, '')
    // Clean up artifacts (extra spaces, dangling punctuation, trailing quotes)
    .replace(/\s+/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/^\s*[,.:]\s*/, '')
    .replace(/\s*[,]\s*$/g, '.')
    // Remove trailing quotation marks and stray punctuation
    .replace(/\s*["']+\s*$/g, '')
    .replace(/\s*[)\]]+\s*$/g, '')
    .replace(/\.\s*["']+$/g, '.')
    .replace(/\s+\.$/g, '.')
    .trim();
}

/**
 * Extracts unique locations from violation data for structured display.
 */
function extractLocations(violation: Violation): string[] {
  const locations = new Set<string>();
  
  // From a1Elements array (new aggregated A1 format)
  if (violation.a1Elements && violation.a1Elements.length > 0) {
    for (const el of violation.a1Elements) {
      if (el.location) locations.add(el.location);
    }
  }
  
  // From elementIdentifier
  if (violation.elementIdentifier) {
    locations.add(violation.elementIdentifier);
  }

  // Fallback: use evidence as a location hint when no other location is available.
  // This is especially important for screenshot-based A1 where we may only have per-element evidence.
  if (locations.size === 0 && violation.evidence) {
    locations.add(violation.evidence);
  }
  
  return Array.from(locations);
}

const inputTypeLabels: Record<string, string> = {
  screenshots: 'Screenshot',
  zip: 'ZIP',
  github: 'GitHub',
};

export function PotentialRiskItem({ violation, compact = false }: PotentialRiskItemProps) {
  const cleanedDiagnosis = cleanDiagnosisText(violation.diagnosis);
  const locations = extractLocations(violation);
  const maxLocations = compact ? 3 : 5;
  
  return (
    <div className={cn(
      'rounded-lg bg-warning/5 border border-warning/20 space-y-2',
      compact ? 'p-3' : 'p-4'
    )}>
      {/* Header: Rule ID + Name + Input Type + Confidence */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('category-badge', compact ? 'text-xs' : '', categoryColors[violation.category])}>
            {violation.ruleId}
          </span>
          <span className={cn('font-bold', compact ? 'text-sm' : 'text-base')}>{violation.ruleName}</span>
          {violation.inputType && (
            <Badge variant="outline" className="text-xs font-normal">
              {inputTypeLabels[violation.inputType] || violation.inputType}
            </Badge>
          )}
        </div>
        <span className={cn(
          'text-muted-foreground bg-muted rounded flex-shrink-0',
          compact ? 'text-xs px-2 py-0.5' : 'text-xs px-2 py-1'
        )}>
          {Math.round(violation.confidence * 100)}%
        </span>
      </div>
      
      {/* Spacing separator */}
      <div className={compact ? 'h-0.5' : 'h-1'} />
      
      {/* Location (structured, separate block) */}
      {locations.length > 0 && (
        <div className={cn(
          'flex items-start gap-2 text-muted-foreground',
          compact ? 'text-xs' : 'text-sm'
        )}>
          <MapPin className={cn('flex-shrink-0 mt-0.5', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
          <div>
            <span className="font-medium">Location: </span>
            <span>
              {locations.slice(0, maxLocations).join(', ')}
              {locations.length > maxLocations && (
                <span className="italic"> +{locations.length - maxLocations} more</span>
              )}
            </span>
          </div>
        </div>
      )}
      
      {/* Finding description (cleaned of redundant status/location text) */}
      {cleanedDiagnosis && (
        <p className={cn(
          'text-foreground leading-relaxed',
          compact ? 'text-sm' : 'text-sm'
        )}>
          {cleanedDiagnosis}
        </p>
      )}

      {/* A1 Contrast details — structural mode only (hide for perceptual/screenshot) */}
      {violation.ruleId === 'A1' && !violation.perceivedContrast && (violation.foregroundHex || violation.backgroundHex || violation.contrastRatio !== undefined || violation.contrastRange) && (
        <div className={cn('space-y-1', compact ? 'text-xs' : 'text-sm')}>
          {(violation.foregroundHex || violation.backgroundHex) && (
            <div className="text-muted-foreground">
              <span className="font-medium">Colors: </span>
              <span className="font-mono">{violation.foregroundHex || '—'}</span>
              <span className="text-muted-foreground"> on </span>
              <span className="font-mono">{violation.backgroundHex || '—'}</span>
            </div>
          )}
          <div className="text-muted-foreground">
            <span className="font-medium">Contrast: </span>
            {violation.contrastRange ? (
              <span className="font-mono">
                {violation.contrastRange.min}:1 – {violation.contrastRange.max}:1
                <span className="text-xs ml-1">(range)</span>
              </span>
            ) : violation.contrastRatio !== undefined ? (
              <span className="font-mono">{violation.contrastRatio}:1</span>
            ) : (
              <span>ratio not computed (unreliable sampling)</span>
            )}
          </div>
          {violation.samplingFallback && (
            <div className="text-muted-foreground">
              <span className="font-medium">Method: </span>
              <span>{violation.samplingFallback.method}</span>
              {violation.samplingFallback.rangeSpansThreshold && (
                <span className="text-warning ml-1">(spans threshold)</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* A1 Perceptual assessment (screenshot LLM-assisted mode) */}
      {violation.ruleId === 'A1' && violation.perceivedContrast && (
        <div className={cn('space-y-1', compact ? 'text-xs' : 'text-sm')}>
          <div className="text-muted-foreground">
            <span className="font-medium">Perceived Contrast: </span>
            <span className={cn(
              'font-medium',
              violation.perceivedContrast === 'low' ? 'text-warning' : 'text-foreground'
            )}>
              {violation.perceivedContrast === 'low' ? 'Low (perceptual)' : violation.perceivedContrast}
            </span>
          </div>
          {violation.perceptualRationale && (
            <div className="text-muted-foreground">
              <span className="font-medium">Rationale: </span>
              <span className="text-foreground">{violation.perceptualRationale}</span>
            </div>
          )}
          {violation.suggestedFix && (
            <div className="text-muted-foreground">
              <span className="font-medium">Suggestion: </span>
              <span className="text-foreground">{violation.suggestedFix}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PotentialRisksSectionProps {
  violations: Violation[];
  advisoryGuidance?: string;
  compact?: boolean;
}

/**
 * Standardized section for displaying Potential Risks.
 * Status belongs to the section, not the individual items.
 */
export function PotentialRisksSection({ violations, advisoryGuidance, compact = false }: PotentialRisksSectionProps) {
  const potentialViolations = violations.filter(v => v.status === 'potential');
  
  if (potentialViolations.length === 0) return null;
  
  // Get advisory guidance from first violation that has it, or use default
  const guidance = advisoryGuidance || 
    potentialViolations.find(v => v.advisoryGuidance)?.advisoryGuidance ||
    'Upload screenshots of the rendered UI for higher-confidence verification.';
  
  return (
    <div className="space-y-3">
      {/* Individual risk items */}
      {potentialViolations.map((violation, idx) => (
        <PotentialRiskItem key={idx} violation={violation} compact={compact} />
      ))}
      
      {/* Single advisory guidance block at the end */}
      <div className={cn(
        'rounded-lg bg-muted/30 border border-border',
        compact ? 'p-3 space-y-1' : 'p-4 space-y-2'
      )}>
        <p className={cn('font-medium text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          💡 Advisory Guidance
        </p>
        <p className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          {guidance}
        </p>
      </div>
    </div>
  );
}
