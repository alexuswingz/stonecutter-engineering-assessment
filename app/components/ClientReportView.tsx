'use client';

import Link from 'next/link';
import { api, casePath, caseUrl, useResource } from '../lib/api.ts';
import { formatCount, formatDateTime, formatDay, formatMoney, formatPct, formatRange } from '../../src/format.ts';
import type { ClientReport } from '../../src/review/types.ts';
import { ErrorState, Skeleton } from './ui.tsx';

/** The client report. It exists only as a rendering of a saved decision whose evidence is still current;
 * otherwise this page explains why there is no report and sends the reviewer back to the case. */
export function ClientReportView({ brandId, marketplace }: { brandId: string; marketplace: string }) {
  const caseHref = casePath(brandId, marketplace);
  const report = useResource<ClientReport>(`report:${brandId}/${marketplace}`, () => api<ClientReport>(`${caseUrl(brandId, marketplace)}/report`));

  return (
    <main className="page report">
      <div className="row no-print" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <Link href={caseHref} className="crumb" style={{ margin: 0 }}>← Back to the case</Link>
        {report.status === 'ready' && <button type="button" className="btn" onClick={() => window.print()}>Print or save as PDF</button>}
      </div>

      {report.status === 'loading' && (
        <div className="card report-doc" aria-busy="true">
          <p className="muted" role="status">Generating the report from the saved decision…</p>
          <Skeleton lines={5} />
        </div>
      )}

      {report.status === 'error' && (
        <ErrorState
          title={report.error.code === 'no_decision' ? 'No report yet: this case has no saved decision'
            : report.error.code === 'needs_attention' ? 'Report withheld: the evidence changed after the decision'
            : report.error.code === 'unknown_scope' ? 'There is no case for this brand and marketplace'
            : 'The report could not be generated'}
          error={report.error}
          onRetry={['no_decision', 'needs_attention', 'unknown_scope'].includes(report.error.code) ? undefined : report.reload}>
          <Link href={report.error.code === 'unknown_scope' ? '/' : caseHref} className="btn primary">
            {report.error.code === 'unknown_scope' ? 'Back to all cases' : 'Go to the case'}
          </Link>
        </ErrorState>
      )}

      {report.status === 'ready' && <Document report={report.data} />}
    </main>
  );
}

function Document({ report }: { report: ClientReport }) {
  const { scope, result } = report;
  const expand = report.decision.action === 'expand_promotion';
  return (
    <article className="card report-doc">
      <header>
        <span className="eyebrow">Weekly subscription report · {scope.marketplace} marketplace</span>
        <h1>{scope.brandName}</h1>
        <span className="muted">Week of {formatRange(scope.periodStart, scope.periodEnd)} · data as of {formatDateTime(scope.asOf)}</span>
      </header>

      <section>
        <p className="lead"><strong>{report.headline}.</strong></p>
        <p className="lead" style={{ marginTop: 8 }}>{report.narrative}</p>
      </section>

      <section className="kpis" aria-label="Key figures">
        <div className="kpi">
          <span className="label">Active subscriptions</span>
          <span className="value">{formatCount(result.activeSubscriptions)}</span>
          {result.complete
            ? <span className="label">week ending {formatDay(scope.periodEnd)}</span>
            : <span className="note">{result.through ? `Snapshot through ${formatDay(result.through)}, not a full week` : 'No verified figure yet'}</span>}
        </div>
        <div className="kpi">
          <span className="label">Week before</span>
          <span className="value">{formatCount(result.previousSubscriptions)}</span>
          <span className="label">{formatRange(scope.previousStart, scope.previousEnd)}</span>
        </div>
        <div className="kpi">
          <span className="label">Week-over-week change</span>
          <span className={`value${result.growthPct === null ? ' text' : ''}`}>{formatPct(result.growthPct)}</span>
          <span className="label">{result.growthPct === null ? 'needs two complete weeks' : 'complete week vs complete week'}</span>
        </div>
      </section>

      <section>
        <h2>Recommendation</h2>
        <div className={`callout${expand ? '' : ' hold'}`}>
          <strong>{report.decision.label}</strong>
          <span>{report.decision.reason}</span>
          {expand && <span className="muted small">This is a suggestion for the brand manager to approve; nothing has been changed.</span>}
        </div>
      </section>

      {report.limitations.length > 0 && (
        <section>
          <h2>What we cannot confirm yet</h2>
          <ul>{report.limitations.map(item => <li key={item}>{item}</li>)}</ul>
        </section>
      )}

      <section>
        <h2>Next step</h2>
        <p>{report.nextAction}</p>
      </section>

      <section>
        <h2>Supporting context for the week</h2>
        <dl className="kv">
          <div><dt>Net sales</dt><dd>{formatMoney(report.context.netSales)}</dd></div>
          <div><dt>ROAS (attributed)</dt><dd>{report.context.roas === null ? 'Undefined' : report.context.roas.toFixed(2)}</dd></div>
          <div><dt>Inventory units</dt><dd>{formatCount(report.context.inventoryUnits)}</dd></div>
        </dl>
      </section>

      <footer>
        <span>Sources: {report.sources.map(source => `${source.week.toLowerCase()} ${source.publisherReportId} (${source.status}, through ${formatDay(source.periodEnd)})`).join('; ') || 'none'}.</span>
        <span>Generated from review decision #{report.decisionId}, saved {formatDateTime(report.decidedAt)}. Evidence fingerprint {report.evidenceFingerprint.slice(0, 12)}.</span>
        <span>Active subscriptions are a snapshot of product-offer enrollments, not unique customers or orders.</span>
      </footer>
    </article>
  );
}
