# Memory: features/analysis-rules/u1-primary-action
Updated: now

Rule U1 (Unclear Primary Action) identifies task-oriented primary action ambiguity using a deterministic context-gating model (Form, Dialog, or CTA cluster). Generic labels like 'Next' or 'Continue' (U1.3) are suppressed if the UI provides sufficient context via a labeled stepper (3+ steps with active indicators) or a strong contextual heading (h1-h3/bold typography) within ~30 lines. U1.1 (Missing submit) is the only 'Confirmed' sub-check; U1.2 (Competing CTAs) and U1.3 are 'Potential'. Reporting follows the Element -> Detection -> Evidence layout, with confirmed findings excluding 'Advisory Guidance' to maintain severity consistency. Confidence (0.40–0.75) reflects structural signal strength.

**Same-task suppression**: Multiple buttons leading to the same user task (e.g., "Compose" in header + "Send your first message" in empty state) are treated as redundant entry points and suppressed. Only truly competing actions (different tasks) trigger U1.

**Screenshot confidence gate**: Screenshot U1 findings require confidence ≥ 70% to be reported. Below that threshold, findings are suppressed as speculative.
