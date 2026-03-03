# Memory: features/analysis-rules/a1-contrast
Updated: now

Rule A1 (Insufficient Text Contrast) evaluates WCAG 1.4.3 with three sub-checks:

- **A1.1** — Deterministic contrast ratio computation using Tailwind tokens and inline styles. Variant-aware extraction (hover, focus, dark) and alpha compositing. Background resolution follows ancestor-only traversal. Epistemic gating ensures contrast is NOT computed if the background is unresolved (removing #ffffff fallback). Findings are Potential if background is unresolved. Large text thresholds apply based on font-size/weight.

- **A1.3** — Theme-Dependent or Opacity-Reduced Text (Potential Only). Detects text using CSS-variable-based colors (text-muted, text-muted-foreground, text-foreground, text-primary, text-secondary, text-accent, var(--foreground), hsl(var(--...))) or opacity-reduced patterns (opacity-50/60/70, text-opacity-*). Always classified as Potential with confidence 0.60–0.70. Never escalates to Confirmed. Never computes contrast ratio. Suppressed for: disabled buttons, placeholder text in inputs, aria-hidden="true" elements, self-closing icon-only elements.

UI displays 'Not computed (insufficient color context)' for unresolved states. Component-level A1 issues (e.g., Button.tsx) are suppressed unless at least one CVA variant provides a fully resolved fg/bg pair. Findings are sorted primarily by file path and then by line number.

A1.3 advisory text: "Text color is theme-dependent or opacity-reduced. Final contrast ratio cannot be statically computed. WCAG 2.1 AA (4.5:1) compliance must be verified in rendered output."
