'use client';

import { formatCount, formatPct } from '../../../src/format.ts';
import type { CaseReview } from '../../../src/review/types.ts';
import type { Tone } from '../ui.tsx';

/** The answer first: can the growth claim be trusted, and what happens next. */
export function Verdict({ review }: { review: CaseReview }) {
  const { evidence, quality, outcome } = review;
  const pipeline = evidence.current.pipeline;
  const pipelineWrong = quality.checks.some(check => check.code === 'pipeline_figure' && !check.passed);

  let tone: Tone, title: string;
  if (quality.status === 'insufficient') {
    tone = 'bad'; title = 'A growth claim is not supported yet';
  } else if (outcome.expansionSupported) {
    tone = 'ok'; title = `The evidence supports a ${outcome.budgetChangePct}% expansion suggestion`;
  } else if (pipelineWrong) {
    tone = 'warn'; title = 'Corrected figures do not support an expansion';
  } else {
    tone = 'info'; title = 'Figures reconcile; growth does not support an expansion';
  }

  return (
    <section className={`banner ${tone}`} aria-label="Review outcome">
      <h2>{title}</h2>
      {pipelineWrong && pipeline && (
        <p>
          The pipeline reported <strong className="num">{formatCount(pipeline.activeSubscriptions)}</strong>
          {evidence.pipelineGrowthPct !== null && evidence.pipelineGrowthPct !== undefined && <> ({formatPct(evidence.pipelineGrowthPct)})</>}.
          The publisher&apos;s records support <strong className="num">{formatCount(evidence.activeSubscriptions)}</strong>
          {evidence.growthPct !== null ? <> ({formatPct(evidence.growthPct)})</> : <> with no comparable growth figure</>}.
        </p>
      )}
      <p>{review.recommendation.narrative}</p>
      <p className="next"><strong>Next:</strong> {outcome.nextAction}</p>
    </section>
  );
}
