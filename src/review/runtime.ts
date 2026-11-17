import type { PGlite } from '@electric-sql/pglite';
import { stat } from 'node:fs/promises';
import { SNAPSHOT_FILE, openDatabase } from '../database.ts';
import { loadExports } from '../exports.ts';
import { ReviewError, type ReviewDeps } from './service.ts';
import { openReviewStore } from './store.ts';

/** Process-wide dependencies for the route handlers.
 *
 * Source database: an in-memory copy of the bundled snapshot. The server never writes to source
 * data and never reads the CLI's .runtime working copy, so the figures it shows are the shipped
 * ones. If the snapshot file is replaced, the copy is reloaded on the next request and saved
 * decisions are re-checked against the new evidence.
 * Review store: one persistent connection (see store.ts).
 * Both live on globalThis because Next.js bundles each route separately and reloads modules in dev. */
interface Runtime {
  source?: { stamp: string; db: Promise<PGlite> };
  store?: Promise<PGlite>;
}
const holder = globalThis as typeof globalThis & { __stonecutterReview?: Runtime };
const runtime = (holder.__stonecutterReview ??= {});

async function sourceDatabase(): Promise<PGlite> {
  let stamp: string;
  try { const info = await stat(SNAPSHOT_FILE); stamp = `${info.mtimeMs}:${info.size}`; }
  catch { throw new ReviewError('source_unavailable', 503, `The source database snapshot was not found at ${SNAPSHOT_FILE}. Run the server from the project directory.`); }
  if (runtime.source?.stamp !== stamp) {
    const previous = runtime.source?.db;
    const db = openDatabase(true);
    runtime.source = { stamp, db };
    db.catch(() => { if (runtime.source?.db === db) runtime.source = undefined; });
    previous?.then(old => old.close()).catch(() => undefined);
  }
  return runtime.source.db;
}

async function reviewStore(): Promise<PGlite> {
  if (!runtime.store) {
    const store = openReviewStore();
    runtime.store = store;
    store.catch(() => { if (runtime.store === store) runtime.store = undefined; });
  }
  return runtime.store;
}

export async function getDeps(): Promise<ReviewDeps> {
  const [db, store, exports] = await Promise.all([sourceDatabase(), reviewStore(), loadExports()]);
  return { db, store, exports };
}
