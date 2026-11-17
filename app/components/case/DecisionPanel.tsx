'use client';

import { useId, useState, type FormEvent } from 'react';
import { api, ApiFailure, caseUrl } from '../../lib/api.ts';
import { formatDateTime, formatPct } from '../../../src/format.ts';
import type { CaseReview, DecisionInput } from '../../../src/review/types.ts';
import type { Action } from '../../../src/types.ts';
import { actionLabel } from '../ui.tsx';

function suggestedReason(review: CaseReview, choice: Action): string {
  const { evidence, quality, outcome } = review;
  if (choice === 'expand_promotion') return `Both weeks are complete and reconcile with the publisher; verified growth is ${formatPct(evidence.growthPct)}, at or above the 10% threshold.`;
  const blocking = quality.checks.find(check => check.blocking && !check.passed);
  if (blocking) return blocking.clientNote ?? blocking.detail;
  if (evidence.growthPct !== null && !outcome.expansionSupported) return `Verified growth is ${formatPct(evidence.growthPct)}, below the 10% needed to suggest an expansion.`;
  return 'Holding the promotion at its current level for this week.';
}

/** Save a decision against the evidence on screen. The server recomputes that evidence and has the
 * final say: the disabled expansion option here is a convenience, not the control. */
export function DecisionPanel({ review, onSaved, onReload }: { review: CaseReview; onSaved: (review: CaseReview) => void; onReload: () => void }) {
  const { scope, outcome, quality } = review;
  const saved = review.case.decision;
  const current = review.case.status === 'decided';
  const [editing, setEditing] = useState(!current);
  const [choice, setChoice] = useState<Action>(outcome.action);
  const [reason, setReason] = useState('');
  const [nextAction, setNextAction] = useState(outcome.nextAction);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [reasonMissing, setReasonMissing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const reasonId = useId();
  const limitations = quality.checks.filter(check => check.blocking && !check.passed);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) { setReasonMissing(true); return; }
    setSaving(true); setFailure(null);
    const input: DecisionInput = { decision: choice, reason, nextAction, evidenceFingerprint: review.fingerprint };
    try {
      const updated = await api<CaseReview>(`${caseUrl(scope.brandId, scope.marketplace)}/decision`, { method: 'POST', json: input });
      setJustSaved(true); setEditing(false);
      onSaved(updated);
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error : new ApiFailure('unexpected', 0, 'The decision could not be saved. Try again.'));
    } finally { setSaving(false); }
  }

  if (!editing && saved) {
    return (
      <section className="card" aria-labelledby="decision-title">
        <div className="card-head"><h2 id="decision-title">Decision</h2><span className="muted small">Saved {formatDateTime(saved.decidedAt)}</span></div>
        <div className="card-body saved">
          {justSaved && <p className="alert ok" role="status">Decision saved. It will still be here after a restart. The client report is ready below.</p>}
          <dl>
            <div><dt>Decision</dt><dd><strong>{saved.decision === 'expand_promotion' ? `Approve a ${saved.budgetChangePct}% promotion expansion` : 'Hold the promotion'}</strong></dd></div>
            <div><dt>Reason</dt><dd>{saved.reason}</dd></div>
            <div><dt>Next action</dt><dd>{saved.nextAction}</dd></div>
            <div>
              <dt>Limitations recorded</dt>
              <dd>{saved.limitations.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{saved.limitations.map(item => <li key={item}>{item}</li>)}</ul> : 'None: the evidence was complete and reconciled.'}</dd>
            </div>
          </dl>
          <button type="button" className="btn block" onClick={() => { setEditing(true); setJustSaved(false); setReason(''); }}>Change decision</button>
          {review.case.decisionCount > 1 && <p className="muted small">{review.case.decisionCount} decisions on record; earlier ones are kept as history.</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="decision-title">
      <div className="card-head"><h2 id="decision-title">Decision</h2><span className="muted small">Saved with this evidence</span></div>
      <form className="card-body form" onSubmit={submit} noValidate>
        {review.case.status === 'needs_attention' && saved && (
          <p className="alert bad">The earlier decision ({actionLabel(saved.decision, saved.budgetChangePct)}, {formatDateTime(saved.decidedAt)}) was made on evidence that has since changed. Save a new decision to replace it.</p>
        )}
        <fieldset className="options">
          <legend>What should the client report recommend?</legend>
          <label className={`option${choice === 'hold' ? ' checked' : ''}`}>
            <input type="radio" name="decision" checked={choice === 'hold'} onChange={() => setChoice('hold')} />
            <span>
              <span className="option-title">Hold the promotion</span>
              <span className="muted small" style={{ display: 'block' }}>Keep the current level. The report explains why and what happens next.</span>
            </span>
          </label>
          <label className={`option${choice === 'expand_promotion' ? ' checked' : ''}${outcome.expansionSupported ? '' : ' disabled'}`}>
            <input type="radio" name="decision" disabled={!outcome.expansionSupported} checked={choice === 'expand_promotion'} onChange={() => setChoice('expand_promotion')} aria-describedby={`${reasonId}-blockers`} />
            <span>
              <span className="option-title">Approve a 10% expansion</span>
              <span id={`${reasonId}-blockers`} className="muted small" style={{ display: 'block' }}>
                {outcome.expansionSupported
                  ? 'Supported: two complete, reconciled weeks and at least 10% growth. Stays a draft for the brand manager.'
                  : <>Not available. The server refuses it because:</>}
              </span>
              {!outcome.expansionSupported && (
                <ul className="muted small">
                  {limitations.map(check => <li key={`${check.code}-${check.week}`}>{check.title}</li>)}
                  {limitations.length === 0 && outcome.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}
                </ul>
              )}
            </span>
          </label>
        </fieldset>

        <label className="field" htmlFor={reasonId}>
          <span>Reason <span className="muted hint">(required; appears in the client report)</span></span>
          <textarea id={reasonId} value={reason} maxLength={2000} aria-invalid={reasonMissing} aria-describedby={`${reasonId}-help`}
            onChange={event => { setReason(event.target.value); if (event.target.value.trim()) setReasonMissing(false); }} />
          <span id={`${reasonId}-help`} className="hint small" style={{ color: reasonMissing ? 'var(--bad)' : 'var(--muted)' }}>
            {reasonMissing ? 'Give a reason before saving. ' : ''}
            <button type="button" className="btn link" onClick={() => { setReason(suggestedReason(review, choice)); setReasonMissing(false); }}>Use suggested wording</button>
          </span>
        </label>

        <label className="field">
          <span>Next action</span>
          <textarea value={nextAction} maxLength={2000} onChange={event => setNextAction(event.target.value)} />
        </label>

        <div className="small muted">
          <strong>Saved with the decision:</strong> brand, marketplace and week; the source report IDs; the figures and checks above; and{' '}
          {limitations.length ? `${limitations.length} limitation${limitations.length === 1 ? '' : 's'}.` : 'no limitations.'}
        </div>

        {failure && (
          <div className="alert bad" role="alert">
            <strong>{failure.code === 'evidence_changed' ? 'The evidence changed while this case was open' : failure.code === 'unsupported_decision' ? 'The server rejected this decision' : 'The decision was not saved'}</strong>
            <span>{failure.message}</span>
            {failure.details.length > 0 && <ul>{failure.details.map(detail => <li key={detail}>{detail}</li>)}</ul>}
            {failure.code === 'evidence_changed' && <button type="button" className="btn" onClick={onReload}>Reload evidence</button>}
          </div>
        )}

        <div className="row">
          <button type="submit" className="btn primary" disabled={saving} style={{ flex: 1 }}>
            {saving ? 'Saving…' : choice === 'hold' ? 'Save hold decision' : 'Save expansion approval'}
          </button>
          {saved && current && <button type="button" className="btn" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>}
        </div>
      </form>
    </section>
  );
}
