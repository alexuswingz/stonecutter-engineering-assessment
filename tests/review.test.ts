import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { AS_OF, PERIOD_END, PERIOD_START, openDatabase } from '../src/database.ts';
import { EXPORTS_DIR, loadExports } from '../src/exports.ts';
import { listScopes } from '../src/metrics.ts';
import { clientReport, getCase, listCases, openCase, ReviewError, saveDecision, type ReviewDeps } from '../src/review/service.ts';
import { openReviewStore } from '../src/review/store.ts';

/** Isolated copies only: an in-memory copy of the source snapshot and a throwaway review store.
 * The bundled database and exports are never modified. */
async function withDeps(run: (deps: ReviewDeps) => Promise<void>, storeDir: string | null = null): Promise<void> {
  const db = await openDatabase(true);
  const store = await openReviewStore(storeDir);
  try { await run({ db, store, exports: await loadExports() }); }
  finally { await store.close(); await db.close(); }
}

const rejects = (promise: Promise<unknown>, code: string, status: number) => assert.rejects(promise, (error: unknown) => {
  assert.ok(error instanceof ReviewError, `expected a ReviewError, got ${error}`);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  return true;
});

test('a saved decision survives a restart and the case reopens with its evidence', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'review-store-'));
  const storeDir = path.join(directory, 'store');
  try {
    let fingerprint = '';
    await withDeps(async deps => {
      const opened = await openCase(deps, 'cedar-coast', 'US');
      assert.equal(opened.case.status, 'open');
      fingerprint = opened.fingerprint;
      const saved = await saveDecision(deps, 'cedar-coast', 'US', {
        decision: 'hold', reason: 'Only a partial report exists for the week.', evidenceFingerprint: fingerprint,
      });
      assert.equal(saved.case.status, 'decided');
    }, storeDir);

    // "Restart": new connections to the same store directory and a fresh copy of the source data.
    await withDeps(async deps => {
      const reopened = await getCase(deps, 'cedar-coast', 'US');
      assert.equal(reopened.case.status, 'decided');
      const decision = reopened.case.decision!;
      assert.equal(decision.decision, 'hold');
      assert.equal(decision.budgetChangePct, 0);
      assert.equal(decision.reason, 'Only a partial report exists for the week.');
      assert.equal(decision.evidenceFingerprint, fingerprint);
      // Business scope, source identifiers, calculation/result and limitations are stored with it.
      const { evidence } = decision.snapshot;
      assert.deepEqual([evidence.brandId, evidence.marketplace, evidence.periodStart, evidence.expectedPeriodEnd], ['cedar-coast', 'US', PERIOD_START, PERIOD_END]);
      assert.equal(evidence.current.publisher?.publisherReportId, reopened.evidence.current.publisher?.publisherReportId);
      assert.equal(evidence.previous.selected?.reportId, reopened.evidence.previous.selected?.reportId);
      assert.equal(evidence.activeSubscriptions, reopened.evidence.activeSubscriptions);
      assert.equal(evidence.growthPct, null);
      assert.equal(decision.limitations.length, 1);
      assert.match(decision.limitations[0], /full-week figure .* not yet available/);
      assert.ok(decision.nextAction.length > 0);

      const list = await listCases(deps);
      assert.equal(list.cases.find(item => item.brandId === 'cedar-coast' && item.marketplace === 'US')?.caseStatus, 'decided');
      const report = await clientReport(deps, 'cedar-coast', 'US');
      assert.equal(report.decisionId, decision.decisionId);
      assert.equal(report.decision.action, 'hold');
      assert.equal(report.result.growthPct, null);
      assert.match(report.narrative, /not yet issued a complete report/);
      assert.deepEqual(report.limitations, decision.limitations);
    }, storeDir);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the backend rejects an expansion the evidence does not support, for every such scope, and still accepts a hold', async () => {
  await withDeps(async deps => {
    const { cases } = await listCases(deps);
    const unsupported = cases.filter(item => item.outcome.action === 'hold');
    assert.ok(unsupported.length > 0);
    for (const item of unsupported) {
      const { fingerprint } = await getCase(deps, item.brandId, item.marketplace);
      await rejects(saveDecision(deps, item.brandId, item.marketplace, { decision: 'expand_promotion', reason: 'Client asked for it.', evidenceFingerprint: fingerprint }), 'unsupported_decision', 422);
      assert.equal((await getCase(deps, item.brandId, item.marketplace)).case.decisionCount, 0); // nothing was stored
    }
    // The headline case: the inflated growth claim cannot be approved, and the error says why.
    const cedar = await getCase(deps, 'cedar-coast', 'US');
    await assert.rejects(
      saveDecision(deps, 'cedar-coast', 'US', { decision: 'expand_promotion', reason: 'Growth looks strong.', evidenceFingerprint: cedar.fingerprint }),
      (error: unknown) => error instanceof ReviewError && error.details.some(detail => /incomplete/.test(detail)));
    // A held decision can still be saved and reported, with the limitation and next action.
    const held = await saveDecision(deps, 'cedar-coast', 'US', { decision: 'hold', reason: 'Waiting for the complete report.', evidenceFingerprint: cedar.fingerprint });
    assert.equal(held.case.status, 'decided');
    const report = await clientReport(deps, 'cedar-coast', 'US');
    assert.equal(report.limitations.length, 1);
    assert.match(report.nextAction, /complete report/);
  });
});

