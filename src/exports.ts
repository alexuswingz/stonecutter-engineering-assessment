import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './database.ts';
import type { PublisherSnapshot, ReportStatus } from './types.ts';

/** Publisher exports (data/exports): the publisher's own records, independent of our ingestion.
 * They are authoritative; this module only reads them. */
export interface PublisherReport extends PublisherSnapshot {
  brandId: string; marketplace: string; periodStart: string; supersededBy: string | null;
}
export interface PublisherExports { directory: string; reports: Map<string, PublisherReport> }

export const EXPORTS_DIR = process.env.EXPORTS_DIR ? path.resolve(process.env.EXPORTS_DIR) : path.join(DATA_DIR, 'exports');

async function readCsv(file: string, required: string[]): Promise<Record<string, string>[]> {
  let text: string;
  try { text = await readFile(file, 'utf8'); }
  catch { throw new Error(`Publisher export not found: ${file}. The review needs data/exports to verify internal figures.`); }
  const [header, ...lines] = text.replace(/^﻿/, '').split(/\r?\n/).filter(line => line.trim() !== '');
  const columns = (header ?? '').split(',').map(column => column.trim());
  const missing = required.filter(column => !columns.includes(column));
  if (missing.length) throw new Error(`Publisher export ${path.basename(file)} is missing column(s): ${missing.join(', ')}.`);
  return lines.map(line => {
    const cells = line.split(',');
    return Object.fromEntries(columns.map((column, index) => [column, (cells[index] ?? '').trim()]));
  });
}

const cache = new Map<string, { stamp: string; exports: PublisherExports }>();

/** Loads both export files. Cached per directory until either file changes on disk. */
export async function loadExports(directory = EXPORTS_DIR): Promise<PublisherExports> {
  const reportsFile = path.join(directory, 'subscription_reports.csv');
  const offersFile = path.join(directory, 'subscription_offers.csv');
  const stamp = (await Promise.all([reportsFile, offersFile].map(async file => {
    try { const info = await stat(/* turbopackIgnore: true */ file); return `${info.mtimeMs}:${info.size}`; } catch { return 'missing'; }
  }))).join('|');
  const cached = cache.get(directory);
  if (cached?.stamp === stamp) return cached.exports;

  const offers = new Map<string, { listed: number; total: number }>();
  for (const row of await readCsv(offersFile, ['publisher_report_id', 'offer_id', 'active_subscriptions'])) {
    const entry = offers.get(row.publisher_report_id) ?? { listed: 0, total: 0 };
    entry.listed += 1; entry.total += Number(row.active_subscriptions);
    offers.set(row.publisher_report_id, entry);
  }
  const reports = new Map<string, PublisherReport>();
  for (const row of await readCsv(reportsFile, ['publisher_report_id', 'brand_id', 'marketplace', 'period_start', 'period_end', 'status', 'generated_at', 'superseded_by', 'offer_count', 'active_subscriptions'])) {
    const listed = offers.get(row.publisher_report_id) ?? { listed: 0, total: 0 };
    reports.set(row.publisher_report_id, {
      publisherReportId: row.publisher_report_id, brandId: row.brand_id, marketplace: row.marketplace,
      periodStart: row.period_start, periodEnd: row.period_end, status: row.status as ReportStatus,
      generatedAt: row.generated_at, supersededBy: row.superseded_by || null,
      offerCount: Number(row.offer_count), activeSubscriptions: Number(row.active_subscriptions),
      offersListed: listed.listed, offersTotal: listed.total,
    });
  }
  const exports = { directory, reports };
  cache.set(directory, { stamp, exports });
  return exports;
}

/** The report the publisher regards as current for a week at the evaluation time: published by
 * then and not replaced by another report published by then. */
export function currentPublisherReport(exports: PublisherExports, brandId: string, marketplace: string, periodStart: string, asOf: string): PublisherReport | null {
  const published = [...exports.reports.values()].filter(report => report.brandId === brandId && report.marketplace === marketplace
    && report.periodStart === periodStart && Date.parse(report.generatedAt) <= Date.parse(asOf));
  const ids = new Set(published.map(report => report.publisherReportId));
  const current = published.filter(report => !report.supersededBy || !ids.has(report.supersededBy));
  current.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
  return current[0] ?? null;
}
