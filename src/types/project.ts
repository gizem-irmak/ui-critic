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
  blocksConvergence?: boolean;
  
  // ============================================================
  // A1 EPISTEMIC SOURCE TRACKING (Tailwind-Token Contrast)
  // ============================================================
  fgSource?: 'tailwind_token';
  bgSource?: 'tailwind_token' | 'assumed_default' | 'unresolved';
  evidenceLevel?: 'structural_deterministic' | 'structural_estimated';
  sizeStatus?: 'normal' | 'large' | 'unknown';
  
  // ============================================================
  // PERCEPTUAL CONTRAST ASSESSMENT (Screenshot LLM-Assisted A1)
  // ============================================================
  // Used when inputType = 'screenshots' for A1. No numeric ratio.
  perceivedContrast?: 'low' | 'adequate' | 'high';
  perceptualRationale?: string; // 1-2 sentence explanation
  suggestedFix?: string; // 1 sentence corrective guidance
  
  // ============================================================
  // EVALUATION METHOD (Two-Layer Hybrid Architecture)
  // ============================================================
  // Indicates which engine produced this finding:
  //   - 'deterministic' → regex/AST static analysis (high reproducibility)
  //   - 'llm_assisted' → AI vision or LLM code analysis (perceptual/contextual)
  //   - 'hybrid_deterministic' → HYBRID rule, finding came from deterministic signals
  //   - 'hybrid_llm_fallback' → HYBRID rule, finding came from LLM fallback
  evaluationMethod?: 'deterministic' | 'llm_assisted' | 'hybrid_deterministic' | 'hybrid_llm_fallback';
  
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
  
  // ============================================================
  // A4 AGGREGATED ELEMENT REPORTING (Semantic Structure)
  // ============================================================
  isA4Aggregated?: boolean;
  a4Elements?: A4ElementSubItem[];
  
  // ============================================================
  // A5 AGGREGATED ELEMENT REPORTING (Missing Form Labels)
  // ============================================================
  isA5Aggregated?: boolean;
  a5Elements?: A5ElementSubItem[];
  
  // ============================================================
  // A6 AGGREGATED ELEMENT REPORTING (Missing Accessible Names)
  // ============================================================
  isA6Aggregated?: boolean;
  a6Elements?: A6ElementSubItem[];
  
  // ============================================================
  // U1 AGGREGATED ELEMENT REPORTING (Primary Action)
  // ============================================================
  isU1Aggregated?: boolean;
  u1Elements?: U1ElementSubItem[];
  
  // ============================================================
  // U2 AGGREGATED ELEMENT REPORTING (Navigation)
  // ============================================================
  isU2Aggregated?: boolean;
  u2Elements?: U2ElementSubItem[];
  
  // ============================================================
  // U3 AGGREGATED ELEMENT REPORTING (Content Accessibility)
  // ============================================================
  isU3Aggregated?: boolean;
  u3Elements?: U3ElementSubItem[];
  
  // ============================================================
  // U4 AGGREGATED ELEMENT REPORTING (Recognition-to-Recall)
  // ============================================================
  isU4Aggregated?: boolean;
  u4Elements?: U4ElementSubItem[];
  
  // ============================================================
  // U5 AGGREGATED ELEMENT REPORTING (Insufficient Interaction Feedback)
  // ============================================================
  isU5Aggregated?: boolean;
  u5Elements?: U5ElementSubItem[];
  
  // ============================================================
  // U6 AGGREGATED ELEMENT REPORTING (Weak Grouping / Layout Coherence)
  // ============================================================
  isU6Aggregated?: boolean;
  u6Elements?: U6ElementSubItem[];
  
  // ============================================================
  // E1 AGGREGATED ELEMENT REPORTING (Insufficient Transparency)
  // ============================================================
  isE1Aggregated?: boolean;
  e1Elements?: E1ElementSubItem[];
  
  // ============================================================
  // E2 AGGREGATED ELEMENT REPORTING (Choice Architecture)
  // ============================================================
  isE2Aggregated?: boolean;
  e2Elements?: E2ElementSubItem[];
  
  // ============================================================
  // E3 AGGREGATED ELEMENT REPORTING (Obscured/Restricted User Control)
  // ============================================================
  isE3Aggregated?: boolean;
  e3Elements?: E3ElementSubItem[];
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
  reasonCodes?: A1ReasonCode[]; // Mandatory for potential (structural)
  
  // Perceptual contrast assessment (screenshot LLM-assisted A1 only)
  perceivedContrast?: 'low' | 'adequate' | 'high';
  perceptualRationale?: string;
  suggestedFix?: string;
  
  // Content type classification (screenshot A1)
  contentType?: 'text' | 'icon'; // "icon" findings are filtered out
  
  // Text size classification (screenshot A1 perceptual)
  // Also used by structural mode (textType/appliedThreshold/wcagCriterion above)
  screenshotTextSize?: 'normal' | 'large' | 'unknown';
  
  // Element-specific corrective prompt (ONLY for confirmed violations)
  // Must be pattern-oriented: mentions text content, UI role, location, and suggests group-wide fix
  correctivePrompt?: string;
  
  // Optional "near-threshold" tag (within small margin of threshold, NOT for far-below values)
  nearThreshold?: boolean;
  
  // JSX tag name for structural findings (e.g., "p", "span", "div")
  jsxTag?: string;
  
  // WCAG 1.4.3 text classification
  textType?: 'normal' | 'large'; // Normal (4.5:1) or large text (3:1)
  appliedThreshold?: 4.5 | 3.0; // Threshold used for this element
  wcagCriterion?: '1.4.3'; // Always 1.4.3 for A1
  
  // Two-stage hybrid method label (screenshot A1)
  a1Method?: 'LLM→Pixel' | 'LLM-only (measurement failed)';
  
  // Variant/state tracking (structural A1)
  variant?: string; // 'hover', 'focus', 'active', 'dark' — undefined = base state
  lineNumber?: number; // approximate source line number
  
  // Deduplication key
  deduplicationKey: string; // screenId + bbox + textSnippet
}

