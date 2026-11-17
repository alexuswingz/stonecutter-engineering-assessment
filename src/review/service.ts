import type { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { analyseMany } from '../analyst.ts';
import { AS_OF, PERIOD_END, PERIOD_START, PREVIOUS_START } from '../database.ts';
import type { PublisherExports } from '../exports.ts';
import { formatCount, formatDay, formatPct } from '../format.ts';
import type { Document } from '../knowledge.ts';
import { addDays, listScopes, type Scope } from '../metrics.ts';
import { actionSentence, EXPANSION_PCT, resultSentence } from '../policy.ts';
import type { Action, Report, WeekEvidence } from '../types.ts';
import type {
  CaseList, CaseReview, CaseState, CaseStatus, CaseSummary, ClientReport, DecisionInput, DecisionSnapshot, Period, SavedDecision, ScopeInfo,
} from './types.ts';

/** Review workflow: open a case, save a decision, reopen it, generate the client report.
 * Every rule that protects a decision lives here, behind the route handlers, so it holds
 * whatever the client sends. The service reads source data and writes only to the review store. */

export interface ReviewDeps {
  /** Source database (read only here). */
  db: PGlite;
  /** Review store (see store.ts). */
  store: PGlite;
  exports: PublisherExports;
  /** Overrides retrieval of operational notes; used by tests. */
  documents?: Document[];
}

export class ReviewError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly details: string[] = []) {
    super(message);
    this.name = 'ReviewError';
  }
}

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;
const MAX_TEXT = 2000;

