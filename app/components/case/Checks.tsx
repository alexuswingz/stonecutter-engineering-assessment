'use client';

import type { Check, Quality } from '../../../src/types.ts';

const WEEK_LABEL: Record<Check['week'], string> = { current: 'Reporting week', previous: 'Comparison week', both: 'Both weeks' };

function CheckItem({ check }: { check: Check }) {
  const tone = check.passed ? 'ok' : check.blocking ? 'bad' : 'warn';
  const symbol = check.passed ? '✓' : check.blocking ? '✕' : '!';
  const meaning = check.passed ? 'Passed' : check.blocking ? 'Blocks a growth claim' : 'Corrected in this review';
  return (
    <li>
      <span className={`mark ${tone}`} aria-hidden="true">{symbol}</span>
      <div>
        <div className="check-title">
          <span>{check.title}</span>
          <span className="tag">{WEEK_LABEL[check.week]}</span>
          {!check.passed && <span className={`tag ${check.blocking ? 'superseded' : 'pipeline'}`}>{meaning}</span>}
          <span className="sr-only">{meaning}</span>
        </div>
        <p className="muted">{check.detail}</p>
        {check.action && <p className="check-action">Next: {check.action}</p>}
      </div>
    </li>
  );
}

/** Every rule the evidence was tested against. Failures first; passes folded away but inspectable. */
export function Checks({ quality }: { quality: Quality }) {
  const failed = quality.checks.filter(check => !check.passed).sort((a, b) => Number(b.blocking) - Number(a.blocking));
  const passed = quality.checks.filter(check => check.passed);
  return (
    <section className="card" aria-labelledby="checks-title">
      <div className="card-head">
        <h2 id="checks-title">Evidence checks</h2>
        <span className="muted small">
          {failed.length === 0 ? `All ${passed.length} checks passed` : `${failed.length} of ${quality.checks.length} need attention`}
        </span>
      </div>
      {failed.length > 0
        ? <ul className="checks">{failed.map(check => <CheckItem key={`${check.code}-${check.week}`} check={check} />)}</ul>
        : <p className="card-body muted">Both weeks use the publisher&apos;s current, complete report, the import matches its control totals, and the pipeline figure agrees.</p>}
      {passed.length > 0 && (
        <details className="passed">
          <summary>{passed.length} passed {passed.length === 1 ? 'check' : 'checks'}</summary>
          <ul className="checks">{passed.map(check => <CheckItem key={`${check.code}-${check.week}`} check={check} />)}</ul>
        </details>
      )}
    </section>
  );
}
