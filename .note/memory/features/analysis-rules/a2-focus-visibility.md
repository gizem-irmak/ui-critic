# Memory: features/analysis-rules/a2-focus-visibility
Updated: now

Rule A2 (Poor Focus Visibility) identifies accessibility failures where focus indicators are removed or insufficient.

## Per-Element Reporting (v2)
- **No pattern-signature grouping**: Each focusable element is reported individually with its own line range, element name, and subtype annotation.
- **Element subtype annotation**: Each finding includes `elementSubtype` (e.g., `input[type="text"]`, `div role=option`) derived from detected role/type attributes.
- **Structured detection evidence**: Multi-line detection strings: first line describes outline removal, second line describes replacement status (e.g., "no visible focus indicator detected" or "alternative indicator detected: focus:bg-accent").

## Classification
- **Confirmed** (confidence 0.92): Native interactive elements (button, input, etc.) or elements with `focusable=yes` where outline is removed without any strong or state-driven replacement.
- **Potential** (confidence 0.68–0.75): Elements with weak focus styling (focus:bg-*, focus:text-*, focus:underline) or unknown focusability.
- **Pass**: Strong replacement (focus:ring-*, focus:border-*, focus:shadow-*, focus:outline-*), focus-within wrapper indicators, or state-driven patterns (data-[selected], data-[highlighted], aria-selected, data-[state=active/open]).
- **Suppressed**: Non-focusable wrappers (HoverCardContent, PopoverContent, etc.), non-interactive elements (focusable=no).

## Source Location
- Each finding includes `startLine`, `endLine`, `filePath` for precise code attribution.
- Findings are sorted by file path (alphabetical) then line number (ascending).

## Element Name Resolution (4-tier)
1. JSX Tag Name (e.g., `<CommandInput>`, `<SelectItem>`)
2. Wrapper Component Scope (via symbol table)
3. HTML Tag Fallback (e.g., `button`, `input`)
4. Unknown
