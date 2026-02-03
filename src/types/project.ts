export type ToolType = 'bolt' | 'replit' | 'lovable';

export type InputType = 'screenshots' | 'zip' | 'github';

export interface Project {
  id: string;
  name: string;
  toolUsed: ToolType;
  threshold: number;
  createdAt: Date;
  iterations: Iteration[];
  // Immutable convergence tracking - set once, never modified
  convergedAtIteration: number | null; // The iteration index (1-based) when convergence was first reached
  convergedAt: Date | null; // Timestamp of first convergence
}

export interface Iteration {
  id: string;
  projectId: string;
  iterationNumber: number;
  inputType: InputType;
  inputData: ScreenshotInput | ZipInput | GithubInput;
  selectedCategories: string[];
  selectedRules: string[];
  analysis: Analysis | null;
  createdAt: Date;
}

export interface ScreenshotInput {
  type: 'screenshots';
  files: File[];
  previews: string[];
}

export interface ZipInput {
  type: 'zip';
  file: File;
  fileName: string;
}

export interface GithubInput {
  type: 'github';
  url: string;
}

export interface Analysis {
  id: string;
  iterationId: string;
  violations: Violation[];
  totalViolations: number;
  confirmedViolations: number; // Only confirmed violations count toward convergence
  potentialRisks: number; // Heuristic issues that don't block convergence
  violationsByCategory: Record<string, number>;
  correctivePrompt: string;
  isAcceptable: boolean;
  analyzedAt: Date;
  passNotes?: {
    accessibility?: string;
    usability?: string;
    ethics?: string;
  };
}

export interface Violation {
  ruleId: string;
  ruleName: string;
  category: string;
  diagnosis: string;
  correctivePrompt: string;
  contextualHint?: string;
  confidence: number;
  // A1 contrast-specific fields
  status?: 'confirmed' | 'borderline' | 'potential';
  samplingMethod?: 'pixel' | 'inferred'; // How colors were obtained: pixel-sampled or inferred from tokens/classes
  elementRole?: string; // Semantic role: caption, badge, metadata, heading, etc.
  inputType?: 'screenshots' | 'zip' | 'github'; // Which input type was used for this finding
  contrastRatio?: number; // Computed contrast ratio (e.g., 2.8) — only when samplingMethod = "pixel"
  contrastRange?: { min: number; max: number }; // Range-based contrast for mixed backgrounds
  thresholdUsed?: 4.5 | 3.0; // WCAG threshold applied
  foregroundRgb?: string; // Sampled median RGB (e.g., "rgb(156, 163, 175)") — only when samplingMethod = "pixel"
  foregroundHex?: string; // Approximate hex derived from median RGB — only when samplingMethod = "pixel"
  foregroundConfidence?: number; // Confidence in foreground color extraction (0-1)
  backgroundRgb?: string; // Sampled median RGB (e.g., "rgb(255, 255, 255)") — only when samplingMethod = "pixel"
  backgroundHex?: string; // Approximate hex derived from median RGB — only when samplingMethod = "pixel"
  // Background candidates for uncertain backgrounds
  backgroundCandidates?: Array<{ hex: string; confidence: number }>;
  backgroundStatus?: 'certain' | 'uncertain' | 'unmeasurable';
  elementDescription?: string;
  elementIdentifier?: string; // Unique identifier: "Screenshot #1 — Header subtitle"
  textSnippet?: string; // Sample text if available
  evidence?: string;
  riskLevel?: 'high' | 'medium' | 'low';
  potentialRiskReason?: string; // Why contrast couldn't be measured (for potential only)
  // A1 Reason codes for potential findings (mandatory when status = potential)
  reasonCodes?: A1ReasonCode[];
  colorApproximate?: boolean; // True when colors are derived from screenshot pixel sampling
  colorAttributionUnreliable?: boolean; // True when recalculated contrast from hex differs from measured ratio by >±0.2
  // Location tracking for A1 findings
  inputLimitation?: string; // Explanation of why this is heuristic
  advisoryGuidance?: string; // Non-mandatory guidance for potential risks
  actionableGuidance?: string; // Short, actionable fix guidance
  // A1 sampling fallback tracking
  samplingFallback?: {
    method: string; // 'direct ring sampling', 'expanded region (+Xpx)', 'color clustering', 'range-based'
    expansionPx?: number;
    clusterCount?: number;
    rangeSpansThreshold?: boolean;
  };
  samplingReliability?: {
    pixelSupport?: string;
    foregroundVariance?: string;
    backgroundVariance?: string;
    colorDistance?: string;
    hexVerification?: string;
    multiSampleConsistency?: string;
    fallbackMethod?: string;
  };
  // A1 affected items for aggregated display (DEPRECATED - use individual violations)
  affected_items?: Array<{
    location?: string;
    screenshotIndex?: number;
    componentName?: string;
    filePath?: string;
    colorClass?: string;
    hexColor?: string;
    riskLevel?: 'high' | 'medium' | 'low';
    status?: 'confirmed' | 'borderline' | 'potential';
    confidence?: number;
    rationale?: string;
    occurrence_count?: number;
    elementContext?: string;
    contrastRatio?: number;
    thresholdUsed?: number;
    foregroundHex?: string;
    backgroundHex?: string;
    elementDescription?: string;
    potentialRiskReason?: string;
  }>;
  // Background certainty assessment (screenshot analysis only)
  backgroundCertainty?: {
    isCertain: boolean;
    reason?: string;
  };
  // Convergence constraint: Whether this finding blocks project convergence
  // Per authoritative A1 rule:
  //   - Confirmed violations: block convergence (true)
  //   - Heuristic/potential findings: never block convergence (false)
  blocksConvergence?: boolean;
}

// A1 Reason codes explaining why a finding is classified as "potential"
export type A1ReasonCode = 
  | 'BG_MIXED'           // Multiple background colors detected
  | 'BG_GRADIENT'        // Gradient background
  | 'BG_IMAGE'           // Image or textured background
  | 'BG_OVERLAY'         // Transparency or overlay suspected
  | 'BG_TOO_SMALL_REGION'// Insufficient background pixels around text
  | 'FG_ANTIALIASING'    // Glyph sampling unstable due to anti-aliasing
  | 'LOW_CONFIDENCE'     // Combined confidence below threshold
  | 'STATIC_ANALYSIS';   // Colors inferred from code, not rendered pixels
