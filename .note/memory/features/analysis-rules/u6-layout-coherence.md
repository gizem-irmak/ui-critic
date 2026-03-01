# Memory: features/analysis-rules/u6-layout-coherence
Updated: now

Rule U6 (Weak Grouping / Layout Coherence) is a fully LLM-assisted usability rule, always classified as Potential (Non-blocking) with a confidence cap of 0.80.

## Hard Scope Suppression (Skip Entirely)
- Files named App.tsx, main.tsx, index.tsx, router*, routes* → skipped
- JSX containing Routes/Route/Switch/Router/BrowserRouter or createBrowserRouter → skipped
- Composition/provider wrapper files (>50% provider tags) → skipped

## Page-Like Gate
U6 only evaluates page-like components containing:
- main/header/aside/section/form/table/Card tags
- OR a top-level H1/H2 + multiple blocks
- Non-page-like files are skipped entirely

## Container Detection (Expanded)
Counted as containers:
- **Semantic**: section, article, main, aside, nav, fieldset
- **Components**: Card, Panel, Sheet, DialogContent, PopoverContent, TabsContent, AccordionItem, Separator
- **Card-like divs**: rounded-* AND (border OR bg-* OR shadow OR ring-*) AND padding (p-3+)
- **divide-y sections** with headings present

## Deterministic Complexity Gate
Only calls LLM if: blockCount >= 4 OR usesGridOrColumns == true. Otherwise suppressed.

## Strong Suppression Rules (Pre-LLM)
Suppress if ANY of:
1. Table page with thead/TableHead/th (column headers exist)
2. ≥2 headings AND ≥2 containers (structured page)
3. ≥2 distinct layout primitives used (Card + Separator, Tabs + Accordion, etc.)
4. ≥2 component blocks + card-like divs (well-grouped)
5. ≥2 headings + ≥1 separator (clear hierarchy)
6. ≥2 semantic sections (section + article + fieldset)
7. ≤2 major siblings with no flat-stack cues (simple page)

## Reporting
When reported, includes trigger summary: "Blocks:X Containers:Y Headings:Z SemanticSections:S Grid:true/false"
Each u6Element must cite evidence grounded in these counts.

## UI
Uses `U6AggregatedCard` component to display structural layout issues and advisory guidance.
