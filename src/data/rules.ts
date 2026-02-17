// ============================================================
// RULE REGISTRY — Two-Layer Hybrid Architecture
// ============================================================
// Each rule declares its evaluation method and modality support.
// The edge function router uses this to decide which engine(s) run.
// ============================================================

export type EvaluationMethod = 'DETERMINISTIC' | 'LLM_ASSISTED' | 'HYBRID';

export type ModalitySupport = 'supported' | 'not_supported' | 'limited';

export interface ModalityConfig {
  zip: ModalitySupport;
  github: ModalitySupport;
  screenshot: ModalitySupport;
}

export interface Rule {
  id: string;
  category: 'accessibility' | 'usability' | 'ethics';
  name: string;
  diagnosis: string;
  correctivePrompt: string;
  // Two-Layer Hybrid Architecture fields
  method: EvaluationMethod;
  supportedModalities: ModalityConfig;
  /** Sub-checks run by the deterministic engine (DETERMINISTIC or HYBRID rules) */
  deterministicSignals?: string[];
  /** Conditions that trigger LLM fallback (HYBRID rules only) */
  llmFallbackConditions?: string[];
  /** Reason shown when a rule cannot be evaluated for a given modality */
  notEvaluatedReason?: Partial<Record<'zip' | 'github' | 'screenshot', string>>;
}