export function reviewPeriod(): Period {
  return { periodStart: PERIOD_START, periodEnd: PERIOD_END, previousStart: PREVIOUS_START, previousEnd: addDays(PREVIOUS_START, 6), asOf: AS_OF };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Identity of the evidence a decision rests on: every source report and figure, each check result
 * and the authorized outcome. Any change to these yields a different fingerprint. */
export function evidenceFingerprint({ evidence, quality, outcome }: DecisionSnapshot): string {
  const week = (item: WeekEvidence) => ({
    pipeline: item.pipeline, selected: item.selected, publisher: item.publisher, reports: item.reports,
    verified: item.verifiedActiveSubscriptions ?? null, through: item.verifiedThrough ?? null, complete: item.complete ?? false,
  });
  return createHash('sha256').update(canonical({
    scope: [evidence.brandId, evidence.marketplace, evidence.periodStart, evidence.expectedPeriodEnd, evidence.asOf],
    current: week(evidence.current), previous: week(evidence.previous), growthPct: evidence.growthPct,
    checks: quality.checks.map(check => [check.code, check.week, check.passed]), status: quality.status,
    outcome: [outcome.action, outcome.budgetChangePct],
    context: [evidence.netSales, evidence.adSpend, evidence.attributedAdSales, evidence.inventoryUnits],
  })).digest('hex');
}

function describeAction(action: Action, pct: number): string {
  return action === 'expand_promotion' ? `${pct}% expansion` : 'hold';
}

/** Human-readable differences between the evidence a decision was saved against and the evidence now. */
function describeChanges(saved: DecisionSnapshot, now: DecisionSnapshot): string[] {
  const coverage = (week: WeekEvidence) => (week.complete ? 'complete week' : week.verifiedThrough ? `partial through ${formatDay(week.verifiedThrough)}` : 'no report');
  const source = (week: WeekEvidence) => week.publisher?.publisherReportId ?? week.selected?.publisherReportId ?? 'none';
  const rows: [string, string, string][] = [
    ['Reporting week figure', formatCount(saved.evidence.activeSubscriptions), formatCount(now.evidence.activeSubscriptions)],
    ['Reporting week coverage', coverage(saved.evidence.current), coverage(now.evidence.current)],
    ['Reporting week source', source(saved.evidence.current), source(now.evidence.current)],
    ['Comparison week figure', formatCount(saved.evidence.previousSubscriptions), formatCount(now.evidence.previousSubscriptions)],
    ['Comparison week source', source(saved.evidence.previous), source(now.evidence.previous)],
    ['Week-over-week change', formatPct(saved.evidence.growthPct), formatPct(now.evidence.growthPct)],
    ['Evidence status', saved.quality.status, now.quality.status],
    ['Supported action', describeAction(saved.outcome.action, saved.outcome.budgetChangePct), describeAction(now.outcome.action, now.outcome.budgetChangePct)],
  ];
  const changes = rows.filter(([, before, after]) => before !== after).map(([label, before, after]) => `${label}: ${before} → ${after}`);
  return changes.length ? changes : ['Supporting evidence changed (source report details or context figures).'];
}

const caseIdFor = (scope: Scope) => `${scope.brandId}:${scope.marketplace}:${PERIOD_START}`;

interface DecisionRow {
  decision_id: number; decided_at: string; decision: Action; budget_change_pct: number; reason: string;
  next_action: string; limitations: string[]; evidence_fingerprint: string; snapshot: DecisionSnapshot;
}

async function loadCaseState(store: PGlite, caseId: string, now: DecisionSnapshot, fingerprint: string): Promise<CaseState> {
  const { rows: [opened] } = await store.query<{ opened_at: string; decisions: number }>(
    `SELECT to_char(opened_at, ${UTC}) AS opened_at, (SELECT count(*)::int FROM review_decisions d WHERE d.case_id = c.case_id) AS decisions
     FROM review_cases c WHERE case_id = $1`, [caseId]);
  if (!opened) return { caseId, status: 'not_opened', openedAt: null, decision: null, decisionCount: 0, changes: [] };
  const { rows: [row] } = await store.query<DecisionRow>(
    `SELECT decision_id::int AS decision_id, to_char(decided_at, ${UTC}) AS decided_at, decision, budget_change_pct, reason,
            next_action, limitations, evidence_fingerprint, snapshot
     FROM review_decisions WHERE case_id = $1 ORDER BY decision_id DESC LIMIT 1`, [caseId]);
  if (!row) return { caseId, status: 'open', openedAt: opened.opened_at, decision: null, decisionCount: 0, changes: [] };
  const decision: SavedDecision = {
    decisionId: row.decision_id, decidedAt: row.decided_at, decision: row.decision, budgetChangePct: row.budget_change_pct,
    reason: row.reason, nextAction: row.next_action, limitations: row.limitations,
    evidenceFingerprint: row.evidence_fingerprint, snapshot: row.snapshot,
  };
  // A saved decision is only as good as the evidence it quoted. Compare on every read.
  const current = decision.evidenceFingerprint === fingerprint;
  const status: CaseStatus = current ? 'decided' : 'needs_attention';
  return { caseId, status, openedAt: opened.opened_at, decision, decisionCount: opened.decisions, changes: current ? [] : describeChanges(decision.snapshot, now) };
}

async function resolveScope(deps: ReviewDeps, brandId: string, marketplace: string): Promise<Scope> {
  const scopes = await listScopes(deps.db);
  const scope = scopes.find(item => item.brandId === brandId && item.marketplace === marketplace);
  if (!scope) {
    throw new ReviewError('unknown_scope', 404, `No data for brand "${brandId}" in marketplace "${marketplace}".`,
      scopes.map(item => `${item.brandId} / ${item.marketplace}`));
  }
  return scope;
}

async function toReview(deps: ReviewDeps, scope: Scope, report: Report): Promise<CaseReview> {
  const snapshot: DecisionSnapshot = { evidence: report.evidence, quality: report.quality, outcome: report.outcome };
  const fingerprint = evidenceFingerprint(snapshot);
  const info: ScopeInfo = { ...scope, ...reviewPeriod() };
  return {
    scope: info, ...snapshot, recommendation: report.recommendation,
    model: {
      proposal: report.trace.proposal, accepted: report.trace.proposalAccepted, notes: report.trace.validation,
      documents: report.trace.context.documents.map(document => ({ id: document.id, source: document.source })),
    },
    fingerprint, case: await loadCaseState(deps.store, caseIdFor(scope), snapshot, fingerprint),
  };
}

async function review(deps: ReviewDeps, brandId: string, marketplace: string): Promise<{ scope: Scope; review: CaseReview }> {
  const scope = await resolveScope(deps, brandId, marketplace);
  const [report] = await analyseMany(deps.db, [scope], deps.exports, deps.documents);
  return { scope, review: await toReview(deps, scope, report) };
}

/** All scopes in the data with what the pipeline reported, what the sources support and the case status. */
export async function listCases(deps: ReviewDeps): Promise<CaseList> {
  const scopes = await listScopes(deps.db);
  const reports = await analyseMany(deps.db, scopes, deps.exports, deps.documents);
  const cases: CaseSummary[] = [];
  for (const [index, scope] of scopes.entries()) {
    const item = await toReview(deps, scope, reports[index]);
    const failed = item.quality.checks.filter(check => !check.passed);
    const lead = failed.find(check => check.blocking) ?? failed[0];
    cases.push({
      ...scope,
      pipeline: { current: item.evidence.current.pipeline?.activeSubscriptions ?? null, growthPct: item.evidence.pipelineGrowthPct ?? null },
      verified: {
        current: item.evidence.activeSubscriptions, growthPct: item.evidence.growthPct,
        complete: item.evidence.current.complete ?? false, through: item.evidence.current.verifiedThrough ?? null,
      },
      qualityStatus: item.quality.status, issues: failed.length, blocking: failed.filter(check => check.blocking).length,
      headline: lead?.title ?? 'Reconciles with the publisher',
      outcome: { action: item.outcome.action, budgetChangePct: item.outcome.budgetChangePct },
      caseStatus: item.case.status,
      decision: item.case.decision && { decision: item.case.decision.decision, budgetChangePct: item.case.decision.budgetChangePct, decidedAt: item.case.decision.decidedAt },
    });
  }
  return { period: reviewPeriod(), cases };
}

/** Read a case without changing anything. */
export async function getCase(deps: ReviewDeps, brandId: string, marketplace: string): Promise<CaseReview> {
  return (await review(deps, brandId, marketplace)).review;
}

/** Open the case for a scope and the reporting period. Idempotent: reopening returns the saved case. */
export async function openCase(deps: ReviewDeps, brandId: string, marketplace: string): Promise<CaseReview> {
  const { scope, review: item } = await review(deps, brandId, marketplace);
  if (item.case.status !== 'not_opened') return item;
  await deps.store.query(
    'INSERT INTO review_cases (case_id, brand_id, marketplace, period_start, period_end) VALUES ($1, $2, $3, $4::date, $5::date) ON CONFLICT (case_id) DO NOTHING',
    [caseIdFor(scope), scope.brandId, scope.marketplace, PERIOD_START, PERIOD_END]);
  return (await review(deps, brandId, marketplace)).review;
}

/** Save a decision. Evidence is recomputed here; nothing the client sends is trusted for figures.
 * Rejects: malformed input (400), a decision made against evidence that has since changed (409),
 * and an expansion the evidence does not support (422). A hold can always be saved. */
export async function saveDecision(deps: ReviewDeps, brandId: string, marketplace: string, input: Partial<DecisionInput> | null): Promise<CaseReview> {
  const decision = input?.decision;
  if (decision !== 'hold' && decision !== 'expand_promotion') {
    throw new ReviewError('invalid_input', 400, 'Choose a decision: hold the promotion or approve the expansion.');
  }
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw new ReviewError('invalid_input', 400, 'Give a reason for the decision. It is saved with the case and shown in the client report.');
  if (reason.length > MAX_TEXT) throw new ReviewError('invalid_input', 400, `Keep the reason under ${MAX_TEXT} characters.`);
  if (typeof input?.evidenceFingerprint !== 'string' || !input.evidenceFingerprint) {
    throw new ReviewError('invalid_input', 400, 'The decision must quote the evidence it was made against. Reload the case and try again.');
  }

  const { scope, review: item } = await review(deps, brandId, marketplace);
  if (input.evidenceFingerprint !== item.fingerprint) {
    throw new ReviewError('evidence_changed', 409, 'The evidence changed after this case was loaded. Reload the case and review the current evidence before deciding.');
  }
  if (decision === 'expand_promotion' && !item.outcome.expansionSupported) {
    throw new ReviewError('unsupported_decision', 422, 'A promotion expansion is not supported by the evidence. The case can be saved as a hold.', item.outcome.blockers);
  }
  const budgetChangePct = decision === 'expand_promotion' ? EXPANSION_PCT : 0;
  if (input.budgetChangePct !== undefined && input.budgetChangePct !== budgetChangePct) {
    throw new ReviewError('unsupported_decision', 422, `The policy authorizes ${describeAction(decision, budgetChangePct)} only, not ${input.budgetChangePct}%.`);
  }
  const nextAction = (typeof input.nextAction === 'string' && input.nextAction.trim()) || item.outcome.nextAction;
  if (nextAction.length > MAX_TEXT) throw new ReviewError('invalid_input', 400, `Keep the next action under ${MAX_TEXT} characters.`);
  const limitations = item.quality.checks.filter(check => check.blocking && !check.passed).map(check => check.clientNote ?? check.detail);
  const snapshot: DecisionSnapshot = { evidence: item.evidence, quality: item.quality, outcome: item.outcome };

  await deps.store.transaction(async tx => {
    await tx.query(
      'INSERT INTO review_cases (case_id, brand_id, marketplace, period_start, period_end) VALUES ($1, $2, $3, $4::date, $5::date) ON CONFLICT (case_id) DO NOTHING',
      [caseIdFor(scope), scope.brandId, scope.marketplace, PERIOD_START, PERIOD_END]);
    await tx.query(
      `INSERT INTO review_decisions (case_id, decision, budget_change_pct, reason, next_action, limitations, evidence_fingerprint, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)`,
      [caseIdFor(scope), decision, budgetChangePct, reason, nextAction, JSON.stringify(limitations), item.fingerprint, JSON.stringify(snapshot)]);
  });
  return (await review(deps, brandId, marketplace)).review;
}

function reportHeadline(snapshot: DecisionSnapshot, action: Action): string {
  const { evidence } = snapshot;
  if (evidence.activeSubscriptions === null) return 'Verified subscription figure not yet available; promotion held';
  if (!evidence.current.complete) return 'Full-week subscription figure not yet available; promotion held';
  const growth = evidence.growthPct;
  const movement = growth === null ? 'Subscriptions reported without a comparable prior week'
    : growth === 0 ? 'Subscriptions unchanged week over week' : `Subscriptions ${growth > 0 ? 'up' : 'down'} ${Math.abs(growth).toFixed(2)}% week over week`;
  return `${movement}; ${action === 'expand_promotion' ? `${EXPANSION_PCT}% promotion expansion suggested` : 'promotion held'}`;
}

/** The client report is generated from the saved decision and the evidence frozen with it, and only
 * while that evidence is still current. It never reuses an approval the evidence no longer supports. */
export async function clientReport(deps: ReviewDeps, brandId: string, marketplace: string): Promise<ClientReport> {
  const { review: item } = await review(deps, brandId, marketplace);
  const saved = item.case.decision;
  if (!saved) throw new ReviewError('no_decision', 409, 'Save a review decision before generating the client report.');
  if (item.case.status === 'needs_attention') {
    throw new ReviewError('needs_attention', 409, 'The evidence changed after this decision was saved, so the report is withheld. Reopen the case and save a new decision.', item.case.changes);
  }
  const { evidence, quality, outcome } = saved.snapshot;
  const sources = ([['Reporting week', evidence.current], ['Comparison week', evidence.previous]] as const).flatMap(([week, facts]) => {
    const source = facts.publisher ?? facts.selected;
    return source ? [{ week, publisherReportId: source.publisherReportId, status: source.status, periodEnd: source.periodEnd }] : [];
  });
  return {
    scope: item.scope, decisionId: saved.decisionId, decidedAt: saved.decidedAt, evidenceFingerprint: saved.evidenceFingerprint,
    headline: reportHeadline(saved.snapshot, saved.decision),
    narrative: `${resultSentence(evidence)} ${actionSentence(evidence, quality, outcome, saved.decision)}`,
    result: {
      activeSubscriptions: evidence.activeSubscriptions, complete: evidence.current.complete ?? false,
      through: evidence.current.verifiedThrough ?? null, previousSubscriptions: evidence.previousSubscriptions, growthPct: evidence.growthPct,
    },
    decision: {
      action: saved.decision, budgetChangePct: saved.budgetChangePct, reason: saved.reason,
      label: saved.decision === 'expand_promotion' ? `Suggest a ${saved.budgetChangePct}% promotion expansion` : 'Hold the promotion at its current level',
    },
    limitations: saved.limitations, nextAction: saved.nextAction,
    context: { netSales: evidence.netSales, roas: evidence.roas, inventoryUnits: evidence.inventoryUnits },
    sources,
  };
}
