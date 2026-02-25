# Memory: features/analysis-rules/a2-focus-visibility
Updated: now

Rule A2 (Poor Focus Visibility) evaluates WCAG 2.4.7 with simplified severity logic:

## Classification (ZIP/GitHub — Deterministic)

**Pass (No violation):**
- No outline suppression detected (browser defaults preserved)
- OR outline removed + ANY focus-scoped strong replacement: `focus:ring-*`, `focus-visible:ring-*`, `focus:border-*`, `focus:shadow-*`, `focus:outline-*` (not outline-none)

**Borderline (Potential):**
- Outline removed + ONLY focus-scoped weak styling: `focus:bg-*`, `focus:text-*`, `focus:underline`, `focus:opacity-*`, `focus:font-*`
- Confidence: 60–75%

**Confirmed (Blocking):**
- Outline removed + NO focus-scoped replacement at all
- Bare (non-focus-prefixed) tokens like `ring-2`, `border-2`, `bg-accent` do NOT count as replacements
- Confidence: 90–95%

## CRITICAL: Focus-Scoped Only
- Only tokens starting with `focus:` or `focus-visible:` count as replacements
- Bare `ring-*`, `border-*`, `shadow-*`, `bg-*`, `text-*` are NOT focus indicators
- `data-[state=*]:bg-*` is NOT a focus indicator

## Token Reporting
- Detection shows EXACT matched tokens from source — no normalization or fabrication
- If source has `outline-none`, report `outline-none` (not `focus:outline-none`)

## Pre-filter
- File-level pre-filter REMOVED (was too aggressive, suppressed all A2 from files with any replacement)
- Classification is now per-finding only

## Debug
- Each A2 element includes `_a2Debug` field with: outlineRemoved, hasStrongReplacement, hasWeakFocusStyling, matchedTokens

## Screenshot (LLM-Assisted)
- Three-tier: Not Evaluated / Potential / Pass
- Never Confirmed from screenshot
- detectionMethod: 'llm_assisted'

## Key Design Decisions
- `focus:ring-1` is a PASS (valid replacement), not Potential
- `focus:shadow-sm` is a PASS (valid replacement), not Potential
- Only `focus:bg-*`/`focus:text-*` type changes are Borderline
- Bare ring-2, border-2, shadow-md WITHOUT focus prefix = Confirmed
