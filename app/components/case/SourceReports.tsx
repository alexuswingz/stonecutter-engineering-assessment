'use client';

import { formatCount, formatDateTime, formatDay, formatRange } from '../../../src/format.ts';
import type { CaseReview } from '../../../src/review/types.ts';
import type { SourceReport, WeekEvidence } from '../../../src/types.ts';

const shortTime = (iso: string) => formatDateTime(iso).replace(' UTC', '');

function Roles({ report, publisherCurrent }: { report: SourceReport; publisherCurrent: string | null }) {
  return (
    <div className="tags">
      {report.selected && <span className="tag selected">Selected</span>}
      {report.usedByPipeline && <span className="tag pipeline">Pipeline used</span>}
      {report.publisherReportId === publisherCurrent && <span className="tag">Publisher current</span>}
      {report.supersededBy && <span className="tag superseded">Superseded</span>}
      {!report.knownToPublisher && <span className="tag superseded">Not in publisher export</span>}
    </div>
  );
}

function WeekTable({ title, range, week }: { title: string; range: string; week: WeekEvidence }) {
  const publisher = week.publisher;
  return (
    <div>
      <div className="section-title">
        <h3>{title} <span className="muted" style={{ fontWeight: 400 }}>· {range}</span></h3>
        <span className="muted small">{week.reports.length} imported {week.reports.length === 1 ? 'report' : 'reports'}</span>
      </div>
      {week.reports.length === 0 ? (
        <p className="card-body muted">No report for this week had been imported at the evaluation time.</p>
      ) : (
        <div className="table-wrap">
          <table className="sources">
            <thead>
              <tr>
                <th scope="col">Publisher report</th>
                <th scope="col">Coverage</th>
                <th scope="col">Generated (UTC)</th>
                <th scope="col" className="right">Offers loaded</th>
                <th scope="col" className="right">Subscriptions</th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {week.reports.map(report => {
                const offersShort = report.loadedOfferCount !== report.declaredOfferCount;
                const totalShort = report.loadedActiveSubscriptions !== report.declaredActiveSubscriptions;
                return (
                  <tr key={report.reportId} className={report.selected ? 'is-selected' : undefined}>
                    <td>
                      <span className="id">{report.publisherReportId}</span>
                      <span className="sub">{report.reportId} · revision {report.revision}</span>
                    </td>
                    <td>
                      {report.status === 'complete' ? 'Complete' : 'Partial'}
                      <span className="sub">through {formatDay(report.periodEnd)}</span>
                    </td>
                    <td className="num">
                      {shortTime(report.generatedAt)}
                      <span className="sub">imported {shortTime(report.extractedAt)}</span>
                    </td>
                    <td className="right num">
                      <span style={offersShort ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{formatCount(report.loadedOfferCount)}</span>
                      <span className="sub">of {formatCount(report.declaredOfferCount)} declared</span>
                    </td>
                    <td className="right num">
                      <span className="figure" style={totalShort ? { color: 'var(--bad)' } : undefined}>{formatCount(report.loadedActiveSubscriptions)}</span>
                      <span className="sub">of {formatCount(report.declaredActiveSubscriptions)} declared</span>
                    </td>
                    <td><Roles report={report} publisherCurrent={publisher?.publisherReportId ?? null} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="publisher-line">
        {publisher
          ? <><strong>Publisher export:</strong> {publisher.publisherReportId} is current · {publisher.status}, through {formatDay(publisher.periodEnd)} · {formatCount(publisher.offerCount)} offers · <strong className="num">{formatCount(publisher.activeSubscriptions)}</strong> subscriptions</>
          : <><strong>Publisher export:</strong> no report listed for this week, so the imported figure cannot be verified.</>}
      </p>
    </div>
  );
}

/** Source identifiers behind every figure: each imported report, what the pipeline used,
 * what the corrected selection picks and what the publisher lists as current. */
export function SourceReports({ review }: { review: CaseReview }) {
  const { scope, evidence } = review;
  return (
    <section className="card" aria-labelledby="sources-title">
      <div className="card-head">
        <h2 id="sources-title">Source reports</h2>
        <span className="muted small">One report per week is a snapshot; reports are never added together</span>
      </div>
      <WeekTable title="Reporting week" range={formatRange(scope.periodStart, scope.periodEnd)} week={evidence.current} />
      <div style={{ borderTop: '1px solid var(--border)' }}>
        <WeekTable title="Comparison week" range={formatRange(scope.previousStart, scope.previousEnd)} week={evidence.previous} />
      </div>
    </section>
  );
}
