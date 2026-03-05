# Memory: features/analysis-rules/u5-interaction-feedback
Updated: 2026-03-05

Rule U5 (Insufficient Interaction Feedback) is a modality-aware hybrid usability rule.

## Screenshot Modality — DISABLED (Not Evaluated)
U5 is **completely disabled** for screenshot inputs. It is classified as:
- `status: "informational"` (Not Evaluated)
- `category: "Rules Not Evaluated (Input Limitation)"`
- No detection logic runs; U5 is excluded from the LLM prompt entirely.
- Reason: "Interaction feedback such as loading states, button disabling, or progress indicators occurs during runtime interaction and cannot be reliably assessed from static screenshots."
- Advisory: "Upload source code or provide interaction recordings to evaluate feedback mechanisms during user actions."

## Code Modality (ZIP/GitHub) — Active
Uses a deterministic-first pass with three sub-checks:
- U5.D1: Async handlers lacking loading/disabled feedback
- U5.D2: Form submissions missing success/error feedback
- U5.D3: Toggles lacking ARIA states
- Logic: Async detection includes React Query (mutate), Hook Form (handleSubmit), and standard Promise/setTimeout patterns.
- If deterministic signals are inconclusive but an interaction handler exists, falls back to LLM assessment (hybrid_llm_fallback).
- Confidence: 0.65–0.85 for code based on signal strength.
- Always classified as Potential (non-blocking).
