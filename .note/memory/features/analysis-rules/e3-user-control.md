# Memory: features/analysis-rules/e3-user-control
Updated: now

Rule E3 (Structural Absence of Exit Control for High-Impact Actions) detects ONLY structural absence of exit, cancellation, or reversal mechanisms for high-impact/irreversible actions. Always classified as Potential (non-blocking).

## Scope
E3 triggers ONLY when:
1. **High-Impact Action Gate** (Required): Delete, remove, permanently delete, destroy, confirm payment, pay, subscribe, deactivate account, close account, or destructive/danger button variants.
2. **Structural Control Absence** (Required): No cancel, back, close, undo, decline, dismiss, breadcrumb, onClose handler, or escape handler exists near the high-impact action.

## What E3 Does NOT Evaluate (Overlap Prevention)
- Visual bias between cancel/confirm buttons → belongs to E2
- Missing consequence/transparency text → belongs to E1
- Multi-step wizard usability or step indicators → belongs to U4
- Forced marketing opt-ins or consent checkboxes → belongs to E1

## Sub-checks
- **E3.D1**: High-impact action in Modal/Dialog without structural exit (confidence: 0.78)
- **E3.D2**: High-impact action in Form/Page without cancel/exit (confidence: 0.70)

## Suppression Rules
- ANY structural exit (cancel, back, close, undo, decline, dismiss, breadcrumb, onClose, onDismiss, onOpenChange, DialogClose, AlertDialogCancel, escape handler) → SUPPRESS entirely
- Cancel exists but visually weaker → E2, suppress E3
- Consequence text missing but cancel exists → E1, suppress E3
- Step indicators/wizard navigation → U4, suppress E3
- No high-impact action present → skip E3 evaluation entirely

## Confidence
- Cap: 0.80 (never exceed)
- 0.75–0.80: High-impact destructive action + no structural exit
- 0.65–0.75: Likely missing exit but partial ambiguity
- Below 0.65: Suppress finding

## Modalities
- **Code (ZIP/GitHub)**: Deterministic high-impact gate + structural exit check, with optional LLM validation (hybrid)
- **Screenshot**: LLM-only perceptual evaluation — trigger only if high-impact CTA visible AND no cancel/close/back visible in same region

## UI
- Single aggregated E3 card per analysis
- Advisory header: "Analysis flagged potential restriction of user control; verify structural exit mechanisms for high-impact actions."
- No corrective prompts generated
