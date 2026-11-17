'use client';

import { formatCount, formatMoney } from '../../../src/format.ts';
import type { CaseReview } from '../../../src/review/types.ts';
import { actionLabel, Chip } from '../ui.tsx';

/** What the AI commentary proposed, and whether the policy let it through. */
export function ModelCheck({ review }: { review: CaseReview }) {
  const { model } = review;
  return (
    <section className="card" aria-labelledby="model-title">
      <div className="card-head">
        <h2 id="model-title">AI commentary check</h2>
        {model.accepted ? <Chip tone="ok">Proposal accepted</Chip> : <Chip tone="bad">Proposal rejected</Chip>}
      </div>
      <div className="card-body stack" style={{ gap: 10 }}>
        <dl className="kv">
          <div><dt>Model proposed</dt><dd>{actionLabel(model.proposal.action, model.proposal.budgetChangePct)}</dd></div>
          <div><dt>Policy authorizes</dt><dd>{actionLabel(review.outcome.action, review.outcome.budgetChangePct)}</dd></div>
        </dl>
        {model.notes.map(note => <p key={note}>{note}</p>)}
        {!model.accepted && (
          <p className="muted small">Model draft, not used: “{model.proposal.narrative}”</p>
        )}
        <p className="muted small">
          Notes retrieved as context: {model.documents.length ? model.documents.map(document => `${document.id} (${document.source})`).join('; ') : 'none'}.
          The report wording is generated from verified figures, not from the model.
        </p>
      </div>
    </section>
  );
}

/** Sales, advertising and inventory: context for the report, not part of the promotion rule. */
export function Context({ review }: { review: CaseReview }) {
  const { evidence } = review;
  return (
    <section className="card" aria-labelledby="context-title">
      <div className="card-head">
        <h2 id="context-title">Supporting context</h2>
        <span className="muted small">Reporting week; not part of the promotion rule</span>
      </div>
      <dl className="card-body kv">
        <div><dt>Net sales</dt><dd>{formatMoney(evidence.netSales)}</dd></div>
        <div><dt>Ad spend</dt><dd>{formatMoney(evidence.adSpend)}</dd></div>
        <div><dt>ROAS (attributed)</dt><dd>{evidence.roas === null ? 'Undefined' : evidence.roas.toFixed(2)}</dd></div>
        <div><dt>Inventory units</dt><dd>{formatCount(evidence.inventoryUnits)}</dd></div>
      </dl>
    </section>
  );
}
