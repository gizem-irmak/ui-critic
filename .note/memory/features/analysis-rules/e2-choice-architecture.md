# Memory: features/analysis-rules/e2-choice-architecture
Updated: now

Rule E2 (Imbalanced Choice Architecture in High-Impact Decisions) is narrowly scoped to prevent false positives on standard UI patterns.

## Classification
- Always **Potential** (non-blocking). Never Confirmed.
- Confidence: 0.55–0.65 (weak signals), 0.65–0.75 (strong signals + clear high-impact context). Cap at **0.75**.
- No corrective prompts. Advisory only.

## High-Impact Gate (Required)
E2 is suppressed entirely unless the choice cluster appears in a high-impact domain context. Required keywords nearby (~40 lines / same container):
- **Consent/privacy:** accept, decline, cookie, consent, tracking, personalization, privacy, data, share
- **Monetization:** subscribe, trial, upgrade, buy, purchase, payment, card
- **Account conversion:** sign up/register ONLY if paired with consent/monetization cues
- **Irreversible:** delete, remove, cancel plan, confirm, submit, cannot be undone

## Imbalance Signal Scoring (Require 2+)
E2 requires 2 or more deterministic imbalance signals to pass to LLM evaluation:
1. **Visual dominance** — primary bg-* vs ghost/link/outline alternative
2. **Size asymmetry** — w-full/px-8 vs text-sm/text-xs
3. **Language bias** — positive accept ("Yes, continue") vs negative/shaming decline ("No, I hate saving money")
4. **Default selection** — defaultChecked, pre-selected
5. **Ambiguous alternative** — "Learn more" as only exit (no explicit decline)

## Exclusions (Must NOT Flag)
- Standard "Sign Up" (primary) + "Sign In" (secondary) on landing pages
- Navigation links vs auth buttons
- Standard marketing layout without consent/monetization context
- Role-based dashboard actions
- Both options clearly visible and accessible, even if styled differently

## Implementation
- **Code modality:** Deterministic bundle extraction with high-impact gate and signal scoring runs BEFORE LLM. Only passing bundles are sent to LLM for final assessment.
- **Screenshot modality:** LLM prompt instructs high-impact gate and 2+ signal requirement.
- **Post-processing:** Confidence capped at 0.75 across all modalities.
- Tests: `supabase/functions/analyze-zip/e2-classification.test.ts` (28 tests).
