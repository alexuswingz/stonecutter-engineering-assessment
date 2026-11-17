'use client';

import type { ReactNode } from 'react';
import type { ApiFailure } from '../lib/api.ts';
import type { CaseStatus } from '../../src/review/types.ts';
import type { Action } from '../../src/types.ts';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export function actionLabel(action: Action, pct: number): string {
  return action === 'expand_promotion' ? `Expand ${pct}%` : 'Hold';
}

/** One vocabulary for case status everywhere it appears. */
export function CaseStatusChip({ status, decision }: { status: CaseStatus; decision?: { decision: Action; budgetChangePct: number } | null }) {
  if (status === 'needs_attention') return <Chip tone="bad">Needs attention</Chip>;
  if (status === 'decided' && decision) return <Chip tone="ok">Decided · {actionLabel(decision.decision, decision.budgetChangePct)}</Chip>;
  if (status === 'open') return <Chip tone="info">Open · no decision</Chip>;
  return <Chip tone="neutral">Not opened</Chip>;
}

export function Skeleton({ lines = 3, tall = false }: { lines?: number; tall?: boolean }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className={`skeleton${tall ? ' tall' : ''}`} style={tall ? undefined : { width: `${90 - index * 14}%` }} />
      ))}
    </div>
  );
}

/** Explains what failed and what to do next; always offers a way forward. */
export function ErrorState({ title, error, onRetry, children }: { title: string; error: ApiFailure; onRetry?: () => void; children?: ReactNode }) {
  return (
    <div className="card state" role="alert">
      <h2>{title}</h2>
      <p>{error.message}</p>
      {error.details.length > 0 && <ul>{error.details.map(detail => <li key={detail}>{detail}</li>)}</ul>}
      <div className="row">
        {onRetry && <button type="button" className="btn primary" onClick={onRetry}>Try again</button>}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card state">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