// A2 Element sub-item for aggregated focus visibility reporting
export interface A2ElementSubItem {
  // Element identification — unique identity block
  elementLabel: string; // Best human-readable "source label" (e.g., "More options (kebab menu)")
  elementType?: string; // button, link, input, select, etc.
  elementTag?: string; // actual HTML tag: input, div, button, a, etc.
  elementName?: string; // Human-readable element name (e.g., "SelectItem", "CommandPrimitive.Item")
  elementSource?: 'jsx_tag' | 'wrapper_component' | 'html_tag_fallback' | 'unknown'; // How elementName was resolved
  role?: string; // ARIA role or HTML tag role (e.g., "button", "link", "menuitem")
  accessibleName?: string; // Computed accessible name (aria-label / button text). Empty string = "(no accessible name)"
  sourceLabel?: string; // Best human label (e.g., "3-dot menu", "Enroll Now")
  selectorHint?: string; // data-testid, id, class fragment, or component path + JSX snippet
  selectorHints?: string[]; // e.g., ['id="email"', 'role="menuitem"']
  textSnippet?: string; // Visible text if available
  location: string; // file path (ZIP/GitHub) or "Screenshot #n — …"
  lineRange?: string; // e.g., "42–47"
  
  // Focusable status
  focusable?: 'yes' | 'no' | 'unknown';
  
  // Detection data
  detection?: string; // e.g., "Tailwind/CSS: focus:outline-none without replacement"
  detectionMethod?: 'deterministic' | 'llm_assisted'; // How the finding was detected
  focusClasses?: string[]; // Focus-related classes found
  
  // Classification
  classification: 'confirmed' | 'potential';
  potentialSubtype?: 'accuracy' | 'borderline'; // Only when classification='potential'
  potentialReason?: string; // Why this is potential (e.g., "Focus visibility cannot be verified from static screenshot")
  
  // Explanation
  explanation: string; // Why this element is flagged
  confidence: number;
  