export const rules: Rule[] = [
  // ============================================================
  // Accessibility (WCAG AA) — A1–A6
  // ZIP/GitHub: ALL DETERMINISTIC (no LLM calls)
  // Screenshot: A1 & A2 LLM-assisted, A3–A6 Not Evaluated
  // ============================================================
  {
    id: 'A1',
    category: 'accessibility',
    name: 'Insufficient text contrast',
    diagnosis: 'Low contrast may reduce readability and fail WCAG AA compliance.',
    correctivePrompt: 'Replace low-contrast text colors (gray-300/400) with higher-contrast tokens (gray-600/700 or theme foreground) for informational text, while preserving design intent.',
    method: 'DETERMINISTIC',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'limited' },
    deterministicSignals: [
      'Tailwind color class risk-tier mapping (text-gray-300 etc.)',
      'Hex contrast ratio computation from CSS values',
    ],
    notEvaluatedReason: {
      screenshot: 'Screenshot A1 uses pixel sampling + k-means clustering (AI-assisted vision), not deterministic code analysis.',
    },
  },
  {
    id: 'A2',
    category: 'accessibility',
    name: 'Poor focus visibility',
    diagnosis: 'The default browser focus outline is removed without providing a visible replacement focus indicator, reducing keyboard accessibility.',
    correctivePrompt: 'Add a visible focus indicator (focus ring, border change, shadow, or distinct background change) for interactive elements that remove the default outline. Do not alter layout structure or component behavior beyond focus styling.',
    method: 'DETERMINISTIC',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'limited' },
    deterministicSignals: [
      'A2-D1: Scan focusable elements for outline-none/ring-0 without strong replacement (ring-2+, border, shadow-md+)',
      'A2-D2: Classify as Confirmed (no replacement) or Potential/Borderline (subtle replacement like ring-1, bg-only, shadow-sm)',
    ],
    notEvaluatedReason: {
      screenshot: 'Focus state detection from static screenshots is unreliable. Upload source code for deterministic evaluation.',
    },
  },
  {
    id: 'A3',
    category: 'accessibility',
    name: 'Incomplete keyboard operability',
    diagnosis: 'Interactive elements are not fully operable via keyboard or have broken keyboard semantics, preventing keyboard-only users from accessing functionality.',
    correctivePrompt: 'Ensure all interactive elements are keyboard accessible: use native <button>/<a href> elements, or add role, tabIndex=0, and Enter/Space key handlers to custom interactive elements.',
    method: 'DETERMINISTIC',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'not_supported' },
    deterministicSignals: [
      'A3-C1: Non-semantic elements with pointer handlers lacking role/tabIndex/keyboard handlers',
      'A3-C2: Native interactive elements blocked via tabIndex="-1" or pointer-events: none',
      'A3-C3: Static evidence of focus traps',
      'A3-P1: Missing Enter/Space activation for custom controls',
      'A3-P2: Menu triggers lacking aria-controls/aria-expanded',
    ],
    notEvaluatedReason: {
      screenshot: 'Keyboard operability requires DOM and event handler analysis, which cannot be determined from screenshots.',
    },
  },
  {
    id: 'A4',
    category: 'accessibility',
    name: 'Missing semantic structure',
    diagnosis: 'Page lacks proper semantic HTML structure (headings, landmarks, lists, interactive roles), reducing accessibility for screen reader and keyboard users.',
    correctivePrompt: 'Use semantic HTML elements (<h1>–<h6>, <main>, <nav>, <header>, <footer>, <ul>/<ol>, <button>, <a>) to represent page hierarchy and structure so assistive technologies can navigate effectively.',
    method: 'DETERMINISTIC',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'not_supported' },
    deterministicSignals: [
      'A4.1: Heading hierarchy validation (missing h1, level skips)',
      'A4.2: Clickable non-semantic elements (div/span with onClick without role)',
      'A4.3: Missing landmark regions (main, nav, header, footer)',
      'A4.4: Repeated sibling patterns without semantic list wrappers',
    ],
    notEvaluatedReason: {
      screenshot: 'Semantic structure requires DOM/HTML analysis; screenshot-only input cannot be evaluated.',
    },
  },
  {
    id: 'A5',
    category: 'accessibility',
    name: 'Missing form labels (Input clarity)',
    diagnosis: 'Form controls lack programmatic labels, reducing accessibility for screen reader users and failing WCAG 2.1 1.3.1 and 3.3.2.',
    correctivePrompt: 'Add visible <label> elements associated with form controls using for/id, or provide accessible names via aria-label/aria-labelledby. Do not rely on placeholder text as the sole label.',
    method: 'DETERMINISTIC',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'not_supported' },
    deterministicSignals: [
      'A5.1: Missing label association (no label, aria-label, or aria-labelledby)',
      'A5.2: Placeholder used as sole label',
      'A5.3: Broken for/id associations, orphan labels, duplicate IDs',
    ],
    notEvaluatedReason: {
      screenshot: 'Form label associations require DOM/HTML analysis; screenshot-only input cannot be evaluated.',
    },
  },
  {
    id: 'A6',
    category: 'accessibility',
    name: 'Missing accessible names (Name, Role, Value)',
    diagnosis: 'Interactive elements lack programmatic accessible names, preventing screen readers from identifying their purpose (WCAG 2.1 — 4.1.2 Level A).',
    correctivePrompt: 'Add visible text content, aria-label, or aria-labelledby to interactive elements. For icon-only buttons/links, add an aria-label describing the action.',
    method: 'DETERMINISTIC',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'not_supported' },
    deterministicSignals: [
      'A6.1: Missing accessible name (empty buttons, icon-only without aria-label)',
      'A6.2: Broken aria-labelledby reference (missing or empty target ID)',
    ],
    notEvaluatedReason: {
      screenshot: 'Accessible names require DOM/HTML analysis; screenshot-only input cannot be evaluated.',
    },
  },
  // ============================================================
  // Usability (HCI) — U1–U6
  // ============================================================
  {
    id: 'U1',
    category: 'usability',
    name: 'Unclear primary action',
    diagnosis: 'Users may struggle to identify the main action due to competing visual emphasis or missing affordances.',
    correctivePrompt: 'Establish a clear visual hierarchy by emphasizing one primary action and de-emphasizing secondary actions using variant demotion (outline, ghost, link).',
    method: 'HYBRID',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'limited' },
    deterministicSignals: [
      'U1.1: Form without submit mechanism',
      'U1.2: ≥2 sibling CTAs sharing identical high-emphasis styling (cva defaultVariants lookup)',
      'U1.3: Generic labels (Continue, Next, Submit, Save, Confirm, OK) without contextual disambiguation',
    ],
    llmFallbackConditions: [
      'Complex component composition where static analysis cannot resolve visual hierarchy',
      'Screenshot modality (visual dominance heuristic)',
    ],
  },
  {
    id: 'U2',
    category: 'usability',
    name: 'Incomplete / Unclear navigation',
    diagnosis: 'Navigation paths are missing, ambiguous, or prevent users from understanding their current location and how to move forward or backward.',
    correctivePrompt: 'Ensure clear navigation paths including back, forward, breadcrumb, and cancel options. Provide visible indicators of current location within the navigation hierarchy.',
    method: 'HYBRID',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'limited' },
    deterministicSignals: [
      'U2-D1: Multi-route app without breadcrumb or back navigation component',
      'U2-D2: Router with >3 routes but no <nav> or navigation component detected',
    ],
    llmFallbackConditions: [
      'Deterministic signals inconclusive (navigation may exist in unanalyzed files)',
      'Screenshot modality (visual navigation assessment)',
    ],
  },
  {
    id: 'U3',
    category: 'usability',
    name: 'Truncated or inaccessible content',
    diagnosis: 'Important content is truncated, clipped, or hidden in ways that prevent users from accessing full information without extra interaction.',
    correctivePrompt: 'Ensure all meaningful text is fully visible. Adjust layout, wrapping, or container sizes. If truncation is intentional, provide a clear affordance to reveal full content.',
    method: 'HYBRID',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'limited' },
    deterministicSignals: [
      'U3-D1: truncate/text-ellipsis class without expand affordance in same component',
      'U3-D2: line-clamp-[1-3] without show-more/expand control',
      'U3-D3: overflow-hidden + fixed height/max-height without scroll or expand',
    ],
    llmFallbackConditions: [
      'Complex layout where truncation intent is unclear from static analysis',
      'Screenshot modality (visual detection of clipped content)',
    ],
  },
  {
    id: 'U4',
    category: 'usability',
    name: 'Recognition-to-recall regression',
    diagnosis: 'The interface requires users to recall information from memory instead of recognizing it from visible options, increasing cognitive load.',
    correctivePrompt: 'Make options, commands, and actions visible or easily retrievable. Reduce reliance on user memory by providing contextual cues, labels, and previews.',
    method: 'LLM_ASSISTED',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'supported' },
  },
  {
    id: 'U5',
    category: 'usability',
    name: 'Insufficient interaction feedback',
    diagnosis: 'Users receive inadequate or no visible feedback about the result of their actions, leaving them uncertain whether the action was registered.',
    correctivePrompt: 'Add visible feedback after user actions: loading indicators, success/error confirmations, or state change animations. Ensure feedback is immediate and unambiguous.',
    method: 'HYBRID',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'limited' },
    deterministicSignals: [
      'U5-D1: Form onSubmit handler without loading state or toast/alert feedback',
      'U5-D2: Async operation (fetch/mutation) without isLoading/isPending UI binding',
    ],
    llmFallbackConditions: [
      'Complex state management where feedback may exist in unanalyzed parent components',
      'Screenshot modality (visual assessment of feedback mechanisms)',
    ],
  },
  {
    id: 'U6',
    category: 'usability',
    name: 'Weak grouping / layout coherence',
    diagnosis: 'Related elements lack visual grouping or alignment, reducing scannability and comprehension of content relationships.',
    correctivePrompt: 'Improve alignment and grouping to visually associate related elements. Use consistent spacing, borders, or background differentiation to establish content regions.',
    method: 'LLM_ASSISTED',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'supported' },
  },
  // ============================================================
  // Ethics — E1–E3
  // ============================================================
  {
    id: 'E1',
    category: 'ethics',
    name: 'Insufficient transparency in high-impact actions',
    diagnosis: 'High-impact actions (delete, purchase, subscribe, share data) lack adequate disclosure, confirmation, or consequence explanation.',
    correctivePrompt: 'Add confirmation steps with clear consequence disclosure for irreversible or high-impact actions. Ensure users understand what will happen before committing.',
    method: 'HYBRID',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'limited' },
    deterministicSignals: [
      'E1-D1: onClick handler with delete/remove/destroy action without confirmation dialog (AlertDialog, confirm(), modal)',
    ],
    llmFallbackConditions: [
      'Complex action flows where confirmation may exist in parent component or utility function',
      'Screenshot modality (visual assessment of destructive action flows)',
    ],
  },
  {
    id: 'E2',
    category: 'ethics',
    name: 'Imbalanced or manipulative choice architecture',
    diagnosis: 'Choice presentation uses visual weight, ordering, pre-selection, or defaults to nudge users toward a specific option that may not serve their interest.',
    correctivePrompt: 'Present choices with equal visual weight and neutral defaults. Ensure monetized or data-sharing options are not visually dominant over alternatives.',
    method: 'LLM_ASSISTED',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'supported' },
  },
  {
    id: 'E3',
    category: 'ethics',
    name: 'Obscured or restricted user control',
    diagnosis: 'User control options (opt-out, cancel, dismiss, unsubscribe) are visually suppressed, harder to access, or require more effort than their counterparts.',
    correctivePrompt: 'Make opt-out, cancel, and control options clearly visible with equal visual hierarchy and accessibility. Do not require extra steps to exercise user autonomy.',
    method: 'HYBRID',
    supportedModalities: { zip: 'supported', github: 'supported', screenshot: 'limited' },
    deterministicSignals: [
      'E3-D1: Cancel/dismiss/opt-out button with visually suppressed styling (text-xs, opacity-*, hidden, sr-only) compared to confirm/accept sibling',
    ],
    llmFallbackConditions: [
      'Complex UI patterns where control suppression is context-dependent',
      'Screenshot modality (visual assessment of control visibility)',
    ],
  },
];

