import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, openDatabase, rebuildMetrics } from '../src/database.ts';

interface MartRow {
  brand_id: string; marketplace: string; period_start: string; total: number; reports: number;
  publisher_report_id: string; declared_total: number; declared_offers: number; loaded_offers: number;
}

async function rebuiltMart(): Promise<MartRow[]> {
  const db = await openDatabase(true);
  try {
    await rebuildMetrics(db);
    return (await db.query<MartRow>(`
      SELECT w.brand_id, w.marketplace, w.period_start::text, w.active_subscriptions::int AS total,
             jsonb_array_length(w.source_report_ids) AS reports,
             r.publisher_report_id, r.declared_active_subscriptions AS declared_total,
             r.declared_offer_count AS declared_offers,
             (SELECT count(*)::int FROM raw.subscription_offers o WHERE o.report_id = r.report_id) AS loaded_offers
      FROM marts.subscription_weekly w
      JOIN raw.subscription_reports r ON r.report_id = w.source_report_ids->>0
      ORDER BY 1, 2, 3`)).rows;
  } finally { await db.close(); }
}

/** Publisher report ids that the publisher itself lists as current (not superseded). */
async function publisherCurrentIds(): Promise<Set<string>> {
  const [header, ...lines] = (await readFile(path.join(ROOT, 'data', 'exports', 'subscription_reports.csv'), 'utf8')).trim().split(/\r?\n/);
  const columns = header.split(',');
  const id = columns.indexOf('publisher_report_id'), superseded = columns.indexOf('superseded_by');
  return new Set(lines.map(line => line.split(',')).filter(cells => !cells[superseded]).map(cells => cells[id]));
}

test('a weekly snapshot comes from exactly one report, never a sum of several', async () => {
  const combined = (await rebuiltMart()).filter(row => row.reports !== 1);
  assert.deepEqual(combined.map(row => `${row.brand_id}/${row.marketplace}/${row.period_start}: ${row.reports} reports`), []);
});

test('the selected report is the one the publisher lists as current, whatever our import revision says', async () => {
  const current = await publisherCurrentIds();
  const stale = (await rebuiltMart()).filter(row => !current.has(row.publisher_report_id));
  assert.deepEqual(stale.map(row => `${row.brand_id}/${row.marketplace}/${row.period_start}: ${row.publisher_report_id}`), []);
});

test('a fully loaded report reproduces the control total in the publisher header', async () => {
  const wrong = (await rebuiltMart()).filter(row => row.loaded_offers === row.declared_offers && row.total !== row.declared_total);
  assert.deepEqual(wrong.map(row => `${row.brand_id}/${row.marketplace}/${row.period_start}: mart ${row.total} vs header ${row.declared_total}`), []);
});
