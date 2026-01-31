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
    // Remove static analysis mentions (redundant with input type badge)
    .replace(/Detected via static analysis\.?\s*/gi, '')
    .replace(/based on static analysis\.?\s*/gi, '')
    .replace(/via static code analysis\.?\s*/gi, '')
    // Remove location mentions that will be shown in structured Location row
    .replace(/in (the )?following (components?|files?|locations?):?\s*/gi, '')
    .replace(/Found in:?\s*/gi, '')
    .replace(/Detected in:?\s*/gi, '')
    .replace(/Occurs in:?\s*/gi, '')
    // Clean up artifacts
    .replace(/\s+/g, ' ')
    .replace(/^\s*[,.:]\s*/, '')
    .trim();
}

/**
 * Extracts unique locations from violation data for structured display.
 */
function extractLocations(violation: Violation): string[] {
  const locations = new Set<string>();
  
  // From affected_items array
  if (violation.affected_items && violation.affected_items.length > 0) {
    for (const item of violation.affected_items) {
      const parts: string[] = [];
      if (item.componentName) parts.push(item.componentName);
      if (item.filePath && !parts.some(p => p.includes(item.filePath!))) {
        parts.push(`(${item.filePath})`);
      }
      if (parts.length > 0) {
        locations.add(parts.join(' '));
      } else if (item.location) {
        locations.add(item.location);
      }
    }
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
          <span className={cn('font-medium', compact ? 'text-sm' : '')}>{violation.ruleName}</span>
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