  // Corrective prompt (ONLY for confirmed violations)
  correctivePrompt?: string;
  
  // Deduplication key
  deduplicationKey: string;
  
  // Grouping metadata (pattern-signature grouping)
  occurrences?: number; // How many raw findings this group represents
  affectedComponents?: string[]; // Component names sharing this pattern
  
  // Source location
  startLine?: number | null;
  endLine?: number | null;
  filePath?: string; // Canonical file path for sorting
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

// A4 Element sub-item for aggregated semantic structure reporting
export interface A4ElementSubItem {
  // Element identification
  elementLabel: string; // Best human-readable label (e.g., "Clickable div container", "Missing <h1>")
  elementType?: string; // div, span, nav, section, etc.
  role?: string; // ARIA role or HTML tag role
  accessibleName?: string; // Computed accessible name
  sourceLabel?: string; // Best human label
  selectorHint?: string; // data-testid, id, class fragment, or component path
  textSnippet?: string; // Visible text if available
  location: string; // file path (ZIP/GitHub) or "Screenshot" label
  
  // Detection data
  detection?: string; // e.g., "Clickable div without role/semantics"
  evidence?: string; // Specific code evidence
  subCheck: 'A4.1' | 'A4.2' | 'A4.3' | 'A4.4'; // Which sub-check triggered
  subCheckLabel: string; // "Heading semantics", "Interactive elements", "Landmark regions", "Lists"
  
  // Classification
  classification: 'confirmed' | 'potential';
  potentialSubtype?: 'accuracy' | 'borderline';
  
  // Explanation
  explanation: string; // Why this element is flagged
  confidence: number;
  
  // Corrective prompt (ONLY for confirmed violations)
  correctivePrompt?: string;
  
  // Deduplication key
  deduplicationKey: string;
  
  // Line numbers for precise file reference
  startLine?: number | null;
  endLine?: number | null;
}

// A5 Element sub-item for aggregated form label reporting
export interface A5ElementSubItem {
  elementKey: string; // Stable identity: hash of tag + id + name + type + filePath + lineNumber
  elementLabel: string;
  elementType?: string; // input, select, textarea, etc.
  elementName?: string; // React component name: Input, SelectTrigger, Switch, etc.
  controlType?: string; // Implied native type: input, select, checkbox, slider, etc.
  inputSubtype?: string; // text, email, password, etc.
  role?: string;
  accessibleName?: string;
  sourceLabel?: string;
  selectorHint?: string;
  selectorHints?: string[]; // e.g., ['id="email"', 'name="email"', 'aria-label="Search"']
  controlId?: string; // The actual id prop if present
  labelingMethod?: string; // What labeling was found/missing: 'aria-label', 'FormLabel/FormControl (shadcn)', 'none', etc.
  textSnippet?: string;
  location: string;
  filePath?: string;
  
  detection?: string;
  evidence?: string;
  subCheck: 'A5.1' | 'A5.2' | 'A5.3' | 'A5.4' | 'A5.5' | 'A5.6';
  subCheckLabel: string;
  
  classification: 'confirmed' | 'potential';
  potentialSubtype?: 'accuracy' | 'borderline';
  
  explanation: string;
  confidence?: number; // Only for potential findings — confirmed items must NOT include confidence
  wcagCriteria: string[]; // e.g., ["1.3.1", "3.3.2"] or ["1.3.1", "3.3.2", "4.1.2"]
  
  correctivePrompt?: string;
  deduplicationKey: string;
  // Line numbers for precise file reference
  startLine?: number | null;
  endLine?: number | null;
}

// A6 Element sub-item for aggregated accessible name reporting
export interface A6ElementSubItem {
  elementLabel: string;
  elementType?: string; // button, a, div, etc.
  role?: string; // ARIA role or HTML tag role
  accessibleName?: string;
  sourceLabel?: string;
  selectorHint?: string;
  textSnippet?: string;
  location: string; // file path or "Screenshot" label
  filePath?: string; // Original file path for deduplication context
  
