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
  elementRole?: string; // Semantic role: caption, badge, metadata, heading, etc.
  inputType?: 'screenshots' | 'zip' | 'github'; // Which input type was used for this finding
  contrastRatio?: number; // Computed contrast ratio (e.g., 2.8)
  thresholdUsed?: 4.5 | 3.0; // WCAG threshold applied
  foregroundRgb?: string; // Sampled median RGB (e.g., "rgb(156, 163, 175)")
  foregroundHex?: string; // Approximate hex derived from median RGB
  backgroundRgb?: string; // Sampled median RGB (e.g., "rgb(255, 255, 255)")
  backgroundHex?: string; // Approximate hex derived from median RGB
  elementDescription?: string;
  evidence?: string;
  riskLevel?: 'high' | 'medium' | 'low';
  potentialRiskReason?: string; // Why contrast couldn't be measured (for potential only)
  colorApproximate?: boolean; // True when colors are derived from screenshot pixel sampling
  colorAttributionUnreliable?: boolean; // True when recalculated contrast from hex differs from measured ratio by >±0.2
  // Location tracking for A1 findings
  inputLimitation?: string; // Explanation of why this is heuristic
  advisoryGuidance?: string; // Non-mandatory guidance for potential risks
  // A1 affected items for aggregated display
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
}
