# Memory: features/analysis-rules/a2-font-size
Updated: now

Rule A2 (Small Body Font Size) uses a confirmed/potential classification framework aligned with the convergence model. The threshold is **16px** for primary body text elements (paragraphs, descriptions, content blocks, dialog/alert/form descriptions).

**Classification Logic:**
- **Confirmed Violation (Blocking):** Source code analysis (ZIP or GitHub) where body-level text has explicitly defined font-size < 16px in pixels OR deterministic Tailwind classes (text-xs = 12px, text-sm = 14px). The computed size must be deterministically resolved. Blocks convergence.
- **Heuristic / Potential Risk (Non-blocking):** Screenshot-based visual estimation (always potential), OR font-size defined in relative units (rem/em/%) where final size can't be guaranteed, OR semantic role can't be confidently classified as primary body text. Never blocks convergence.

**Exclusions (DO NOT apply A2 to):**
- Badges, tags, chips, status indicators
- Metadata, timestamps, date displays
- Intentional microcopy, keyboard shortcuts
- Navigation items, button labels, breadcrumbs
- Tooltip content, captions, code blocks

Findings aggregate into a single result per run with `status` ('confirmed' or 'potential') and `blocksConvergence` fields. The rule name is "Small body font size".
