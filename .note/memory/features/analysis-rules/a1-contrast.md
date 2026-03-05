# Memory: features/analysis-rules/a1-contrast
Updated: now

Rule A1 (Insufficient Text Contrast) evaluates WCAG 1.4.3 with three sub-checks:

- **A1.1** — Deterministic contrast ratio computation using Tailwind tokens and inline styles. Variant-aware extraction (hover, focus, dark) and alpha compositing. Background resolution follows ancestor-only traversal. Epistemic gating ensures contrast is NOT computed if the background is unresolved (removing #ffffff fallback). Large text thresholds apply based on font-size/weight.

- **A1.1 Same-color guard** — If fg and bg resolve to the exact same hex value (e.g., #ffffff vs #ffffff → 1.0:1), the finding is skipped as a cross-branch resolution error. This prevents false positives from ternary expressions where text-white pairs with bg-blue-600 in one branch but bg resolution picks up bg-white from another branch.

- **A1.1 Ternary-context detection** — When a text color token appears inside a ternary expression (`? "..." : "..."`), background resolution is skipped entirely because branch pairing is unreliable. The finding is classified as unresolved/Potential instead of Confirmed.

- **A1.1 Potential gating** — Potential findings from A1.1 are only emitted when the element's classes contain a concrete risk signal (theme token like text-muted/text-foreground, opacity-50/60/70, text-opacity-*, or CSS variable color patterns). Mere "background unresolved" without a risk signal is NOT sufficient to create a Potential finding.

- **A1.3** — Theme-Dependent or Opacity-Reduced Text (Potential Only). Detects text using CSS-variable-based colors or opacity-reduced patterns. Always classified as Potential with confidence 0.60–0.70. Never escalates to Confirmed. Never computes contrast ratio.

- **Evidence output** — Shows resolved Tailwind token with hex: `text-gray-600 (#4b5563) on bg-white (#ffffff)`.

**Aggregation**: Potential A1 elements are deduplicated by (elementIdentifier + evidence + variant + startLine). A single A1 Potential card is produced per analysis run.

**Display fields for unresolved Potential**:
- Foreground: "theme/variable/opacity-dependent" (not "unresolved")
- Background: "theme/variable-dependent" (not "unresolved")
- Contrast: "Not computed (requires rendered colors)"

**Advisory** (Potential card): "Theme-dependent or opacity-reduced colors cannot be verified statically. Provide a rendered screenshot or enable runtime contrast sampling to compute effective contrast."

**Screenshot confidence suppression** — Perceptual A1 findings with confidence < 60% are suppressed entirely. Badge/pill/status-label elements (e.g., "Active", "Scheduled" with colored backgrounds) receive a -20% confidence penalty before threshold check. Confidence interpretation: 80–90% clear low-contrast, 70–79% strong suspicion, 60–69% plausible risk, <60% suppressed.

Confirmed A1 violations are unchanged — require computed contrast ratio below threshold.
