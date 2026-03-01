/**
 * Cross-Rule Suppression Engine
 *
 * Runs AFTER per-rule aggregation, BEFORE final response assembly.
 * Operates on aggregated violation cards (one per rule+status).
 * Removes sub-items from subordinate rules when a dominant rule already
 * covers the same element, as determined by S1–S10 pairwise rules and
 * a global A* > E* > U* priority fallback.
 *
 * Suppressed items are NOT deleted; they are attached as `suppressedElements`
 * metadata on the kept violation card for auditing.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface SuppressionMeta {
  suppressedBy: string;    // rule_id of the dominant rule (e.g., "A5")
  rationale: string;       // human-readable reason
  appliedRule: string;     // "S1" | "S2" | ... | "fallback"
}

export interface SuppressedElement {
  ruleId: string;
  deduplicationKey: string;
  elementLabel: string;
  location: string;
  meta: SuppressionMeta;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Normalize a location/filePath to a comparable key */
function normLocation(loc: string | undefined): string {
  if (!loc) return '';
  // Strip line-range suffixes and whitespace
  return loc.replace(/:\\d+(-\\d+)?$/, '').trim().toLowerCase();
}

/** Extract element fingerprints from a violation's sub-items array */
function getElements(violation: any): any[] {
  const ruleId = (violation.ruleId || '').toUpperCase();
  const key = `${ruleId[0]?.toLowerCase() || ''}${ruleId.slice(1)}Elements`;
  // e.g., a5Elements, u1Elements, e2Elements
  return violation[key] || [];
}

function setElements(violation: any, elements: any[]): void {
  const ruleId = (violation.ruleId || '').toUpperCase();
  const key = `${ruleId[0]?.toLowerCase() || ''}${ruleId.slice(1)}Elements`;
  violation[key] = elements;
}

/** Build a fingerprint from an element for matching across rules */
function elementFingerprint(el: any): string {
  const loc = normLocation(el.location || el.filePath || '');
  const label = (el.elementLabel || '').toLowerCase().trim();
  const hint = (el.selectorHint || el.evidence || '').toLowerCase().slice(0, 60);
  return `${loc}|${label}|${hint}`;
}

/** Check if two elements refer to the same UI artifact */
function sameElement(elA: any, elB: any): boolean {
  // Fast: identical deduplication keys
  if (elA.deduplicationKey && elB.deduplicationKey &&
      elA.deduplicationKey === elB.deduplicationKey) return true;

  // Location must match
  const locA = normLocation(elA.location || elA.filePath);
  const locB = normLocation(elB.location || elB.filePath);
  if (!locA || !locB || locA !== locB) return false;

  // Check element identity overlap (label, type, selector, line range)
  const labelA = (elA.elementLabel || '').toLowerCase();
  const labelB = (elB.elementLabel || '').toLowerCase();
  if (labelA && labelB && labelA === labelB) return true;

  // Check selector/hint overlap
  const hintA = (elA.selectorHint || elA.evidence || '').toLowerCase().slice(0, 80);
  const hintB = (elB.selectorHint || elB.evidence || '').toLowerCase().slice(0, 80);
  if (hintA && hintB && (hintA.includes(hintB) || hintB.includes(hintA))) return true;

  // Check elementKey (A5 uses this)
  if (elA.elementKey && elB.elementKey && elA.elementKey === elB.elementKey) return true;

  return false;
}

function hasTag(el: any, tag: string): boolean {
  const tags: string[] = el.root_cause_tags || el.rootCauseTags || [];
  return tags.some((t: string) => t.toLowerCase().includes(tag.toLowerCase()));
}

function reasonIncludes(el: any, ...terms: string[]): boolean {
  const haystack = [
    el.detection || '', el.evidence || '', el.explanation || '',
    el.diagnosis || '', el.subCheck || '', el.subCheckLabel || '',
  ].join(' ').toLowerCase();
  return terms.some(t => haystack.includes(t.toLowerCase()));
}

function isFormControl(el: any): boolean {
  const t = (el.elementType || el.controlType || el.elementTag || '').toLowerCase();
  return ['input', 'select', 'textarea', 'switch', 'checkbox', 'radio', 'slider'].some(c => t.includes(c));
}

// ─── Category priority ──────────────────────────────────────────────

function categoryPriority(ruleId: string): number {
  const prefix = ruleId.charAt(0).toUpperCase();
  if (prefix === 'A') return 3; // highest
  if (prefix === 'E') return 2;
  return 1; // U*
}

