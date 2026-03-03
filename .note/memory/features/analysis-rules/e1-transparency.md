# E1 — Insufficient Transparency in High-Impact Actions

## Classification
- Always **Potential** (non-blocking) — Ethics rules are NEVER Confirmed
- Confidence range: 0.60–0.90

## Detection Scope (expanded)
E1 now covers ALL deletion flows across the app using three detection channels:

### A) Label-based detection
- Button/anchor text containing high-impact keywords: delete, remove, destroy, erase, subscribe, buy, purchase, pay, upgrade, checkout, etc.
- Icon buttons with `aria-label`/`title` containing high-impact keywords

### B) Handler-based detection
- `onClick`/`onSelect`/`onAction`/`onConfirm` handlers that directly call delete/remove/destroy functions
- Trash icon (`<Trash>`, `<Trash2>`) combined with delete handler in surrounding context

### C) Network-based detection
- `fetch(..., { method: "DELETE" })`, `axios.delete()`, `apiRequest("DELETE", ...)`
- Delete mutations (`deleteMutation`, `useMutation` with DELETE method)
- Handler functions (`handleDelete`, `deleteItem`, etc.) that call network DELETE without confirmation gate

## Confirmation Gate Detection — FLOW-LOCAL (suppresses E1)
**CRITICAL**: Confirmation gates are detected in the LOCAL region (~500 chars) around each candidate trigger, NOT at file level. This prevents unrelated Dialog/AlertDialog components (e.g., add/edit dialogs) from falsely suppressing deletion findings.

- AlertDialog / ConfirmDialog / DeleteConfirmDialog components (in local scope)
- `window.confirm()` / `confirm()`
- Two-step state flows: `setPendingDelete(id)`, `setConfirmOpen(true)`, `setConfirmDelete(true)`, etc.
- Type-to-confirm friction: `type "DELETE" to confirm`
- Checkbox acknowledgement: `<Checkbox>` with "understand"/"irreversible"/"permanent"
- Double-confirm patterns: "Are you sure?", "This will permanently..."

**NOTE**: Bare `Dialog` is intentionally excluded from confirmation patterns — too broad (matches add/edit dialogs).

## Recovery Suppression (also flow-local)
- Undo mechanisms: `toast({ action: "undo" })`, undo button
- Soft-delete: `archive`, `restore`, `undelete`, `moved to trash`
- API endpoints: `/archive`, `/disable`, `/deactivate` (when UI label is NOT "delete")

## Disclosure Pass-through
If strong disclosure terms ("cannot be undone", "irreversible", "permanently") AND a confirmation gate exist together in the local region, the finding is suppressed.

## Auth-flow Exclusion
Files matching auth patterns (forgot-password, sign-in, etc.) are excluded unless they contain destructive/billing keywords.

## Confidence Model
- **0.85–0.90**: DELETE request + direct UI trigger + no confirmation gate
- **0.70–0.80**: Delete intent inferred from handler name or label but request/gate linkage is weaker
- **0.60–0.65**: Partial disclosure exists but confirmation is missing

## Debug Logging
The extraction function logs:
- `[E1 DEBUG] files=N candidates: label=N handler=N network=N icon=N`
- `[E1 DEBUG] suppressed: confirmGate=N recovery=N disclosure=N auth=N`
- `[E1 DEBUG] emitted=N bundles=N`

## Deduplication
- Same label in same file → merged (one entry)
- Handler-based detection skipped if label-based already captured same action
- Network-based detection skipped if handler/label already captured
- Trash icon detection skipped if handler-based already captured

## E1ElementSubItem Fields
- `elementLabel`, `elementType`, `location`, `startLine`, `deleteLine`
- `detection`, `evidence`, `evidenceTokens`, `recommendedFix`
- `confidence`, `evaluationMethod`, `detectionSource` (label/handler/network/icon)
- `deduplicationKey`