  detection?: string;
  evidence?: string;
  subCheck: 'A6.1' | 'A6.2';
  subCheckLabel: string;
  wcagCriteria: string[]; // Always ["4.1.2"]
  
  classification: 'confirmed'; // A6 is always confirmed — no potential classification
  
  explanation: string;
  // No confidence field — A6 findings are deterministic and always confirmed
  
  correctivePrompt?: string;
  deduplicationKey: string;
}

// U1 Element sub-item for aggregated primary action reporting
export interface U1ElementSubItem {
  elementLabel: string;
  elementType?: string; // form, button, button group, etc.
  location: string;
  detection?: string;
  evidence?: string;
  subCheck: 'U1.1' | 'U1.2' | 'U1.3' | 'U1.S1';
  subCheckLabel: string;
  classification: 'confirmed' | 'potential';
  explanation: string;
  confidence: number;
  advisoryGuidance?: string;
  deduplicationKey: string;
}

// U2 Element sub-item for aggregated navigation reporting
export interface U2ElementSubItem {
  elementLabel: string;
  elementType?: string;
  location: string;
  detection?: string;
  evidence?: string;
  subCheck: 'U2.D1' | 'U2.D2' | 'U2.D3' | 'U2.S1';
  subCheckLabel: string;
  confidence: number;
  advisoryGuidance?: string;
  deduplicationKey: string;
}

// U3 Element sub-item for aggregated content accessibility reporting
export interface U3ElementSubItem {
  elementLabel: string;
  elementType?: string;
  location: string;
  detection?: string;
  evidence?: string;
  textPreview?: string; // First 80-120 chars of truncated content, or "(dynamic text: varName)" for expressions
  subCheck: 'U3.D1' | 'U3.D2' | 'U3.D3' | 'U3.D4';
  subCheckLabel: string;
  confidence: number;
  advisoryGuidance?: string;
  deduplicationKey: string;
  // Element metadata
  truncationType?: string; // truncate, line-clamp, hidden, overflow-clip, nowrap, scroll-trap
  textLength?: number | 'dynamic'; // static char count or 'dynamic'
  triggerReason?: string; // why NOT suppressed
  expandDetected?: boolean; // whether expand/tooltip/toggle was found nearby
  elementTag?: string; // HTML/JSX tag name
}

// U4 Element sub-item for aggregated recognition-to-recall reporting
export interface U4ElementSubItem {
  elementLabel: string;   // e.g., '"Category" text input', "Tabs component", "CheckoutWizard (4-step flow)"
  elementType?: string;   // input, tab, toggle, wizard, button, component
  location: string;       // file path
  detection?: string;     // Summary of what was detected
  evidence?: string;      // Specific evidence citations
  recommendedFix?: string; // Actionable fix suggestion
  confidence: number;     // Capped at 0.65
  subCheck?: 'U4.1' | 'U4.2' | 'U4.3' | 'U4.4'; // Which subtype triggered
  subCheckLabel?: string; // Human-readable subtype label
  status?: 'potential';   // ALWAYS potential — U4 never confirms
  evaluationMethod?: 'llm_assisted';
  mitigationSummary?: string; // Summary of mitigations checked
  deduplicationKey: string;
}

// U5 Element sub-item for aggregated interaction feedback reporting
export interface U5ElementSubItem {
  elementLabel: string;   // e.g., '"Save" button', 'Form submit', 'Toggle'
  elementType?: string;   // button, form, toggle, etc.
  location: string;       // file path
  detection?: string;     // Summary of what was detected
  evidence?: string;      // Specific evidence citations
  subCheck?: 'U5.D1' | 'U5.D2' | 'U5.D3'; // Which sub-check triggered (deterministic only)
  confidence: number;     // 0.60–0.85
  evaluationMethod?: 'deterministic_structural' | 'hybrid_llm_fallback' | 'vision_llm';
  deduplicationKey: string;
}

// U6 Element sub-item for aggregated layout coherence reporting
export interface U6ElementSubItem {
  elementLabel: string;   // e.g., "Main content area", "Form section", "Card grid"
  elementType?: string;   // section, div, form, page, etc.
  location: string;       // file path
  detection?: string;     // Summary of what was detected
  evidence?: string;      // Specific evidence citations from the bundle
  recommendedFix?: string; // Actionable fix suggestion
  confidence: number;     // 0.60–0.80
  evaluationMethod?: 'llm_only_code' | 'llm_perceptual';
  deduplicationKey: string;
}

// E1 Element sub-item for aggregated transparency reporting
export interface E1ElementSubItem {
  elementLabel: string;   // e.g., '"Delete Account" action', '"Subscribe" button'
  elementType?: string;   // button, link, form, etc.
  location: string;       // file path
  detection?: string;     // Summary of what was detected (missing disclosure)
  evidence?: string;      // Specific evidence citations
  recommendedFix?: string; // Actionable fix suggestion
  confidence: number;     // 0.60–0.80
  evaluationMethod?: 'llm_only_code' | 'llm_perceptual';
  deduplicationKey: string;
}

// E2 Element sub-item for aggregated choice architecture reporting
export interface E2ElementSubItem {
  elementLabel: string;   // e.g., "Upgrade dialog choices", "Cookie consent options"
  elementType?: string;   // button group, dialog, modal, etc.
  location: string;       // file path
  detection?: string;     // Summary of imbalance detected
  evidence?: string;      // Specific evidence citations (style tokens, sizing, wording)
  recommendedFix?: string; // Actionable fix suggestion
  confidence: number;     // 0.60–0.80
  evaluationMethod?: 'llm_only_code' | 'llm_perceptual';
  deduplicationKey: string;
}

// E3 Element sub-item for aggregated user control reporting
export interface E3ElementSubItem {
  elementLabel: string;   // e.g., "Dialog component", "Subscription form"
  elementType?: string;   // dialog, form, checkbox, stepper, etc.
  location: string;       // file path
  subCheck?: 'E3.D1' | 'E3.D2' | 'E3.D3' | 'E3.D4'; // Which sub-check triggered
  detection?: string;     // Summary of restriction detected
  evidence?: string;      // Specific evidence citations
  recommendedFix?: string; // Actionable fix suggestion
  confidence: number;     // 0.60–0.85
  evaluationMethod?: 'deterministic_structural' | 'hybrid_structural_llm' | 'llm_perceptual';
  deduplicationKey: string;
}

// A1 Reason codes explaining why a finding is classified as "potential"
export type A1ReasonCode = 
  | 'BG_MIXED'           // Multiple background colors detected
  | 'BG_GRADIENT'        // Gradient background
  | 'BG_IMAGE'           // Image or textured background
  | 'BG_OVERLAY'         // Transparency or overlay suspected
  | 'BG_TOO_SMALL_REGION'// Insufficient background pixels around text
  | 'BG_ASSUMED_DEFAULT' // No bg-* token found; assumed #FFFFFF
  | 'BG_UNRESOLVED'      // Background could not be resolved at all
  | 'SIZE_UNKNOWN'       // Text size could not be determined; using 4.5:1
  | 'FG_ANTIALIASING'    // Glyph sampling unstable due to anti-aliasing
  | 'FG_IMPLAUSIBLE'     // Foreground sampling inconsistent with visual prominence (v25.2)
  | 'FG_SAMPLING_UNRELIABLE' // Foreground color sampling unreliable after re-sampling (v25.3)
  | 'FG_BG_AMBIGUITY'    // Foreground/background roles ambiguous in enclosed component (badge/pill/chip)
  | 'LOW_CONFIDENCE'     // Combined confidence below threshold
  | 'STATIC_ANALYSIS';   // Colors inferred from code, not rendered pixels

// A1 epistemic source tracking for Tailwind-token contrast computation
export type A1FgSource = 'tailwind_token';
export type A1BgSource = 'tailwind_token' | 'assumed_default' | 'unresolved';
export type A1EvidenceLevel = 'structural_deterministic' | 'structural_estimated';
export type A1SizeStatus = 'normal' | 'large' | 'unknown';
