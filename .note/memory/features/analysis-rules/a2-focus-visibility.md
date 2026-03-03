# Memory: features/analysis-rules/a2-focus-visibility
Updated: now

Rule A2 (Poor Focus Visibility) uses strength-based classification with per-element reporting.

## Strength-Based Classification (v2)
- **Suppress (PASS)**: Outline removed + strong replacement tokens:
  - `focus(-visible)?:ring-*`, `focus(-visible)?:border-*`, `focus(-visible)?:shadow-*`, `focus(-visible)?:outline-*`
  - `focus-within:ring-*`, `focus-within:border-*`, `focus-within:shadow-*`
  - State-driven strong: `data-[selected]:ring-*`, `data-[highlighted]:border-*`, `data-[state=active]:shadow-*`, etc.
- **Potential (Borderline)** (confidence 0.60–0.75): Outline removed + only weak replacement tokens:
  - `focus(-visible)?:bg-*`, `focus(-visible)?:text-*`, `focus(-visible)?:underline`, `focus(-visible)?:opacity-*`
  - State-driven weak: `data-[selected]:bg-*`, `data-[highlighted]:bg-*`, `data-[state=open]:bg-*`, `aria-selected:bg-*`, etc.
- **Confirmed** (confidence 0.92): Outline removed + no replacement tokens at all.
- **Not applicable**: Element is non-focusable (focusable=no).

## Outline Removal Tokens
`outline-none`, `focus:outline-none`, `focus-visible:outline-none`, `[&]:outline-none`

## Focusable Inference
- **Yes**: Native interactive elements (button, input, textarea, select), `<a>` with href, elements with tabIndex≥0, interactive ARIA roles (button, link, menuitem, option, etc.), elements with onClick/onKeyDown/onSelect, PascalCase components ending in Input/Item/Button/Link/Trigger/Tab/Checkbox/Switch/Radio/Slider/Option.
- **No**: Non-interactive HTML elements without interactive attributes, `<a>` without href, tabIndex<0.
- **Unknown**: PascalCase components not matching known interactive patterns.
- Only focusable=yes elements are reported.

## Deduplication
Key: `filePath + startLine + elementName + outlineRemovalTokens + alternativeIndicatorTokens`

## Per-Element Reporting
Each finding includes componentName, elementName, elementSubtype, selectorHints, startLine/endLine, filePath, rawClassName, focusClasses, detection string.
