import { PGlite } from '@electric-sql/pglite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../database.ts';

/** Review store: the only place this application writes.
 *
 * Ownership: the review service (src/review/service.ts). Nothing else reads or writes it.
 * Location: a separate PGlite data directory (.review-store/, git-ignored), never the source
 * snapshot or its working copy, so source data stays a fixed contract.
 * Lifecycle: created on first use; survives restarts; delete the directory to start over.
 * Decisions are append-only: a new decision supersedes the previous one, which is kept. */
export const REVIEW_STORE_DIR = process.env.REVIEW_STORE_DIR ?? path.join(ROOT, '.review-store');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS review_cases (
  case_id      text PRIMARY KEY,
  brand_id     text NOT NULL,
  marketplace  text NOT NULL,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, marketplace, period_start)
);
CREATE TABLE IF NOT EXISTS review_decisions (
  decision_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id              text NOT NULL REFERENCES review_cases,
  decided_at           timestamptz NOT NULL DEFAULT now(),
  decision             text NOT NULL CHECK (decision IN ('hold', 'expand_promotion')),
  budget_change_pct    integer NOT NULL,
  reason               text NOT NULL CHECK (length(btrim(reason)) > 0),
  next_action          text NOT NULL,
  limitations          jsonb NOT NULL,
  evidence_fingerprint text NOT NULL,
  snapshot             jsonb NOT NULL,
  CHECK ((decision = 'hold' AND budget_change_pct = 0) OR (decision = 'expand_promotion' AND budget_change_pct > 0))
);`;

/** Pass null for a throwaway in-memory store (tests). */
export async function openReviewStore(directory: string | null = REVIEW_STORE_DIR): Promise<PGlite> {
  if (directory) await mkdir(path.dirname(directory), { recursive: true });
  const store = new PGlite(directory ? { dataDir: directory } : {});
  await store.waitReady;
  await store.exec("SET TIME ZONE 'UTC'");
  await store.exec(SCHEMA);
  return store;
}