test('healthy control: a supported 10% expansion is saved and reported; any other percentage is refused', async () => {
  await withDeps(async deps => {
    const control = await openCase(deps, 'lumen-home', 'US');
    assert.equal(control.quality.status, 'ready');
    assert.equal(control.outcome.expansionSupported, true);
    await rejects(saveDecision(deps, 'lumen-home', 'US', { decision: 'expand_promotion', budgetChangePct: 20, reason: 'Partner asked for 20%.', evidenceFingerprint: control.fingerprint }), 'unsupported_decision', 422);
    const saved = await saveDecision(deps, 'lumen-home', 'US', { decision: 'expand_promotion', reason: 'Complete, reconciled weeks and growth above threshold.', evidenceFingerprint: control.fingerprint });
    assert.equal(saved.case.decision?.budgetChangePct, 10);
    const report = await clientReport(deps, 'lumen-home', 'US');
    assert.equal(report.result.growthPct, 15);
    assert.equal(report.result.activeSubscriptions, control.evidence.current.publisher?.activeSubscriptions);
    assert.deepEqual([report.decision.action, report.decision.budgetChangePct], ['expand_promotion', 10]);
    assert.deepEqual(report.limitations, []);
    assert.equal(report.sources.length, 2);
  });
});

test('invalid requests are rejected with a reason, and a report needs a decision', async () => {
  await withDeps(async deps => {
    const { fingerprint } = await getCase(deps, 'orbit-pet', 'US');
    await rejects(saveDecision(deps, 'orbit-pet', 'US', null), 'invalid_input', 400);
    await rejects(saveDecision(deps, 'orbit-pet', 'US', { decision: 'hold', reason: '   ', evidenceFingerprint: fingerprint }), 'invalid_input', 400);
    await rejects(saveDecision(deps, 'orbit-pet', 'US', { decision: 'hold', reason: 'No change week over week.' }), 'invalid_input', 400);
    await rejects(saveDecision(deps, 'orbit-pet', 'US', { decision: 'hold', reason: 'No change.', evidenceFingerprint: 'not-the-current-evidence' }), 'evidence_changed', 409);
    await rejects(clientReport(deps, 'orbit-pet', 'US'), 'no_decision', 409);
    await rejects(getCase(deps, 'orbit-pet', 'ZZ'), 'unknown_scope', 404);
    await rejects(getCase(deps, 'no-such-brand', 'US'), 'unknown_scope', 404);
  });
});

/** Simulates the publisher issuing a complete report for the reporting week and our import loading it:
 * rows are added to an in-memory database copy and to a temporary copy of the exports. */
async function publishCompleteReport(db: PGlite, exportsDir: string, brandId: string, marketplace: string, extraPerOffer: number): Promise<void> {
  const { rows: [latest] } = await db.query<{ report_id: string; revision: number; publisher_report_id: string; offers: number; total: number }>(`
    SELECT r.report_id, r.revision, r.publisher_report_id, r.declared_offer_count AS offers, r.declared_active_subscriptions AS total
    FROM raw.subscription_reports r WHERE brand_id = $1 AND marketplace = $2 AND period_start = $3::date
    ORDER BY revision DESC LIMIT 1`, [brandId, marketplace, PERIOD_START]);
  const reportId = `${latest.report_id}-complete`, publisherId = `${latest.publisher_report_id}-complete`;
  const total = latest.total + extraPerOffer * latest.offers;
  await db.query(`INSERT INTO raw.subscription_reports VALUES ($1, $2, $3, $4::date, $5::date, $6, 'complete', $7::timestamptz, $8, $9::timestamptz, $10, $11)`,
    [reportId, brandId, marketplace, PERIOD_START, PERIOD_END, latest.revision + 1, '2026-10-06T10:00:00Z', publisherId, '2026-10-06T09:00:00Z', latest.offers, total]);
  await db.query(`INSERT INTO raw.subscription_offers SELECT $1, offer_id, asin, active_subscriptions + $2 FROM raw.subscription_offers WHERE report_id = $3`,
    [reportId, extraPerOffer, latest.report_id]);
  const { rows: offers } = await db.query<{ offer_id: string; asin: string; active_subscriptions: number }>(
    'SELECT offer_id, asin, active_subscriptions FROM raw.subscription_offers WHERE report_id = $1', [reportId]);
  await appendFile(path.join(exportsDir, 'subscription_reports.csv'),
    `${publisherId},${brandId},${marketplace},${PERIOD_START},${PERIOD_END},complete,2026-10-06T09:00:00Z,,${latest.offers},${total}\n`);
  await appendFile(path.join(exportsDir, 'subscription_offers.csv'),
    offers.map(offer => `${publisherId},${offer.offer_id},${offer.asin},${offer.active_subscriptions}`).join('\n') + '\n');
}

