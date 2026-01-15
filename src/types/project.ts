export type ToolType = 'bolt' | 'replit' | 'lovable';

export type InputType = 'screenshots' | 'zip' | 'github';

export interface Project {
  id: string;
  name: string;
  toolUsed: ToolType;
  threshold: number;
  createdAt: Date;
  iterations: Iteration[];
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
  contrastRatio?: number;
  thresholdUsed?: 4.5 | 3.0;
  foregroundHex?: string;
  backgroundHex?: string;
  elementDescription?: string;
  evidence?: string;
}
