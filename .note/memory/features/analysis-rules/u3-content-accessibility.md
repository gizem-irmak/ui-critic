# Memory: features/analysis-rules/u3-content-accessibility
Updated: now

Rule U3 (Truncated or Inaccessible Content) evaluates content visibility via hybrid detection, reported as Potential only.

## Strict Three-Gate Architecture (v2)
All U3 sub-checks (D1–D5) must pass three deterministic gates before emitting a finding:

**Gate 1 — Content Risk**: Only emit when content has meaningful truncation risk:
- Dynamic expression `{…}` present, OR inside `.map()` list rendering (contentKind: dynamic/list_mapped)
- Static text ≥ 28 chars OR ≥ 5 tokens (contentKind: static_long)
- Short static UI chrome ("Name", "Status", "Actions") is suppressed (contentKind: static_short)

**Gate 2 — Header/Label Suppression**: Suppress if element is inside `<thead>`/`<th>`, has role="columnheader", matches known header labels (Name, Status, Actions, Date, Doctor, etc.) with ≤16 chars, or has header styling (uppercase, tracking-wide, text-xs, font-medium) on short text.

**Gate 3 — Recovery Mechanism**: Detect title attributes, Tooltip/Popover/HoverCard/Dialog wrappers, overflow-scroll, aria-describedby, "Show more" links, click-to-detail handlers. Recovery signals lower confidence by 0.20.

## Confidence Scoring (Revised)
- Base: 0.45
- +0.15 if dynamic in list/map AND truncation utility
- +0.10 if truncation utility (truncate/line-clamp)
- +0.05 if field label suggests long values (address, reason, notes, etc.)
- -0.20 if header suspected
- -0.20 if recovery signal detected
- Capped to [0.40, 0.75]

## Sub-checks
- U3.D1: Line-clamp/truncate/text-ellipsis/whitespace-nowrap+overflow-hidden
- U3.D2: Fixed-height (h-*, max-h-*) + overflow-hidden without scroll
- U3.D3: Nested scroll traps
- U3.D4: Hidden content without control (excludes responsive variants, aria-hidden)
- U3.D5: Unbroken text overflow risk (carrier element scoping, semantic risk tiers)

## Enhanced Metadata (v2)
Each finding includes: contentKind, recoverySignals[], truncationTokens[], startLine/endLine for precise source attribution.
