# Memory: features/analysis-rules/a2-focus-visibility
Updated: now

Rule A2 (Poor Focus Visibility) evaluates WCAG 2.4.7 with simplified severity logic:

## Classification (ZIP/GitHub — Deterministic)

**Pass (No violation):**
- No outline suppression detected (browser defaults preserved)
- OR outline removed + ANY strong replacement: `focus:ring-*` (any width incl. ring-1), `focus:border-*`, `focus:shadow-*`, `focus:outline-*` (not outline-none)

**Borderline (Potential):**
- Outline removed + ONLY weak focus styling: `focus:bg-*`, `focus:text-*`, `focus:underline`, `focus:opacity-*`, `focus:font-*`
- Confidence: 60–75%

**Confirmed (Blocking):**
- Outline removed + NO replacement at all
- Confidence: 90–95%

## Token Reporting
- Detection shows EXACT matched tokens from source — no normalization or fabrication
- If source has `outline-none`, report `outline-none` (not `focus:outline-none`)
- No deduplication of bare vs prefixed tokens

## Screenshot (LLM-Assisted)
- Three-tier: Not Evaluated / Potential / Pass
- Never Confirmed from screenshot
- detectionMethod: 'llm_assisted'

## Key Design Decisions
- `focus:ring-1` is a PASS (valid replacement), not Potential
- `focus:shadow-sm` is a PASS (valid replacement), not Potential
- Only `focus:bg-*`/`focus:text-*` type changes are Borderline
- Pre-filter scans source files for className strings with outline-none + replacement
