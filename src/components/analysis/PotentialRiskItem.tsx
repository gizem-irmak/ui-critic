import { MapPin, Lightbulb } from 'lucide-react';
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

const inputTypeLabels: Record<string, string> = {
  screenshots: 'Screenshot',
  zip: 'ZIP',
  github: 'GitHub',
};

/**
 * Aggressively cleans diagnosis text by removing ALL redundant patterns.
 * Status, convergence logic, and policy restatements belong to the section, not the item.
 */
function cleanDiagnosisText(diagnosis?: string): string {
  if (!diagnosis) return '';
  
  return diagnosis
    // Remove all heuristic/status language
    .replace(/\(?[Hh]euristic\)?/g, '')
    .replace(/['"]?[Pp]otential [Rr]isk['"]?/g, '')
    .replace(/This finding is labeled as.*?\./gi, '')
    .replace(/This is reported as a potential risk.*?\./gi, '')
    .replace(/reported as a potential risk/gi, '')
    // Remove all convergence/blocking language
    .replace(/does not block convergence/gi, '')
    .replace(/This finding does not block convergence\.?/gi, '')
    .replace(/non-blocking/gi, '')
    // Remove "cannot be confirmed" warning-style sentences
    .replace(/cannot be confirmed.*?\./gi, '')
    .replace(/could not be confirmed.*?\./gi, '')
    .replace(/cannot be verified.*?\./gi, '')
    // Remove static analysis limitation restatements (keep only in Limitation Statement)
    .replace(/Detected via static analysis\.?\s*/gi, '')
    .replace(/based on static analysis\.?\s*/gi, '')
    .replace(/via static code analysis\.?\s*/gi, '')
    .replace(/through static analysis\.?\s*/gi, '')
    .replace(/static analysis (cannot|does not|is unable to).*?\./gi, '')
    // Remove location mentions (shown in structured Location row)
    .replace(/in (the )?following (components?|files?|locations?):?\s*/gi, '')
    .replace(/Found in:?\s*/gi, '')
    .replace(/Detected in:?\s*/gi, '')
    .replace(/Occurs in:?\s*/gi, '')
    .replace(/across \d+ (components?|files?|locations?)\.?\s*/gi, '')
    // Remove advisory guidance mixed into diagnosis (shown separately)
    .replace(/Upload screenshots.*?\./gi, '')
    .replace(/For higher-confidence.*?\./gi, '')
    // Remove threshold/policy language
    .replace(/threshold/gi, '')
    .replace(/WCAG AA requires.*?\./gi, '')
    // Clean up artifacts
    .replace(/\(\s*\)/g, '') // Empty parentheses
    .replace(/\s{2,}/g, ' ') // Multiple spaces
    .replace(/^\s*[,.:;]\s*/, '') // Leading punctuation
    .replace(/\s*[,.:;]\s*$/, '') // Trailing punctuation before period
    .replace(/\.\s*\./g, '.') // Double periods
    .trim();
}

/**
 * Extracts unique locations from violation data for structured display.
 * Returns array of formatted location strings.
 */
function extractLocations(violation: Violation): string[] {
  const locations = new Set<string>();
  
  if (violation.affected_items && violation.affected_items.length > 0) {
    for (const item of violation.affected_items) {
      if (item.componentName && item.filePath) {
        locations.add(`${item.componentName} (${item.filePath})`);
      } else if (item.componentName) {
        locations.add(item.componentName);
      } else if (item.filePath) {
        locations.add(item.filePath);
      } else if (item.location) {
        locations.add(item.location);
      }
    }
  }
  
  return Array.from(locations);
}

/**
 * Counts occurrences by risk level for summary display.
 */
function countByRiskLevel(violation: Violation): { high: number; medium: number; low: number; total: number } {
  const counts = { high: 0, medium: 0, low: 0, total: 0 };
  
  if (violation.affected_items) {
    for (const item of violation.affected_items) {
      counts.total++;
      if (item.riskLevel === 'high') counts.high++;
      else if (item.riskLevel === 'medium') counts.medium++;
      else counts.low++;
    }
  }
  
  return counts;
}

/**
 * Generates a detection summary based on rule type and findings.
 */
function getDetectionSummary(violation: Violation): string {
  const ruleId = violation.ruleId?.toUpperCase();
  
  // A1: Contrast-specific summary
  if (ruleId === 'A1') {
    const colorTokens = violation.affected_items
      ?.filter(item => item.colorClass)
      .map(item => item.colorClass)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 3);
    
    if (colorTokens && colorTokens.length > 0) {
      return `Potential WCAG AA contrast risk identified. Low-contrast text color tokens (${colorTokens.join(', ')}) were detected.`;
    }
    return 'Potential WCAG AA contrast risk identified. Low-contrast text color tokens were detected in the codebase.';
  }
  
  // A2: Touch targets
  if (ruleId === 'A2') {
    return 'Potential touch target sizing issue identified. Interactive elements may not meet minimum size requirements.';
  }
  
  // A3: Alt text
  if (ruleId === 'A3') {
    return 'Potential alt text issue identified. Images may lack descriptive alternative text for screen readers.';
  }
  
  // A4: Form labels
  if (ruleId === 'A4') {
    return 'Potential form labeling issue identified. Form inputs may lack programmatic label associations.';
  }
  
  // A5: Focus visibility
  if (ruleId === 'A5') {
    return 'Potential focus visibility issue identified. Interactive elements may lack visible focus indicators.';
  }
  
  // Default: use cleaned diagnosis or generic summary
  const cleaned = cleanDiagnosisText(violation.diagnosis);
  if (cleaned && cleaned.length > 10) {
    return cleaned;
  }
  
  return `Potential ${violation.category} issue identified through analysis.`;
}

/**
 * Gets the limitation statement based on input type and rule.
 */
function getLimitationStatement(violation: Violation): string {
  const inputType = violation.inputType || 'static';
  const ruleId = violation.ruleId?.toUpperCase();
  
  if (ruleId === 'A1') {
    if (inputType === 'zip' || inputType === 'github') {
      return 'Final contrast ratios depend on rendered background colors, which are not available through static analysis.';
    }
  }
  
  if (inputType === 'zip' || inputType === 'github') {
    return 'Runtime behavior cannot be verified through static code analysis.';
  }
  
  return 'Full verification requires runtime context.';
}

export function PotentialRiskItem({ violation, compact = false }: PotentialRiskItemProps) {
  const locations = extractLocations(violation);
  const riskCounts = countByRiskLevel(violation);
  const detectionSummary = getDetectionSummary(violation);
  const limitationStatement = getLimitationStatement(violation);
  const maxLocations = compact ? 3 : 5;
  
  return (
    <div className={cn(
      'rounded-lg bg-warning/5 border border-warning/20',
      compact ? 'p-3 space-y-2' : 'p-4 space-y-3'
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
      
      {/* 1️⃣ Detection Summary */}
      <p className={cn(
        'text-foreground leading-relaxed',
        compact ? 'text-sm' : 'text-sm'
      )}>
        {detectionSummary}
      </p>
      
      {/* 2️⃣ Scope & Locations */}
      {locations.length > 0 && (
        <div className={cn(
          'flex items-start gap-2 text-muted-foreground bg-muted/30 rounded-md',
          compact ? 'text-xs p-2' : 'text-sm p-2.5'
        )}>
          <MapPin className={cn('flex-shrink-0 mt-0.5', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
          <div className="space-y-0.5">
            <div>
              <span className="font-medium">Locations: </span>
              <span>
                {locations.slice(0, maxLocations).join(', ')}
                {locations.length > maxLocations && (
                  <span className="italic"> +{locations.length - maxLocations} more</span>
                )}
              </span>
            </div>
            {riskCounts.total > 1 && (
              <div className="text-muted-foreground/80">
                {riskCounts.total} occurrences
                {riskCounts.high > 0 && ` (${riskCounts.high} high-risk`}
                {riskCounts.medium > 0 && `${riskCounts.high > 0 ? ', ' : ' ('}${riskCounts.medium} medium-risk`}
                {riskCounts.low > 0 && `${riskCounts.high > 0 || riskCounts.medium > 0 ? ', ' : ' ('}${riskCounts.low} low-risk`}
                {(riskCounts.high > 0 || riskCounts.medium > 0 || riskCounts.low > 0) && ')'}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* 3️⃣ Limitation Statement */}
      <p className={cn(
        'text-muted-foreground italic',
        compact ? 'text-xs' : 'text-sm'
      )}>
        {limitationStatement}
      </p>
    </div>
  );
}

interface PotentialRisksSectionProps {
  violations: Violation[];
  compact?: boolean;
}

/**
 * Standardized section for displaying Potential Risks.
 * Status belongs to the section header, not individual items.
 */
export function PotentialRisksSection({ violations, compact = false }: PotentialRisksSectionProps) {
  const potentialViolations = violations.filter(v => v.status === 'potential');
  
  if (potentialViolations.length === 0) return null;
  
  // Determine advisory guidance based on input types present
  const hasStaticInput = potentialViolations.some(v => 
    v.inputType === 'zip' || v.inputType === 'github'
  );
  
  const advisoryGuidance = hasStaticInput
    ? 'For higher-confidence verification, upload screenshots of the rendered UI.'
    : 'Review highlighted areas in the rendered application to verify these findings.';
  
  return (
    <div className="space-y-3">
      {potentialViolations.map((violation, idx) => (
        <PotentialRiskItem key={idx} violation={violation} compact={compact} />
      ))}
      
      {/* 💡 Advisory Guidance (single block at end) */}
      <div className={cn(
        'flex items-start gap-2 rounded-lg bg-muted/30 border border-border',
        compact ? 'p-3' : 'p-4'
      )}>
        <Lightbulb className={cn(
          'flex-shrink-0 text-muted-foreground',
          compact ? 'h-3.5 w-3.5 mt-0.5' : 'h-4 w-4 mt-0.5'
        )} />
        <div>
          <p className={cn('font-medium text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
            Advisory Guidance
          </p>
          <p className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
            {advisoryGuidance}
          </p>
        </div>
      </div>
    </div>
  );
}
