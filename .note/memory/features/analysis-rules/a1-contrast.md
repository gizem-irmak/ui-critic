# Memory: features/analysis-rules/a1-contrast
Updated: now

Rule A1 (Insufficient Text Contrast) evaluates WCAG 1.4.3 with three sub-checks:

- **A1.1** — Deterministic contrast ratio computation using Tailwind tokens and inline styles. Variant-aware extraction (hover, focus, dark) and alpha compositing. Background resolution follows ancestor-only traversal. Epistemic gating ensures contrast is NOT computed if the background is unresolved (removing #ffffff fallback). Large text thresholds apply based on font-size/weight.

- **A1.1 Potential gating** — Potential findings from A1.1 are only emitted when the element's classes contain a concrete risk signal (theme token like text-muted/text-foreground, opacity-50/60/70, text-opacity-*, or CSS variable color patterns). Mere "background unresolved" without a risk signal is NOT sufficient to create a Potential finding. This prevents noisy false positives from elements where colors simply weren't resolvable.

- **A1.3** — Theme-Dependent or Opacity-Reduced Text (Potential Only). Detects text using CSS-variable-based colors (text-muted, text-muted-foreground, text-foreground, text-primary, text-secondary, text-accent, var(--foreground), hsl(var(--...))) or opacity-reduced patterns (opacity-50/60/70, text-opacity-*). Always classified as Potential with confidence 0.60–0.70. Never escalates to Confirmed. Never computes contrast ratio. Suppressed for: disabled buttons, placeholder text in inputs, aria-hidden="true" elements, self-closing icon-only elements.

**Aggregation**: Potential A1 elements are deduplicated by (elementIdentifier + evidence + variant + startLine) before building the card. Duplicate entries merge into a single item with an occurrences counter. A single A1 Potential card is produced per analysis run.

**Display fields for unresolved Potential**:
- Foreground: "theme/variable/opacity-dependent" (not "unresolved" or "not measured")
- Background: "theme/variable-dependent" (not "unresolved")
- Contrast: "Not computed (requires rendered colors)"

**Advisory** (Potential card): "Theme-dependent or opacity-reduced colors cannot be verified statically. Provide a rendered screenshot or enable runtime contrast sampling to compute effective contrast."

Confirmed A1 violations are unchanged — require computed contrast ratio below threshold.
