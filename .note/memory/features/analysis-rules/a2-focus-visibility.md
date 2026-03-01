# Memory: features/analysis-rules/a2-focus-visibility
Updated: now

Rule A2 (Poor Focus Visibility) evaluates WCAG 2.4.7 — fully deterministic (no LLM dependency).

## Focusability Gate (CRITICAL)
- **Confirmed** requires `focusable === 'yes'` (deterministically focusable):
  - `<button>`, `<a href>`, `<input>`, `<select>`, `<textarea>`
  - OR `tabIndex >= 0`
  - OR `role="button"/"link"/etc.` with keyboard handlers
- **focusable === 'unknown'** (component wrappers, unresolved tags) → **Potential** (confidence 0.75)
- **focusable === 'no'** (plain div/span without tabIndex) → **not_applicable** (suppressed)

## Classification Logic

**Pass (No violation):**
- No outline suppression detected (browser defaults preserved)
- OR outline removed + ANY focus-scoped strong replacement token:
  - `focus:ring-*` / `focus-visible:ring-*` (not ring-0)
  - `focus:border-*` / `focus-visible:border-*` (not border-0/none)
  - `focus:shadow-*` / `focus-visible:shadow-*` (not shadow-none)
  - `focus:outline-*` / `focus-visible:outline-*` (not outline-none)
- OR `focus-within:ring-*` / `focus-within:border-*` / `focus-within:shadow-*` (wrapper indicator)
- OR state-driven highlight patterns (Radix/CMDK/listbox/menu):
  - `data-[selected=true]:bg-*` / `data-[highlighted=true]:bg-*`
  - `aria-selected:bg-*` / `data-[state=active]:bg-*` / `data-[state=open]:bg-*`
  - (requires at least one visual change: bg-/text-/ring-/border-/outline-/shadow-)
- OR parent wrapper (one hop up) has `focus-within:ring-*` / `focus-within:border-*` / `focus-within:shadow-*`

**Potential (Borderline):**
- Outline removed + ONLY focus-scoped weak styling (focus:bg-*, focus:text-*, focus:underline, focus:opacity-*, focus:font-*) — confidence 0.68
- OR outline removed + no replacement + focusable=unknown — confidence 0.75

**Confirmed (Blocking):**
- Outline removed + NO focus-scoped replacement + NO state-driven indicator + focusable=yes — confidence 0.92

## CRITICAL: Focus-Scoped Only
- Only tokens starting with `focus:` or `focus-visible:` count as direct replacements
- Bare `ring-*`, `border-*`, `shadow-*`, `bg-*`, `text-*` are NOT focus indicators
- State-driven tokens (`data-[selected]`, `data-[highlighted]`, `aria-selected`, `data-[state=active/open]`) ARE valid indicators when they change bg/text/ring/border/outline/shadow
