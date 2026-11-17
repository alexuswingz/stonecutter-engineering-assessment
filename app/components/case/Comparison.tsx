'use client';

import { formatCount, formatDay, formatPct, formatRange } from '../../../src/format.ts';
import type { CaseReview } from '../../../src/review/types.ts';
import type { WeekEvidence } from '../../../src/types.ts';

function pipelineNote(week: WeekEvidence): string {
  if (!week.pipeline) return 'no figure in the mart';
  const count = week.pipeline.sourceReportIds.length;
  return count > 1 ? `${count} reports added together` : 'from 1 report';
}
function sourceNote(week: WeekEvidence): string {
  if (week.verifiedActiveSubscriptions === null || week.verifiedActiveSubscriptions === undefined) return 'no report available';
  if (week.complete) return 'complete week';
  return week.verifiedThrough ? `partial, through ${formatDay(week.verifiedThrough)}` : 'incomplete';
}

function Difference({ pipeline, verified, unit }: { pipeline: number | null | undefined; verified: number | null | undefined; unit: 'count' | 'points' }) {
  if (pipeline === verified) return <span className="match">Match</span>;
  if (pipeline === null || pipeline === undefined || verified === null || verified === undefined) return <span className="delta">Differs</span>;
  const gap = pipeline - verified;
  const size = unit === 'count' ? formatCount(Math.abs(gap)) : `${Math.abs(gap).toFixed(2)} pts`;
  return <span className="delta num">{gap > 0 ? `Overstated by ${size}` : `Understated by ${size}`}</span>;
}

/** The discrepancy in one view: what the pipeline reported beside what the sources support. */
export function Comparison({ review }: { review: CaseReview }) {
  const { evidence, scope } = review;
  const rows = [
    { label: 'Reporting week', range: formatRange(scope.periodStart, scope.periodEnd), week: evidence.current },
    { label: 'Comparison week', range: formatRange(scope.previousStart, scope.previousEnd), week: evidence.previous },
  ];
  return (
    <section className="card" aria-labelledby="comparison-title">
      <div className="card-head">
        <h2 id="comparison-title">Active subscriptions: pipeline vs sources</h2>
        <span className="muted small">Sources are the publisher&apos;s own exports</span>
      </div>
      <div className="table-wrap">
        <table className="compare">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Measure</span></th>
              <th scope="col" className="right">Pipeline reported</th>
              <th scope="col" className="right">Sources support</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, range, week }) => {
              const pipeline = week.pipeline?.activeSubscriptions ?? null;
              const verified = week.verifiedActiveSubscriptions ?? null;
              return (
                <tr key={label}>
                  <td className="label">{label}<span className="note">{range}</span></td>
                  <td className="figure right">
                    <span className={pipeline !== verified ? 'wrong' : undefined}>{formatCount(pipeline)}</span>
                    <span className="note">{pipelineNote(week)}</span>
                  </td>
                  <td className="figure right">{formatCount(verified)}<span className="note">{sourceNote(week)}</span></td>
                  <td><Difference pipeline={pipeline} verified={verified} unit="count" /></td>
                </tr>
              );
            })}
            <tr>
              <td className="label">Week-over-week change<span className="note">needs two complete weeks</span></td>
              <td className="figure right">
                <span className={evidence.pipelineGrowthPct !== evidence.growthPct ? 'wrong' : undefined}>{formatPct(evidence.pipelineGrowthPct)}</span>
              </td>
              <td className="figure right">{formatPct(evidence.growthPct)}</td>
              <td><Difference pipeline={evidence.pipelineGrowthPct} verified={evidence.growthPct} unit="points" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
