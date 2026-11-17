'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, casePath, caseUrl, useResource } from '../../lib/api.ts';
import { formatDateTime, formatRange } from '../../../src/format.ts';
import type { CaseList, CaseReview } from '../../../src/review/types.ts';
import { actionLabel, CaseStatusChip, ErrorState, Skeleton } from '../ui.tsx';
import { Checks } from './Checks.tsx';
import { Comparison } from './Comparison.tsx';
import { DecisionPanel } from './DecisionPanel.tsx';
import { Context, ModelCheck } from './ModelCheck.tsx';
import { SourceReports } from './SourceReports.tsx';
import { Verdict } from './Verdict.tsx';

const STATUS_TEXT = { not_opened: 'not opened', open: 'open', decided: 'decided', needs_attention: 'needs attention' } as const;

/** Last case list seen, shown while a fresh one loads so the switcher stays usable between cases. */
let lastList: CaseList | null = null;

/** Jump between cases. Selecting another scope navigates; the workspace shows which case is loading. */
function CaseSwitcher({ brandId, marketplace, version }: { brandId: string; marketplace: string; version: string }) {
  const router = useRouter();
  // `version` changes when this case's status changes, so the statuses in the list stay current.
  const list = useResource<CaseList>(`cases:${version}`, () => api<CaseList>('/api/cases'));
  if (list.status === 'ready') lastList = list.data;
  const cases = list.status === 'ready' ? list.data.cases : lastList?.cases ?? null;
  const value = `${brandId}/${marketplace}`;
  return (
    <label className="row small muted">
      <span>Case</span>
      <select value={value} disabled={!cases} onChange={event => { const [brand, market] = event.target.value.split('/'); router.push(casePath(brand, market)); }}>
        {cases
          ? cases.map(item => <option key={`${item.brandId}/${item.marketplace}`} value={`${item.brandId}/${item.marketplace}`}>{item.brandName} · {item.marketplace} ({STATUS_TEXT[item.caseStatus]})</option>)
          : <option value={value}>{list.status === 'loading' ? 'Loading cases…' : 'Case list unavailable'}</option>}
      </select>
    </label>
  );
}

function ReportCard({ review }: { review: CaseReview }) {
  const { status, decision } = review.case;
  const href = `${casePath(review.scope.brandId, review.scope.marketplace)}/report`;
  return (
    <section className="card" aria-labelledby="report-title">
      <div className="card-head"><h2 id="report-title">Client report</h2></div>
      <div className="card-body stack" style={{ gap: 10 }}>
        {status === 'decided' && decision && (
          <>
            <p>Ready. Generated from decision #{decision.decisionId} ({actionLabel(decision.decision, decision.budgetChangePct)}) and the evidence saved with it.</p>
            <Link href={href} className="btn primary block">Open client report</Link>
          </>
        )}
        {status === 'needs_attention' && <p className="muted">Withheld. The evidence changed after the last decision, so the report will not be generated from it. Save a new decision first.</p>}
        {(status === 'open' || status === 'not_opened') && <p className="muted">Not available yet. The report is generated from a saved decision, whether that is a hold or an approval.</p>}
      </div>
    </section>
  );
}

/** One case, start to finish: outcome first, then the comparison and its evidence, with the
 * decision and the client report alongside. Opening is idempotent, so a reload reopens the saved case. */
export function CaseWorkspace({ brandId, marketplace }: { brandId: string; marketplace: string }) {
  const key = `${brandId}/${marketplace}`;
  const opened = useResource<CaseReview>(key, () => api<CaseReview>(caseUrl(brandId, marketplace), { method: 'POST' }));

  return (
    <main className="page">
      <Link href="/" className="crumb">← All cases</Link>
      <div className="page-head">
        <div>
          {opened.status === 'ready' ? (
            <>
              <div className="row">
                <h1>{opened.data.scope.brandName} · {opened.data.scope.marketplace}</h1>
                <CaseStatusChip status={opened.data.case.status} decision={opened.data.case.decision} />
              </div>
              <p className="muted">
                Week of {formatRange(opened.data.scope.periodStart, opened.data.scope.periodEnd)}, compared with {formatRange(opened.data.scope.previousStart, opened.data.scope.previousEnd)} · evidence as of {formatDateTime(opened.data.scope.asOf)}
                {opened.data.case.openedAt && <> · case opened {formatDateTime(opened.data.case.openedAt)}</>}
              </p>
            </>
          ) : (
            <>
              <h1>{brandId} · {marketplace}</h1>
              <p className="muted" role="status">{opened.status === 'loading' ? 'Opening the case and checking its evidence against the publisher exports…' : 'This case could not be opened.'}</p>
            </>
          )}
        </div>
        <CaseSwitcher brandId={brandId} marketplace={marketplace}
          version={opened.status === 'ready' ? `${opened.data.case.status}:${opened.data.case.decisionCount}` : 'pending'} />
      </div>

      {opened.status === 'loading' && (
        <div className="workspace" aria-busy="true">
          <div className="stack"><Skeleton lines={1} tall /><div className="card card-body"><Skeleton lines={5} /></div></div>
          <div className="card card-body"><Skeleton lines={4} /></div>
        </div>
      )}

      {opened.status === 'error' && (
        <ErrorState
          title={opened.error.code === 'unknown_scope' ? 'There is no case for this brand and marketplace' : 'The case could not be opened'}
          error={opened.error}
          onRetry={opened.error.code === 'unknown_scope' ? undefined : opened.reload}>
          <Link href="/" className="btn">Back to all cases</Link>
        </ErrorState>
      )}

      {opened.status === 'ready' && (
        <div className="workspace">
          <div className="stack">
            {opened.data.case.status === 'needs_attention' && (
              <section className="banner warn" role="alert">
                <h2>Evidence changed since the last decision</h2>
                <p>The saved decision no longer matches the evidence, so it is not used and the client report is withheld. Review what changed, then save a new decision.</p>
                <ul>{opened.data.case.changes.map(change => <li key={change}>{change}</li>)}</ul>
              </section>
            )}
            <Verdict review={opened.data} />
            <Comparison review={opened.data} />
            <Checks quality={opened.data.quality} />
            <SourceReports review={opened.data} />
            <ModelCheck review={opened.data} />
            <Context review={opened.data} />
          </div>
          <aside className="aside">
            {/* Keyed by evidence so the form never carries input over to different evidence. */}
            <DecisionPanel key={opened.data.fingerprint} review={opened.data} onSaved={opened.set} onReload={opened.reload} />
            <ReportCard review={opened.data} />
          </aside>
        </div>
      )}
    </main>
  );
}
