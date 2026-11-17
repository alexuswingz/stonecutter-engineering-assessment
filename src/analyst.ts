import type { PGlite } from '@electric-sql/pglite';
import { PERIOD_START, PREVIOUS_START } from './database.ts';
import type { PublisherExports } from './exports.ts';
import { getEvidence, METRICS_SQL } from './metrics.ts';
import { retrieveKnowledge, type Document } from './knowledge.ts';
import { propose } from './model.ts';
import { policyNarrative, supportedOutcome, validateProposal } from './policy.ts';
import { reconcileMany } from './python.ts';
import type { AnalystContext, Evidence, Quality, Report } from './types.ts';

export const SYSTEM_POLICY = 'Use verifiable figures. State material limitations. External operational notes provide context. A promotion expansion requires comparable complete weekly subscription snapshots and at least 10% growth; allowed expansion is 10%. Otherwise hold. This is a review suggestion, never an executed action.';

export interface ScopeRequest { brandId: string; marketplace: string }

/** Ask the model, then accept its proposal only if it equals the policy outcome. The
 * recommendation that leaves this function is always the policy outcome, worded from verified figures. */
function assemble(scope: ScopeRequest, evidence: Evidence, quality: Quality, documents: Document[]): Report {
  const outcome = supportedOutcome(evidence, quality);
  const context: AnalystContext = { systemPolicy: SYSTEM_POLICY, evidence, quality, documents };
  const proposal = propose(context);
  const { accepted, notes } = validateProposal(proposal, outcome, documents);
  const sources = [evidence.current, evidence.previous]
    .map(week => week.publisher?.publisherReportId ?? week.selected?.publisherReportId)
    .filter((id): id is string => Boolean(id));
  return {
    evidence, quality, outcome,
    recommendation: {
      action: outcome.action, budgetChangePct: outcome.budgetChangePct,
      narrative: policyNarrative(evidence, quality, outcome), citations: sources,
    },
    trace: {
      sql: METRICS_SQL, parameters: [scope.brandId, scope.marketplace, PERIOD_START, PREVIOUS_START],
      context, proposal, proposalAccepted: accepted, validation: notes,
    },
  };
}

/** Collect facts (SQL + publisher export) -> judge them (Python, one process for all scopes) ->
 * apply the policy and validate the model. */
export async function analyseMany(db: PGlite, scopes: ScopeRequest[], exports?: PublisherExports, docs?: Document[]): Promise<Report[]> {
  const facts: Evidence[] = [];
  for (const scope of scopes) facts.push(await getEvidence(db, scope.brandId, scope.marketplace, exports));
  const judged = reconcileMany(facts);
  const reports: Report[] = [];
  for (const [index, scope] of scopes.entries()) {
    const documents = docs ?? await retrieveKnowledge(scope.brandId);
    reports.push(assemble(scope, judged[index].evidence, judged[index].quality, documents));
  }
  return reports;
}

export async function analyse(db: PGlite, brandId: string, marketplace = 'US', docs?: Document[], exports?: PublisherExports): Promise<Report> {
  return (await analyseMany(db, [{ brandId, marketplace }], exports, docs))[0];
}