test('when evidence changes, a saved decision needs attention: no report, no silent reuse, and revalidation restores it', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'review-exports-'));
  try {
    await cp(EXPORTS_DIR, directory, { recursive: true });
    await withDeps(async deps => {
      const before = await openCase(deps, 'cedar-coast', 'US');
      await saveDecision(deps, 'cedar-coast', 'US', { decision: 'hold', reason: 'Only a partial report exists for the week.', evidenceFingerprint: before.fingerprint });
      assert.equal((await clientReport(deps, 'cedar-coast', 'US')).result.growthPct, null);
      const untouched = await openCase(deps, 'orbit-pet', 'US');
      await saveDecision(deps, 'orbit-pet', 'US', { decision: 'hold', reason: 'No change week over week.', evidenceFingerprint: untouched.fingerprint });

      // Changed input: the complete report arrives, 5 subscriptions higher per offer than the last partial.
      await publishCompleteReport(deps.db, directory, 'cedar-coast', 'US', 5);
      const changed: ReviewDeps = { ...deps, exports: await loadExports(directory) };

      const after = await getCase(changed, 'cedar-coast', 'US');
      assert.equal(after.case.status, 'needs_attention');
      assert.notEqual(after.fingerprint, before.fingerprint);
      assert.ok(after.case.changes.some(change => change.startsWith('Reporting week coverage: partial')));
      assert.equal(after.case.decision?.decision, 'hold'); // the old decision is kept as history, not as current truth
      assert.equal(after.evidence.current.complete, true);
      assert.equal(after.evidence.growthPct, 15.38);       // (7,800 -> 9,000) from the new complete report
      assert.equal(after.quality.status, 'ready');
      assert.equal((await listCases(changed)).cases.find(item => item.brandId === 'cedar-coast')?.caseStatus, 'needs_attention');

      // The stale decision cannot produce a report, and a decision quoting the old evidence is refused.
      await rejects(clientReport(changed, 'cedar-coast', 'US'), 'needs_attention', 409);
      await rejects(saveDecision(changed, 'cedar-coast', 'US', { decision: 'expand_promotion', reason: 'Growth confirmed.', evidenceFingerprint: before.fingerprint }), 'evidence_changed', 409);

      // Revalidation: a new decision against the current evidence. Expansion is now supported.
      const revalidated = await saveDecision(changed, 'cedar-coast', 'US', { decision: 'expand_promotion', reason: 'Complete report received; growth above threshold.', evidenceFingerprint: after.fingerprint });
      assert.equal(revalidated.case.status, 'decided');
      assert.equal(revalidated.case.decisionCount, 2);
      const report = await clientReport(changed, 'cedar-coast', 'US');
      assert.equal(report.result.growthPct, 15.38);
      assert.equal(report.decision.budgetChangePct, 10);

      // A scope whose evidence did not change keeps its decision.
      assert.equal((await getCase(changed, 'orbit-pet', 'US')).case.status, 'decided');
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an imported report the publisher has not published blocks the growth claim', async () => {
  await withDeps(async deps => {
    const directory = await mkdtemp(path.join(tmpdir(), 'review-unpublished-'));
    try {
      await cp(EXPORTS_DIR, directory, { recursive: true });
      await publishCompleteReport(deps.db, directory, 'cedar-coast', 'US', 5);
      // deps.exports is still the bundled export: the publisher does not list the new report.
      const item = await getCase(deps, 'cedar-coast', 'US');
      assert.equal(item.quality.status, 'insufficient');
      assert.ok(item.quality.checks.some(check => check.code === 'publisher_current' && !check.passed));
      assert.equal(item.outcome.action, 'hold');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

test('the case list covers every brand and marketplace in the data', async () => {
  await withDeps(async deps => {
    const scopes = await listScopes(deps.db);
    const list = await listCases(deps);
    assert.equal(list.period.asOf, AS_OF);
    assert.deepEqual(list.cases.map(item => `${item.brandId}/${item.marketplace}`), scopes.map(scope => `${scope.brandId}/${scope.marketplace}`));
    assert.ok(list.cases.every(item => item.caseStatus === 'not_opened'));
    assert.ok(list.cases.some(item => item.issues === 0)); // at least one clean scope
    assert.ok(list.cases.some(item => item.blocking > 0)); // and at least one that is blocked
  });
});
