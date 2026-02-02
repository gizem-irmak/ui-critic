# Memory: features/analysis-rules/a1-contrast-v12-reliability-gate

Updated: just now

Rule A1 (Insufficient Text Contrast) uses a **robust reliability gate** for screenshot inputs to prevent false positives from blocking convergence.

## Design Principle

**Screenshots are a source of truth for visual properties.**
Only reliable measurements can block convergence; unreliable measurements become advisory Potential Risks.

## Reliability Gate (All Checks Must Pass)

| Check | Threshold | Action if Failed |
|-------|-----------|------------------|
| Foreground variance | stddev(luminance) > 15 | Mark UNRELIABLE |
| Background variance | stddev(luminance) > 20 | Mark UNRELIABLE |
| Cluster separation | gap < 20 luminance units | Mark UNRELIABLE |
| Cluster overlap | pixels fall between clusters | Mark UNRELIABLE |
| Multi-sample consistency | ratios differ > ±0.2 | Mark UNRELIABLE |
| Background is gradient/image | visual check | Mark UNRELIABLE |
| Foreground ≈ background | clusters too similar | Mark UNRELIABLE |

## Multi-Sample Consistency Check (New)

1. Sample pixels and compute contrast ratio
2. Repeat sampling with 2-5px offset, 3 times total
3. If max ratio difference > 0.2, mark as UNRELIABLE
4. Example: [3.1, 3.3, 3.2] → diff=0.2 → RELIABLE
5. Example: [3.1, 3.8, 2.9] → diff=0.9 → UNRELIABLE

## Classification Rules

| Reliability | Status | Blocks Convergence | Confidence |
|-------------|--------|-------------------|------------|
| All checks pass | confirmed | YES | 85–95% |
| Any check fails | potential | NO | 50–70% |
| Ratio 4.3-4.5:1 | borderline | NO (advisory) | 65–75% |

## Confirmed Violation (Reliable)

When ALL reliability checks pass:
- `samplingMethod: "pixel"`
- `status: "confirmed"`
- Report `contrastRatio`, `foregroundHex`, `backgroundHex` (RAW sampled, not palette-mapped)
- Verification: "Contrast ratio computed from sampled screenshot pixels."
- **Blocks convergence if ratio < threshold**

## Potential Risk (Unreliable)

When ANY reliability check fails:
- `samplingMethod: "inferred"`
- `status: "potential"`
- `potentialRiskReason`: Specific failure reason (e.g., "Multi-sample consistency failed: ratios differed by 0.4")
- `advisoryGuidance`: "Upload a PNG at 100% zoom or verify with DevTools/axe for accurate measurement."
- NO exact `contrastRatio` or hex values
- Diagnosis: "Ratio not computed (unreliable sampling)."
- **NEVER blocks convergence**

## Convergence Behavior

- Only `status: "confirmed"` violations count toward threshold
- `status: "potential"` findings are advisory and never block convergence
- This prevents infinite iterations where A1 repeats despite UI updates

## Forbidden Behaviors

- Do NOT map sampled colors to Tailwind tokens or "nearest palette color"
- Do NOT output Confirmed ratio when ANY reliability check fails
- Do NOT say "Exact color values cannot be determined from a screenshot"
- Do NOT assign high confidence (>70%) to unreliable findings

## ZIP / GitHub Inputs

Always `samplingMethod: "inferred"`, `status: "potential"`, 50–70% confidence.
Static code analysis cannot access rendered pixels.
