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

**Token-Level Grouping (ZIP/GitHub only):**
A2 findings are grouped by font-size token/class (e.g., text-xs, text-sm, font-size: 12px). Each token group shows count and file count. The Violation type includes `a2TokenGroups` array with `{ token, approxPx, count, fileCount, classification }`. Each `A2ElementSubItem` now includes `sizeToken`, `approxPx`, `semanticRole` ('primary' | 'secondary'), `elementRole`, `componentName`, and `filePath`.

**Semantic Role Classification:**
Each occurrence is classified as either:
- **primary**: DialogDescription, AlertDescription, FormDescription, CardDescription, paragraphs, article content, long-form text → can be Confirmed (Blocking)
- **secondary**: badges, labels, tags, metadata, timestamps, helper microcopy → Potential Risk (Non-blocking) only

**Classification Logic:**
- **Confirmed Violation (Blocking):** Source code analysis (ZIP or GitHub) where primary body-level text has explicitly defined font-size < 16px in pixels OR deterministic Tailwind classes (text-xs = 12px, text-sm = 14px). Must be classified as "primary" semantic role.
- **Heuristic / Potential Risk (Non-blocking):** Screenshot-based visual estimation (always potential), OR font-size in relative units, OR semantic role classified as "secondary". Never blocks convergence.

**Post-processing enforcement:** All three edge functions apply strict regex-based filters to exclude badges, headings, navigation, buttons, metadata, captions, tooltips, and icon elements from A2 results.

**Corrective Prompt Format (matches A1 structure):**
```
• body text — CourseCard.tsx — (Course description)
  Issue reason: computed font-size 12px (text-xs) is below recommended 16px baseline for primary readable content.
  Recommended fix: Increase this primary body text to at least 16px (text-base) and set line-height ~1.4–1.6. Update shared typography tokens or reusable classes so this does not recur.
```

**Language rule:** Say "recommended readability baseline of 16px", NOT "WCAG requires 16px".

Findings aggregate into a single result per run with `status` ('confirmed' or 'potential') and `blocksConvergence` fields. The rule name is "Small body font size".
