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
  // Usability (HCI)
  {
    id: 'U1',
    category: 'usability',
    name: 'Unclear primary action',
    diagnosis: 'Users may struggle to identify the main action.',
    correctivePrompt: 'Establish a clear visual hierarchy by emphasizing one primary action and de-emphasizing secondary actions.'
  },
  {
    id: 'U2',
    category: 'usability',
    name: 'Multiple competing CTAs',
    diagnosis: 'Competing CTAs increase cognitive load and confusion.',
    correctivePrompt: 'Reduce emphasis on secondary actions to ensure a single, clear primary CTA.'
  },
  {
    id: 'U3',
    category: 'usability',
    name: 'Inconsistent typography',
    diagnosis: 'Typography inconsistency reduces visual coherence.',
    correctivePrompt: 'Use a consistent typography system with limited font families and standardized heading and body styles.'
  },
  {
    id: 'U4',
    category: 'usability',
    name: 'Excessive color usage',
    diagnosis: 'Excessive color usage can reduce clarity and visual balance.',
    correctivePrompt: 'Limit the color palette and use color consistently to support visual hierarchy.'
  },
  {
    id: 'U5',
    category: 'usability',
    name: 'Weak grouping or alignment',
    diagnosis: 'Poor grouping can reduce scannability and comprehension.',
    correctivePrompt: 'Improve alignment and grouping to visually associate related elements.'
  },
  {
    id: 'U6',
    category: 'usability',
    name: 'Unclear or insufficient error feedback',
    diagnosis: 'Insufficient error feedback may prevent users from correcting mistakes.',
    correctivePrompt: 'Provide clear, descriptive error messages near relevant fields using text, not color alone.'
  },
  {
    id: 'U7',
    category: 'usability',
    name: 'Insufficient visible interaction feedback',
    diagnosis: 'Users may be uncertain whether actions were registered.',
    correctivePrompt: 'Add visible feedback after user actions (loading indicators, confirmations, or state changes).'
  },
  {
    id: 'U8',
    category: 'usability',
    name: 'Incomplete or unclear navigation',
    diagnosis: 'Users may not understand how to move between screens or recover.',
    correctivePrompt: 'Ensure clear navigation paths including back, forward, and cancel options.'
  },
  {
    id: 'U9',
    category: 'usability',
    name: 'Lack of cross-page visual coherence',
    diagnosis: 'Inconsistency reduces learnability and confidence.',
    correctivePrompt: 'Ensure consistent layout, navigation placement, typography, and color usage across screens.'
  },
  {
    id: 'U10',
    category: 'usability',
    name: 'Truncated or clipped text',
    diagnosis: 'Truncated text may obscure meaning.',
    correctivePrompt: 'Ensure all text is fully visible; adjust layout, wrapping, or container sizes.'
  },
  {
    id: 'U11',
    category: 'usability',
    name: 'Inappropriate control type',
    diagnosis: 'Inappropriate controls increase cognitive effort.',
    correctivePrompt: 'Replace chip-based controls with clearer text-based options where meaning must be explicit.'
  },
  {
    id: 'U12',
    category: 'usability',
    name: 'Missing confirmation for high-impact actions',
    diagnosis: 'Users may trigger irreversible actions accidentally.',
    correctivePrompt: 'Add confirmation or warning steps for irreversible or high-impact actions.'
  },
  // Ethics / Dark Patterns
  {
    id: 'E1',
    category: 'ethics',
    name: 'Monetized option visually dominant',
    diagnosis: 'Visual dominance may nudge unintended choices.',
    correctivePrompt: 'Reduce emphasis on monetized actions and ensure alternatives are equally visible.'
  },
  {
    id: 'E2',
    category: 'ethics',
    name: 'Hidden or de-emphasized opt-out',
    diagnosis: 'Hidden opt-outs undermine user autonomy.',
    correctivePrompt: 'Make opt-out options clearly visible with equal hierarchy and contrast.'
  },
  {
    id: 'E3',
    category: 'ethics',
    name: 'Misleading visual hierarchy',
    diagnosis: 'Hierarchy may falsely suggest mandatory actions.',
    correctivePrompt: 'Adjust hierarchy to accurately reflect optional vs mandatory actions.'
  },
  {
    id: 'E4',
    category: 'ethics',
    name: 'Overuse of urgency cues',
    diagnosis: 'Excessive urgency pressures users unfairly.',
    correctivePrompt: 'Reduce urgency cues and present choices neutrally.'
  }
];

export const ruleCategories = [
  { id: 'accessibility', name: 'Accessibility', description: 'WCAG AA compliance checks' },
  { id: 'usability', name: 'Usability', description: 'HCI best practices' },
  { id: 'ethics', name: 'Ethics', description: 'Dark pattern detection' }
] as const;

export const getRulesByCategory = (category: string) => 
  rules.filter(r => r.category === category);

export const getRuleById = (id: string) => 
  rules.find(r => r.id === id);