/** Intra-category specificity: higher = more specific, kept over less specific */
const SPECIFICITY: Record<string, number> = {
  A5: 6, A3: 5, A6: 4, A2: 3, A4: 2, A1: 1,
  E2: 3, E3: 2, E1: 1,
  U3: 6, U4: 5, U2: 4, U6: 3, U5: 2, U1: 1,
};

// ─── Pairwise Suppression Rules ──────────────────────────────────────

interface PairwiseRule {
  id: string;
  dominant: string;
  subordinate: string;
  match: (domEl: any, subEl: any) => boolean;
  rationale: string;
}

const PAIRWISE_RULES: PairwiseRule[] = [
  // S1: A5 suppresses A6 on same form-control element
  {
    id: 'S1', dominant: 'A5', subordinate: 'A6',
    match: (a5El, a6El) =>
      sameElement(a5El, a6El) &&
      (isFormControl(a5El) || isFormControl(a6El) || hasTag(a5El, 'missing_label') || hasTag(a6El, 'missing_label')),
    rationale: 'A5 (missing form label) is the root cause; A6 (accessible name) is a downstream effect on the same form control.',
  },
  // S2: A3 suppresses A2 on same element with keyboard issue
  {
    id: 'S2', dominant: 'A3', subordinate: 'A2',
    match: (a3El, a2El) =>
      sameElement(a3El, a2El) &&
      (reasonIncludes(a3El, 'not_focusable', 'not_reachable', 'keyboard_unreachable', 'tabindex', 'onClick without') ||
       hasTag(a3El, 'keyboard_unreachable')),
    rationale: 'A3 (keyboard operability) is the root cause; if the element is not keyboard-reachable, focus visibility (A2) is moot.',
  },
  // S3: A1 suppresses U6 on same element (contrast causes grouping confusion)
  {
    id: 'S3', dominant: 'A1', subordinate: 'U6',
    match: (a1El, u6El) =>
      sameElement(a1El, u6El) &&
      (hasTag(a1El, 'contrast_causes_grouping') || hasTag(u6El, 'contrast_causes_grouping') ||
       reasonIncludes(u6El, 'contrast', 'low contrast', 'color distinction')),
    rationale: 'A1 (contrast) is the root cause; U6 grouping confusion is a downstream effect of poor contrast.',
  },
  // S4: A3 suppresses U2 on same navigation element
  {
    id: 'S4', dominant: 'A3', subordinate: 'U2',
    match: (a3El, u2El) =>
      sameElement(a3El, u2El) &&
      reasonIncludes(a3El, 'keyboard_unreachable', 'focus_trap', 'tab_order', 'not_focusable', 'navigation'),
    rationale: 'A3 (keyboard operability) on a navigation element supersedes U2 (navigation clarity) for the same element.',
  },
  // S5: U4 suppresses U1 when recall is needed for action
  {
    id: 'S5', dominant: 'U4', subordinate: 'U1',
    match: (u4El, u1El) =>
      sameElement(u4El, u1El) &&
      (hasTag(u4El, 'recall_needed_for_action') ||
       reasonIncludes(u4El, 'hidden option', 'memorize', 'recall', 'remember')),
    rationale: 'U4 (recognition-to-recall regression) is the root cause; U1 (primary action clarity) is a downstream effect.',
  },
  // S6: U3 suppresses U6 on same element (overflow/truncation)
  {
    id: 'S6', dominant: 'U3', subordinate: 'U6',
    match: (u3El, u6El) =>
      sameElement(u3El, u6El) &&
      (hasTag(u3El, 'overflow_truncation') || hasTag(u6El, 'overflow_truncation') ||
       reasonIncludes(u3El, 'truncat', 'clip', 'ellipsis', 'scroll', 'overflow')),
    rationale: 'U3 (truncated content) is the root cause; U6 (grouping/layout) confusion is a downstream effect of clipping.',
  },
  // S7: E2 suppresses U1 in same decision point
  {
    id: 'S7', dominant: 'E2', subordinate: 'U1',
    match: (e2El, u1El) =>
      sameElement(e2El, u1El) &&
      (reasonIncludes(e2El, 'visual', 'imbalance', 'primary', 'emphasized', 'dominant', 'secondary', 'de-emphasized')),
    rationale: 'E2 (manipulative choice architecture) subsumes U1 (primary action) when the imbalance is the core ethical concern.',
  },
  // S8: E2 suppresses E1 in same flow (manipulation over disclosure)
  {
    id: 'S8', dominant: 'E2', subordinate: 'E1',
    match: (e2El, e1El) =>
      sameElement(e2El, e1El) &&
      (hasTag(e2El, 'manipulation_over_disclosure') ||
       reasonIncludes(e2El, 'manipulat', 'choice', 'imbalance', 'nudge')),
    rationale: 'E2 (manipulative choice architecture) is central; E1 (transparency) is a secondary disclosure concern in the same flow.',
  },
  // S9: E3 suppresses U2 when restricted exit/control
  {
    id: 'S9', dominant: 'E3', subordinate: 'U2',
    match: (e3El, u2El) =>
      sameElement(e3El, u2El) &&
      (hasTag(e3El, 'restricted_control') ||
       reasonIncludes(e3El, 'restricted', 'no cancel', 'no exit', 'no back', 'missing exit')),
    rationale: 'E3 (restricted user control) is the root cause; U2 (navigation) is a downstream effect of restricted exit.',
  },
  // S10: E2 suppresses E3 ONLY when E3 is visual hiding (not functional restriction)
  //      If E3 is functional restriction, E3 keeps and E2 suppressed (handled by reverse check)
  {
    id: 'S10', dominant: 'E2', subordinate: 'E3',
    match: (e2El, e3El) =>
      sameElement(e2El, e3El) &&
      !reasonIncludes(e3El, 'functional', 'missing exit', 'no cancel', 'structural absence', 'no close') &&
      reasonIncludes(e3El, 'visual', 'hidden', 'obscured', 'de-emphasized'),
    rationale: 'E3 is merely visual hiding (not functional restriction); E2 (choice architecture) is the dominant ethical rule.',
  },
];

