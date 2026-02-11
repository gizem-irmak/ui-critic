# Memory: features/analysis-rules/a2-font-size
Updated: now

Rule A2 (Small Body Font Size) uses a **strict primary body text scope** — it evaluates ONLY primary readable body content. The threshold is **16px** for these elements.

**A2 Scope — ALLOWED targets (primary body text only):**
- Paragraphs (`<p>`), long-form descriptions, article content
- Main content blocks (`.content`, `.description`, `.article`, `.body`, `.prose`, `.main-text`)
- Dialog/alert/form descriptions (`DialogDescription`, `AlertDescription`, `FormDescription`, `CardDescription`)
- List items representing body content (e.g., learning outcomes text)

**A2 Scope — EXCLUDED (DO NOT evaluate):**
- Badges, chips, pills, tags, status indicators
- Headings, titles, subtitles (h1–h6, page/section titles, header subtitles)
- Navigation labels, menu items, breadcrumbs, tab labels
- Buttons, CTAs, interactive elements, icon buttons
- Metadata, timestamps, dates, author/instructor names
- Captions, tooltips, keyboard shortcuts, code blocks, monospace
- Placeholder text, helper microcopy (unless FormDescription-level)
- Icon-only elements

**Classification Logic:**
- **Confirmed Violation (Blocking):** Source code analysis (ZIP or GitHub) where body-level text has explicitly defined font-size < 16px in pixels OR deterministic Tailwind classes (text-xs = 12px, text-sm = 14px). The computed size must be deterministically resolved AND element must be confidently classified as primary body text.
- **Heuristic / Potential Risk (Non-blocking):** Screenshot-based visual estimation (always potential), OR font-size in relative units where final size can't be guaranteed, OR semantic role can't be confidently classified as primary body text. Never blocks convergence.

**Post-processing enforcement:** All three edge functions (analyze-zip, analyze-ui, analyze-github) apply strict regex-based filters to exclude badges, headings, navigation, buttons, metadata, captions, tooltips, and icon elements from A2 results — even if the AI model reports them. Only elements passing the body-text filter are included in the aggregated A2 card.

**Corrective Prompt Scope:** "Increase primary body text (paragraphs, descriptions, main content text, dialog/alert/form descriptions) to at least 16px. Do not change badges, headings, subtitles, navigation text, metadata, timestamps, button labels, or intentional microcopy."

Findings aggregate into a single result per run with `status` ('confirmed' or 'potential') and `blocksConvergence` fields. The rule name is "Small body font size".
