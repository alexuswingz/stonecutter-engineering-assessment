'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, casePath, useResource } from '../lib/api.ts';
import { formatCount, formatDateTime, formatDay, formatPct, formatRange } from '../../src/format.ts';
import type { CaseList as CaseListData, CaseSummary } from '../../src/review/types.ts';
import { actionLabel, CaseStatusChip, Chip, EmptyState, ErrorState, Skeleton } from './ui.tsx';

/** Entry point: every brand and marketplace, what the pipeline reported next to what the sources
 * support, and where each review case stands. */
export function CaseList() {
  const list = useResource<CaseListData>('cases', () => api<CaseListData>('/api/cases'));

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Weekly client report review</h1>
          {list.status === 'ready'
            ? <p className="muted">Reporting week {formatRange(list.data.period.periodStart, list.data.period.periodEnd)}, compared with {formatRange(list.data.period.previousStart, list.data.period.previousEnd)}. Open a case to check its figures against the publisher&apos;s records before the report goes to the client.</p>
            : <p className="muted">Open a case to check its figures against the publisher&apos;s records before the report goes to the client.</p>}
        </div>
        {list.status === 'ready' && <span className="muted small">Evidence as of {formatDateTime(list.data.period.asOf)}</span>}
      </div>

      {list.status === 'loading' && (
        <div className="card card-body" aria-busy="true">
          <p className="muted" role="status" style={{ marginBottom: 14 }}>Checking every brand and marketplace against the publisher exports…</p>
          <Skeleton lines={6} />
        </div>
      )}
      {list.status === 'error' && <ErrorState title="The case list could not be loaded" error={list.error} onRetry={list.reload} />}
      {list.status === 'ready' && list.data.cases.length === 0 && (
        <EmptyState title="No brands or marketplaces found">
          The source database has no subscription or sales records. Check that data/marketplace.pglite is the intended snapshot, then reload this page.
        </EmptyState>
      )}
      {list.status === 'ready' && list.data.cases.length > 0 && <Cases cases={list.data.cases} />}
    </main>
  );
}

function evidenceChip(item: CaseSummary) {
  if (item.blocking > 0) return <Chip tone="bad">Blocked</Chip>;
  if (item.issues > 0) return <Chip tone="warn">Corrected</Chip>;
  return <Chip tone="ok">Reconciles</Chip>;
}

function Cases({ cases }: { cases: CaseSummary[] }) {
  const router = useRouter();
  const blocked = cases.filter(item => item.blocking > 0).length;
  const corrected = cases.filter(item => item.blocking === 0 && item.issues > 0).length;
  const decided = cases.filter(item => item.caseStatus === 'decided').length;
  const attention = cases.filter(item => item.caseStatus === 'needs_attention').length;

  return (
    <>
      <div className="summary" aria-label="Summary">
        <div className="stat"><span className="value">{blocked}</span><span className="label">blocked: growth claim not supported</span></div>
        <div className="stat"><span className="value">{corrected}</span><span className="label">corrected: pipeline figure was wrong</span></div>
        <div className="stat"><span className="value">{cases.length - blocked - corrected}</span><span className="label">reconcile with the publisher</span></div>
        <div className="stat"><span className="value">{decided} of {cases.length}</span><span className="label">decided{attention > 0 ? ` · ${attention} need attention` : ''}</span></div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Brand · marketplace</th>
              <th scope="col" className="right">Pipeline reported</th>
              <th scope="col" className="right">Sources support</th>
              <th scope="col">Evidence</th>
              <th scope="col">Supported action</th>
              <th scope="col">Case</th>
              <th scope="col"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {cases.map(item => {
              const href = casePath(item.brandId, item.marketplace);
              const figureWrong = item.pipeline.current !== item.verified.current;
              const growthWrong = item.pipeline.growthPct !== item.verified.growthPct;
              return (
                <tr key={`${item.brandId}/${item.marketplace}`} className="clickable" onClick={() => router.push(href)}>
                  <td>
                    <strong>{item.brandName}</strong> <span className="tag">{item.marketplace}</span>
                  </td>
                  <td className="right num">
                    <span className={figureWrong ? 'wrong' : 'figure'}>{formatCount(item.pipeline.current)}</span>
                    <span className={`sub${growthWrong ? ' wrong' : ''}`}>{formatPct(item.pipeline.growthPct)}</span>
                  </td>
                  <td className="right num">
                    <span className="figure">{formatCount(item.verified.current)}</span>
                    <span className="sub">
                      {item.verified.complete ? formatPct(item.verified.growthPct) : item.verified.through ? `partial, through ${formatDay(item.verified.through)}` : 'no report'}
                    </span>
                  </td>
                  <td>
                    {evidenceChip(item)}
                    <span className="sub" style={{ marginTop: 4 }}>{item.headline}</span>
                  </td>
                  <td>{actionLabel(item.outcome.action, item.outcome.budgetChangePct)}</td>
                  <td><CaseStatusChip status={item.caseStatus} decision={item.decision} /></td>
                  <td className="right">
                    <Link href={href} className="btn" onClick={event => event.stopPropagation()}>
                      {item.caseStatus === 'not_opened' ? 'Open case' : 'Reopen case'}
                      <span className="sr-only"> for {item.brandName} {item.marketplace}</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>
        Struck-through figures are what the internal pipeline reported where the publisher&apos;s own records say otherwise.
      </p>
    </>
  );
}