// S10 reverse: E3 suppresses E2 when E3 is functional restriction
const S10_REVERSE: PairwiseRule = {
  id: 'S10-rev', dominant: 'E3', subordinate: 'E2',
  match: (e3El, e2El) =>
    sameElement(e3El, e2El) &&
    reasonIncludes(e3El, 'functional', 'missing exit', 'no cancel', 'structural absence', 'no close'),
  rationale: 'E3 is functional restriction (not just visual hiding); E3 takes precedence over E2.',
};

// ─── Main Suppression Function ───────────────────────────────────────

/**
 * Apply cross-rule suppression to aggregated violation cards.
 * Each violation has sub-items (e.g., a5Elements, u1Elements).
 * Suppression removes individual sub-items from subordinate rules
 * when a dominant rule covers the same element.
 *
 * Returns the filtered violations (empty cards removed) plus
 * all suppressed elements for auditing.
 */
export function applyCrossRuleSuppression(violations: any[]): {
  kept: any[];
  suppressedElements: SuppressedElement[];
} {
  const suppressedElements: SuppressedElement[] = [];

  // Build a map: ruleId -> violation object
  const byRule = new Map<string, any>();
  for (const v of violations) {
    const rid = (v.ruleId || '').toUpperCase();
    // If multiple cards for same rule (e.g., confirmed + potential), merge for matching
    if (!byRule.has(rid)) {
      byRule.set(rid, []);
    }
    byRule.get(rid)!.push(v);
  }

  // Track which (deduplication keys) to remove from which rule
  const toRemove = new Map<string, Set<string>>(); // ruleId -> set of dedup keys to remove

  function markRemoval(ruleId: string, dedupKey: string, meta: SuppressionMeta, el: any) {
    const rid = ruleId.toUpperCase();
    if (!toRemove.has(rid)) toRemove.set(rid, new Set());
    toRemove.get(rid)!.add(dedupKey);
    suppressedElements.push({
      ruleId: rid,
      deduplicationKey: dedupKey,
      elementLabel: el.elementLabel || '',
      location: el.location || '',
      meta,
    });
  }

  // Apply S1–S10 pairwise rules
  const allPairwise = [...PAIRWISE_RULES, S10_REVERSE];
  for (const rule of allPairwise) {
    const domCards = byRule.get(rule.dominant.toUpperCase()) || [];
    const subCards = byRule.get(rule.subordinate.toUpperCase()) || [];
    if (domCards.length === 0 || subCards.length === 0) continue;

    for (const domCard of domCards) {
      const domElements = getElements(domCard);
      for (const subCard of subCards) {
        const subElements = getElements(subCard);
        for (const subEl of subElements) {
          const dedupKey = subEl.deduplicationKey || elementFingerprint(subEl);
          // Already marked?
          if (toRemove.get(rule.subordinate.toUpperCase())?.has(dedupKey)) continue;

          for (const domEl of domElements) {
            if (rule.match(domEl, subEl)) {
              markRemoval(rule.subordinate, dedupKey, {
                suppressedBy: rule.dominant,
                rationale: rule.rationale,
                appliedRule: rule.id,
              }, subEl);
              break; // One match is enough
            }
          }
        }
      }
    }
  }

  // Fallback: global priority A* > E* > U* for same-element overlap not caught by pairwise
  const allCards = violations.filter(v => v.ruleId);
  for (let i = 0; i < allCards.length; i++) {
    for (let j = i + 1; j < allCards.length; j++) {
      const rA = (allCards[i].ruleId || '').toUpperCase();
      const rB = (allCards[j].ruleId || '').toUpperCase();
      if (rA === rB) continue;

      const prioA = categoryPriority(rA);
      const prioB = categoryPriority(rB);
      if (prioA === prioB) {
        // Intra-category: higher specificity wins
        const specA = SPECIFICITY[rA] || 0;
        const specB = SPECIFICITY[rB] || 0;
        if (specA === specB) continue;
        // Determine dominant/subordinate
        const [domCard, subCard] = specA > specB ? [allCards[i], allCards[j]] : [allCards[j], allCards[i]];
        const domRid = (domCard.ruleId || '').toUpperCase();
        const subRid = (subCard.ruleId || '').toUpperCase();
        checkFallbackOverlap(domCard, subCard, domRid, subRid);
      } else {
        const [domCard, subCard] = prioA > prioB ? [allCards[i], allCards[j]] : [allCards[j], allCards[i]];
        const domRid = (domCard.ruleId || '').toUpperCase();
        const subRid = (subCard.ruleId || '').toUpperCase();
        checkFallbackOverlap(domCard, subCard, domRid, subRid);
      }
    }
  }

  function checkFallbackOverlap(domCard: any, subCard: any, domRid: string, subRid: string) {
    const domElements = getElements(domCard);
    const subElements = getElements(subCard);
    // Skip if the dominant rule itself has elements being suppressed by pairwise rules
    const domRemoveSet = toRemove.get(domRid);
    for (const subEl of subElements) {
      const dedupKey = subEl.deduplicationKey || elementFingerprint(subEl);
      if (toRemove.get(subRid)?.has(dedupKey)) continue; // already handled
      for (const domEl of domElements) {
        // Skip dominant elements that were themselves suppressed by a pairwise rule
        const domKey = domEl.deduplicationKey || elementFingerprint(domEl);
        if (domRemoveSet?.has(domKey)) continue;
        if (sameElement(domEl, subEl)) {
          markRemoval(subRid, dedupKey, {
            suppressedBy: domRid,
            rationale: `Global priority: ${domRid} (${categoryPriority(domRid) === 3 ? 'Accessibility' : categoryPriority(domRid) === 2 ? 'Ethics' : 'Usability'}) takes precedence over ${subRid}.`,
            appliedRule: 'fallback',
          }, subEl);
          break;
        }
      }
    }
  }

  // Apply removals: filter sub-items and remove empty cards
  const kept: any[] = [];
  for (const v of violations) {
    const rid = (v.ruleId || '').toUpperCase();
    const removeSet = toRemove.get(rid);
    if (!removeSet || removeSet.size === 0) {
      kept.push(v);
      continue;
    }

    const elements = getElements(v);
    const filteredElements = elements.filter((el: any) => {
      const key = el.deduplicationKey || elementFingerprint(el);
      return !removeSet.has(key);
    });

    if (filteredElements.length === 0) {
      // Entire card suppressed — don't include
      continue;
    }

    // Update the card with filtered elements
    setElements(v, filteredElements);

    // Update element count badge if present
    if (v.diagnosis && typeof v.diagnosis === 'string') {
      v.diagnosis = v.diagnosis.replace(/\\d+ (element|item|risk|finding|action)/i, `${filteredElements.length} $1`);
    }

    kept.push(v);
  }

  if (suppressedElements.length > 0) {
    console.log(`Cross-rule suppression: ${suppressedElements.length} element(s) suppressed across ${new Set(suppressedElements.map(s => s.ruleId)).size} rule(s)`);
    for (const s of suppressedElements) {
      console.log(`  ${s.ruleId} "${s.elementLabel}" suppressed by ${s.meta.suppressedBy} (${s.meta.appliedRule}): ${s.meta.rationale.slice(0, 80)}`);
    }
  }

  return { kept, suppressedElements };
}