export const ruleCategories = [
  { id: 'accessibility', name: 'Accessibility', description: 'WCAG AA compliance checks' },
  { id: 'usability', name: 'Usability', description: 'HCI best practices' },
  { id: 'ethics', name: 'Ethics', description: 'Transparency, choice architecture & user control' }
] as const;

export const getRulesByCategory = (category: string) => 
  rules.filter(r => r.category === category);

export const getRuleById = (id: string) => 
  rules.find(r => r.id === id);

// ============================================================
// ROUTING HELPERS — Used by edge functions to decide execution path
// ============================================================

/** Rules that are fully DETERMINISTIC for code analysis (ZIP/GitHub) — never send to LLM */
export const DETERMINISTIC_CODE_RULES = new Set(
  rules.filter(r => r.method === 'DETERMINISTIC').map(r => r.id)
);

/** Rules that are LLM-only (no deterministic signals) */
export const LLM_ONLY_RULES = new Set(
  rules.filter(r => r.method === 'LLM_ASSISTED').map(r => r.id)
);

/** Rules that are HYBRID (deterministic first, LLM fallback) */
export const HYBRID_RULES = new Set(
  rules.filter(r => r.method === 'HYBRID').map(r => r.id)
);

/** Rules that cannot be evaluated from screenshots (DOM/code required) */
export const SCREENSHOT_NOT_SUPPORTED = new Set(
  rules.filter(r => r.supportedModalities.screenshot === 'not_supported').map(r => r.id)
);

/** Get the evaluation method for a rule */
export const getEvaluationMethod = (ruleId: string): EvaluationMethod | undefined =>
  rules.find(r => r.id === ruleId)?.method;
