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
  status?: 'confirmed' | 'potential' | 'informational'; // confirmed (blocking), potential (non-blocking), informational (no risk, summary only)
  potentialSubtype?: 'accuracy' | 'borderline'; // Only when status='potential': accuracy = measurement uncertainty, borderline = below recommended but above minimum
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
  
  // ============================================================
  // A1 AGGREGATED ELEMENT REPORTING (v22)
  // ============================================================
  // When isA1Aggregated = true, this violation represents an aggregated
  // A1 report with multiple element sub-items stored in a1Elements.
  // At most two A1 violations per iteration: one for confirmed, one for potential.
  isA1Aggregated?: boolean;
  a1Elements?: A1ElementSubItem[];
  // "near-threshold" tag for elements within small margin of threshold
  nearThreshold?: boolean;
  
  // ============================================================
  // A2 AGGREGATED ELEMENT REPORTING (Focus Visibility)
  // ============================================================
  // When isA2Aggregated = true, this violation represents an aggregated
  // A2 report with multiple element sub-items stored in a2Elements.
  isA2Aggregated?: boolean;
  a2Elements?: A2ElementSubItem[];
  
  // ============================================================
  // A3 AGGREGATED ELEMENT REPORTING (Keyboard Operability)
  // ============================================================
  // When isA3Aggregated = true, this violation represents an aggregated
  // A3 report with multiple element sub-items stored in a3Elements.
  isA3Aggregated?: boolean;
  a3Elements?: A3ElementSubItem[];
}

// A1 Element sub-item for aggregated reporting

// A1 Element sub-item for aggregated reporting
export interface A1ElementSubItem {
  // Element identification
  elementLabel: string; // e.g., "Header subtitle", "Credits badge"
  textSnippet?: string; // Sample text if available
  location: string; // screen + bbox or component path
  uiRole?: string; // Semantic UI role: "metadata", "label", "badge", "navigation link", "heading", etc.
  patternGroup?: string; // UI pattern group: "course card metadata", "filter panel", "header section", etc.
  screenshotIndex?: number;
  bbox?: { x: number; y: number; w: number; h: number };
  
  // Foreground color data
  foregroundHex?: string;
  foregroundConfidence?: number;
  
  // Background data
  backgroundStatus: 'certain' | 'uncertain' | 'unmeasurable';
  backgroundHex?: string; // Single dominant if certain
  backgroundCandidates?: Array<{ hex: string; confidence: number }>; // List if uncertain
  
  // Contrast data
  contrastRatio?: number; // Single ratio if certain
  contrastRange?: { min: number; max: number }; // Min-max if uncertain
  contrastNotMeasurable?: boolean; // True if truly unmeasurable
  
  // WCAG threshold
  thresholdUsed: 4.5 | 3.0;
  
  // Classification explanation
  explanation: string; // Why this element is confirmed or potential
  reasonCodes?: A1ReasonCode[]; // Mandatory for potential
  
  // Element-specific corrective prompt (ONLY for confirmed violations)
  // Must be pattern-oriented: mentions text content, UI role, location, and suggests group-wide fix
  correctivePrompt?: string;
  
  // Optional "near-threshold" tag (within small margin of threshold, NOT for far-below values)
  nearThreshold?: boolean;
  
  // Deduplication key
  deduplicationKey: string; // screenId + bbox + textSnippet
}

// A2 Element sub-item for aggregated focus visibility reporting
export interface A2ElementSubItem {
  // Element identification — unique identity block
  elementLabel: string; // Best human-readable "source label" (e.g., "More options (kebab menu)")
  elementType?: string; // button, link, input, select, etc.
  role?: string; // ARIA role or HTML tag role (e.g., "button", "link", "menuitem")
  accessibleName?: string; // Computed accessible name (aria-label / button text). Empty string = "(no accessible name)"
  sourceLabel?: string; // Best human label (e.g., "3-dot menu", "Enroll Now")
  selectorHint?: string; // data-testid, id, class fragment, or component path + JSX snippet
  textSnippet?: string; // Visible text if available
  location: string; // file path (ZIP/GitHub) or "Screenshot #n — …"
  
  // Detection data
  detection?: string; // e.g., "Tailwind/CSS: focus:outline-none without replacement"
  focusClasses?: string[]; // Focus-related classes found
  
  // Classification
  classification: 'confirmed' | 'potential';
  potentialSubtype?: 'accuracy' | 'borderline'; // Only when classification='potential'
  
  // Explanation
  explanation: string; // Why this element is flagged
  confidence: number;
  
  // Corrective prompt (ONLY for confirmed violations)
  correctivePrompt?: string;
  
  // Deduplication key
  deduplicationKey: string;
}

// A3 Element sub-item for aggregated keyboard operability reporting
export interface A3ElementSubItem {
  // Element identification
  elementLabel: string; // Best human-readable label (e.g., "Add to cart", "Menu trigger")
  elementType?: string; // div, span, button, a, etc.
  role?: string; // ARIA role or HTML tag role
  accessibleName?: string; // Computed accessible name
  sourceLabel?: string; // Best human label
  selectorHint?: string; // data-testid, id, class fragment, or component path
  textSnippet?: string; // Visible text if available
  location: string; // file path (ZIP/GitHub) or "Screenshot" label
  
  // Detection data
  detection?: string; // e.g., "onClick without role/tabIndex"
  evidence?: string; // Specific code evidence
  
  // Classification
  classification: 'confirmed' | 'potential';
  classificationCode?: string; // A3-C1, A3-C2, A3-C3, A3-P1, A3-P2
  potentialSubtype?: 'accuracy' | 'borderline'; // Only when classification='potential'
  
  // Explanation
  explanation: string; // Why this element is flagged
  confidence: number;
  
  // Corrective prompt (ONLY for confirmed violations)
  correctivePrompt?: string;
  
  // Deduplication key
  deduplicationKey: string;
}

// A1 Reason codes explaining why a finding is classified as "potential"
export type A1ReasonCode = 
  | 'BG_MIXED'           // Multiple background colors detected
  | 'BG_GRADIENT'        // Gradient background
  | 'BG_IMAGE'           // Image or textured background
  | 'BG_OVERLAY'         // Transparency or overlay suspected
  | 'BG_TOO_SMALL_REGION'// Insufficient background pixels around text
  | 'FG_ANTIALIASING'    // Glyph sampling unstable due to anti-aliasing
  | 'FG_IMPLAUSIBLE'     // Foreground sampling inconsistent with visual prominence (v25.2)
  | 'FG_SAMPLING_UNRELIABLE' // Foreground color sampling unreliable after re-sampling (v25.3)
  | 'FG_BG_AMBIGUITY'    // Foreground/background roles ambiguous in enclosed component (badge/pill/chip)
  | 'LOW_CONFIDENCE'     // Combined confidence below threshold
  | 'STATIC_ANALYSIS';   // Colors inferred from code, not rendered pixels
