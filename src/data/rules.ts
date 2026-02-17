export interface Rule {
  id: string;
  category: 'accessibility' | 'usability' | 'ethics';
  name: string;
  diagnosis: string;
  correctivePrompt: string;
}

export const rules: Rule[] = [
  // Accessibility (WCAG AA)
  {
    id: 'A1',
    category: 'accessibility',
    name: 'Insufficient text contrast',
    diagnosis: 'Low contrast may reduce readability and fail WCAG AA compliance.',
    correctivePrompt: 'Replace low-contrast text colors (gray-300/400) with higher-contrast tokens (gray-600/700 or theme foreground) for informational text, while preserving design intent.'
  },
  {
    id: 'A2',
    category: 'accessibility',
    name: 'Poor focus visibility',
    diagnosis: 'The default browser focus outline is removed without providing a visible replacement focus indicator, reducing keyboard accessibility.',
    correctivePrompt: 'Add a visible focus indicator (focus ring, border change, shadow, or distinct background change) for interactive elements that remove the default outline. Do not alter layout structure or component behavior beyond focus styling.'
  },
  {
    id: 'A3',
    category: 'accessibility',
    name: 'Incomplete keyboard operability',
    diagnosis: 'Interactive elements are not fully operable via keyboard or have broken keyboard semantics, preventing keyboard-only users from accessing functionality.',
    correctivePrompt: 'Ensure all interactive elements are keyboard accessible: use native <button>/<a href> elements, or add role, tabIndex=0, and Enter/Space key handlers to custom interactive elements.'
  },
  {
    id: 'A4',
    category: 'accessibility',
    name: 'Missing semantic structure',
    diagnosis: 'Page lacks proper semantic HTML structure (headings, landmarks, lists, interactive roles), reducing accessibility for screen reader and keyboard users.',
    correctivePrompt: 'Use semantic HTML elements (<h1>–<h6>, <main>, <nav>, <header>, <footer>, <ul>/<ol>, <button>, <a>) to represent page hierarchy and structure so assistive technologies can navigate effectively.'
  },
  {
    id: 'A5',
    category: 'accessibility',
    name: 'Missing form labels (Input clarity)',
    diagnosis: 'Form controls lack programmatic labels, reducing accessibility for screen reader users and failing WCAG 2.1 1.3.1 and 3.3.2.',
    correctivePrompt: 'Add visible <label> elements associated with form controls using for/id, or provide accessible names via aria-label/aria-labelledby. Do not rely on placeholder text as the sole label.'
  },
  {
    id: 'A6',
    category: 'accessibility',
    name: 'Missing accessible names (Name, Role, Value)',
    diagnosis: 'Interactive elements lack programmatic accessible names, preventing screen readers from identifying their purpose (WCAG 2.1 — 4.1.2 Level A).',
    correctivePrompt: 'Add visible text content, aria-label, or aria-labelledby to interactive elements. For icon-only buttons/links, add an aria-label describing the action.'
  },
  // Usability (HCI)
  {
    id: 'U1',
    category: 'usability',
    name: 'Unclear primary action',
    diagnosis: 'Users may struggle to identify the main action due to competing visual emphasis or missing affordances.',
    correctivePrompt: 'Establish a clear visual hierarchy by emphasizing one primary action and de-emphasizing secondary actions using variant demotion (outline, ghost, link).'
  },
  {
    id: 'U2',
    category: 'usability',
    name: 'Incomplete / Unclear navigation',
    diagnosis: 'Navigation paths are missing, ambiguous, or prevent users from understanding their current location and how to move forward or backward.',
    correctivePrompt: 'Ensure clear navigation paths including back, forward, breadcrumb, and cancel options. Provide visible indicators of current location within the navigation hierarchy.'
  },
  {
    id: 'U3',
    category: 'usability',
    name: 'Truncated or inaccessible content',
    diagnosis: 'Important content is truncated, clipped, or hidden in ways that prevent users from accessing full information without extra interaction.',
    correctivePrompt: 'Ensure all meaningful text is fully visible. Adjust layout, wrapping, or container sizes. If truncation is intentional, provide a clear affordance to reveal full content.'
  },
  {
    id: 'U4',
    category: 'usability',
    name: 'Recognition-to-recall regression',
    diagnosis: 'The interface requires users to recall information from memory instead of recognizing it from visible options, increasing cognitive load.',
    correctivePrompt: 'Make options, commands, and actions visible or easily retrievable. Reduce reliance on user memory by providing contextual cues, labels, and previews.'
  },
  {
    id: 'U5',
    category: 'usability',
    name: 'Insufficient interaction feedback',
    diagnosis: 'Users receive inadequate or no visible feedback about the result of their actions, leaving them uncertain whether the action was registered.',
    correctivePrompt: 'Add visible feedback after user actions: loading indicators, success/error confirmations, or state change animations. Ensure feedback is immediate and unambiguous.'
  },
  {
    id: 'U6',
    category: 'usability',
    name: 'Weak grouping / layout coherence',
    diagnosis: 'Related elements lack visual grouping or alignment, reducing scannability and comprehension of content relationships.',
    correctivePrompt: 'Improve alignment and grouping to visually associate related elements. Use consistent spacing, borders, or background differentiation to establish content regions.'
  },
  // Ethics
  {
    id: 'E1',
    category: 'ethics',
    name: 'Insufficient transparency in high-impact actions',
    diagnosis: 'High-impact actions (delete, purchase, subscribe, share data) lack adequate disclosure, confirmation, or consequence explanation.',
    correctivePrompt: 'Add confirmation steps with clear consequence disclosure for irreversible or high-impact actions. Ensure users understand what will happen before committing.'
  },
  {
    id: 'E2',
    category: 'ethics',
    name: 'Imbalanced or manipulative choice architecture',
    diagnosis: 'Choice presentation uses visual weight, ordering, pre-selection, or defaults to nudge users toward a specific option that may not serve their interest.',
    correctivePrompt: 'Present choices with equal visual weight and neutral defaults. Ensure monetized or data-sharing options are not visually dominant over alternatives.'
  },
  {
    id: 'E3',
    category: 'ethics',
    name: 'Obscured or restricted user control',
    diagnosis: 'User control options (opt-out, cancel, dismiss, unsubscribe) are visually suppressed, harder to access, or require more effort than their counterparts.',
    correctivePrompt: 'Make opt-out, cancel, and control options clearly visible with equal visual hierarchy and accessibility. Do not require extra steps to exercise user autonomy.'
  }
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
