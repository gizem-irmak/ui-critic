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
  status?: 'confirmed' | 'potential';
  inputType?: 'screenshots' | 'zip' | 'github'; // Which input type was used for this finding
  contrastRatio?: number;
  thresholdUsed?: 4.5 | 3.0;
  foregroundHex?: string;
  backgroundHex?: string;
  elementDescription?: string;
  evidence?: string;
  riskLevel?: 'high' | 'medium' | 'low';
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
    status?: 'confirmed' | 'potential';
    confidence?: number;
    rationale?: string;
    occurrence_count?: number;
    elementContext?: string;
  }>;
}
