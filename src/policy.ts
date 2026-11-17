import { formatCount, formatDay, formatPct, formatRange } from './format.ts';
import type { Document } from './knowledge.ts';
import type { Evidence, PolicyOutcome, Quality, Recommendation } from './types.ts';

/** Authorized application behavior (DATA_DICTIONARY.md, "Reporting and recommendation policy").
 * This module, not the model and not an operational note, decides what may be recommended. */
export const GROWTH_THRESHOLD_PCT = 10;
export const EXPANSION_PCT = 10;

export function supportedOutcome(evidence: Evidence, quality: Quality): PolicyOutcome {
  const failed = quality.checks.filter(check => check.blocking && !check.passed);
  const blockers = failed.map(check => `${check.title}: ${check.detail}`);
  if (evidence.growthPct !== null && evidence.growthPct < GROWTH_THRESHOLD_PCT) {
    blockers.push(`Verified growth of ${formatPct(evidence.growthPct)} is below the ${GROWTH_THRESHOLD_PCT}% needed to suggest an expansion.`);
  } else if (evidence.growthPct === null && failed.length === 0) {
    blockers.push('No comparable weekly growth figure is available.');
  }
  const expansionSupported = quality.status === 'ready' && blockers.length === 0;
  const nextAction = failed.find(check => check.action)?.action
    ?? (expansionSupported
      ? `Send the ${EXPANSION_PCT}% expansion suggestion to the brand manager; it stays a draft until they confirm.`
      : "Keep the current promotion and review again with next week's report.");
  return {
    action: expansionSupported ? 'expand_promotion' : 'hold',
    budgetChangePct: expansionSupported ? EXPANSION_PCT : 0,
    expansionSupported, blockers, nextAction,
  };
}

function describe(action: string, pct: number): string {
  return action === 'expand_promotion' ? `a ${pct}% expansion` : 'holding the promotion';
}

/** The model is a third-party provider: its proposal is accepted only when it equals the action
 * the policy authorizes for the verified evidence. Retrieved notes are context, never authority. */
export function validateProposal(proposal: Recommendation, outcome: PolicyOutcome, documents: Document[]): { accepted: boolean; notes: string[] } {
  const shapeValid = ['expand_promotion', 'hold'].includes(proposal.action) && Number.isFinite(proposal.budgetChangePct);
  if (!shapeValid) return { accepted: false, notes: ['Model output rejected: not a recognised action or percentage.'] };
  const accepted = proposal.action === outcome.action && proposal.budgetChangePct === outcome.budgetChangePct;
  const notes = [accepted
    ? `The model proposed ${describe(proposal.action, proposal.budgetChangePct)}, which is what the policy authorizes for this evidence.`
    : `The model proposed ${describe(proposal.action, proposal.budgetChangePct)}; the policy authorizes ${describe(outcome.action, outcome.budgetChangePct)} for this evidence. Proposal rejected.`];
  const cited = documents.filter(document => proposal.citations.includes(document.id));
  if (!accepted && cited.length) {
    notes.push(`The proposal relied on ${cited.map(document => `${document.id} (${document.source})`).join(', ')}. Notes supply campaign context; they cannot change figures, caveats or the authorized action.`);
  }
  return { accepted, notes };
}

/** Client-facing wording built only from verified figures and the authorized outcome. */
export function policyNarrative(evidence: Evidence, quality: Quality, outcome: PolicyOutcome): string {
  const week = formatRange(evidence.periodStart, evidence.expectedPeriodEnd);
  const now = evidence.activeSubscriptions, before = evidence.previousSubscriptions, growth = evidence.growthPct;
  let result: string;
  if (now === null) {
    result = `A verified subscription figure for ${week} is not available yet.`;
  } else if (!evidence.current.complete) {
    const through = evidence.current.verifiedThrough;
    result = `The latest snapshot shows ${formatCount(now)} active subscriptions${through ? ` through ${formatDay(through)}` : ''}. The publisher has not yet issued a complete report for ${week}, so a week-over-week comparison is not available.`;
  } else if (growth === null) {
    result = `Active subscriptions were ${formatCount(now)} for ${week}. A comparable figure for the week before is not available, so no growth rate is stated.`;
  } else {
    const movement = growth === 0 ? 'unchanged from' : `${growth > 0 ? 'up' : 'down'} ${Math.abs(growth).toFixed(2)}% from`;
    result = `Active subscriptions were ${formatCount(now)} for ${week}, ${movement} ${formatCount(before)} the week before.`;
  }
  if (outcome.expansionSupported) {
    return `${result} This supports a suggested ${outcome.budgetChangePct}% expansion of the subscription promotion, subject to brand manager approval.`;
  }
  const why = quality.status !== 'ready' ? 'until the underlying data is complete and reconciled'
    : growth !== null ? `because growth is below the ${GROWTH_THRESHOLD_PCT}% threshold for an expansion` : 'until a comparable figure is available';
  return `${result} We recommend holding the subscription promotion at its current level ${why}.`;
}
