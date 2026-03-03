# Memory: features/analysis-rules/a1-contrast
Updated: now

Rule A1 (Insufficient Text Contrast) evaluates WCAG 1.4.3 using deterministic code-level color resolution for base and state-specific variants (hover, focus, dark). 
- Extraction: Resolves foreground and background colors from Tailwind tokens (including alpha /80 syntax), inline styles, and JSX objects. It explicitly separates base styles from variant-prefixed tokens to prevent false positives from hover/focus states.
- Resolution: Background resolution follows an ancestor-only traversal (self-inline > self-tailwind > ancestor-inline > ancestor-tailwind). **No assumed-white fallback**: if no bg token is found in the element or ancestor tree, bg is marked as `unresolved` and NO contrast ratio is computed (prevents false positives like Button.tsx fg=#fff bg=#fff 1.0:1).
- Alpha Compositing: Performs alpha compositing to blend foreground colors against resolved backgrounds for accurate ratios. Only computed when bg is fully resolved.
- Classification: Confirmed only when both fg and bg are deterministically resolved (tailwind token or inline style) and the ratio fails the threshold. When bg is unresolved, the finding is always Potential with `contrastRatio=null`, `contrastNotMeasurable=true`, and `unresolvedReason`.
- Large Text: Applies higher thresholds (normal >= 4.5, large >= 3.0) based on font-size and weight detection.
- Evidence: Each A1 finding includes `filePath`, `startLine`/`endLine`, `variantName`, `extractedClasses`, and `resolutionStatus` (fg: resolved|unresolved, bg: resolved|unresolved) for debugging.
- UI: Potential A1 cards show "Background: unresolved" with a "context-dependent" badge and "Contrast: not computed (background unresolved)" instead of a numeric ratio. Source location and variant context are displayed when available.
