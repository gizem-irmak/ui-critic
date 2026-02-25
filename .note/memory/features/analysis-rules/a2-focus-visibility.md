# Memory: features/analysis-rules/a2-focus-visibility
Updated: now

Rule A2 (Poor Focus Visibility) evaluates WCAG 2.4.7 — now **fully deterministic** (no LLM dependency).

## Detection Method
- **Deterministic**: `detectA2FocusVisibility(allFiles)` scans ALL className/class/cva strings in source files
- Parses full class strings into tokens, then applies classification per-element
- No longer relies on LLM evidence (which was incomplete and caused false positives)

## Classification Logic

**Pass (No violation):**
- No outline suppression detected (browser defaults preserved)
- OR outline removed + ANY focus-scoped strong replacement token:
  - `focus:ring-*` / `focus-visible:ring-*` (not ring-0)
  - `focus:border-*` / `focus-visible:border-*` (not border-0/none)
  - `focus:shadow-*` / `focus-visible:shadow-*` (not shadow-none)
  - `focus:outline-*` / `focus-visible:outline-*` (not outline-none)

**Borderline (Potential):**
- Outline removed + ONLY focus-scoped weak styling:
  - `focus:bg-*`, `focus:text-*`, `focus:underline`, `focus:opacity-*`, `focus:font-*`
- Confidence: 60–75%

**Confirmed (Blocking):**
- Outline removed + NO focus-scoped replacement at all
- Bare tokens (`ring-2`, `border-2`, `bg-accent`) do NOT count
- Confidence: 90–95%

## CRITICAL: Focus-Scoped Only
- Only tokens starting with `focus:` or `focus-visible:` count as replacements
- Bare `ring-*`, `border-*`, `shadow-*`, `bg-*`, `text-*` are NOT focus indicators
- `data-[state=*]:bg-*` is NOT a focus indicator

## Token Reporting
- Detection shows EXACT matched tokens from source
- Outline removal tokens: `outline-none`, `focus:outline-none`, `focus-visible:outline-none`

## Debug
- Each A2 element includes `_a2Debug` field with: outlineRemoved, hasStrongReplacement, hasWeakFocusStyling, matchedTokens

## Key Design Decisions
- `focus:ring-1` / `focus-visible:ring-1` = PASS
- `focus:shadow-sm` = PASS
- Button with `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` = PASS (no A2)
- Input with `focus-visible:outline-none focus-visible:ring-2` = PASS (no A2)
- Menu item with `outline-none focus:bg-accent focus:text-accent-foreground` = Borderline
- CommandInput with just `outline-none` = Confirmed
