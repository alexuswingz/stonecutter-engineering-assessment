import type { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AS_OF, PERIOD_START, PERIOD_END, PREVIOUS_START, ROOT, queryRows } from './database.ts';
import { currentPublisherReport, loadExports, type PublisherExports } from './exports.ts';
import type { Evidence, PipelineSnapshot, ReportStatus, SourceReport, WeekEvidence } from './types.ts';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

/** Every imported report for one brand / marketplace / week that was available at the
 * evaluation time, with what was actually loaded for it. */
export const METRICS_SQL = `
SELECT r.report_id, r.publisher_report_id, r.revision, r.status, r.period_end::text AS period_end,
       to_char(r.generated_at, ${UTC}) AS generated_at, to_char(r.extracted_at, ${UTC}) AS extracted_at,
       r.declared_offer_count, r.declared_active_subscriptions,
       (SELECT count(*)::int FROM raw.subscription_offers o WHERE o.report_id = r.report_id) AS loaded_offers,
       (SELECT COALESCE(sum(o.active_subscriptions), 0)::int FROM raw.subscription_offers o WHERE o.report_id = r.report_id) AS loaded_total
FROM raw.subscription_reports r
WHERE r.brand_id = $1 AND r.marketplace = $2 AND r.period_start = $3::date AND r.extracted_at <= $4::timestamptz
ORDER BY r.revision`;

interface ReportRow {
  report_id: string; publisher_report_id: string; revision: number; status: ReportStatus; period_end: string;
  generated_at: string; extracted_at: string; declared_offer_count: number; declared_active_subscriptions: number;
  loaded_offers: number; loaded_total: number;
}
interface MartRow { total: number; source_report_ids: string[]; source_complete: boolean; source_period_end: string }

export interface Scope { brandId: string; brandName: string; marketplace: string }

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Brand / marketplace pairs present in the data. Nothing about the scopes is hardcoded. */
export async function listScopes(db: PGlite): Promise<Scope[]> {
  return queryRows<Scope>(db, `
    SELECT b.brand_id AS "brandId", b.name AS "brandName", s.marketplace
    FROM (SELECT brand_id, marketplace FROM raw.subscription_reports
          UNION SELECT brand_id, marketplace FROM raw.sales_daily) s
    JOIN brands b USING (brand_id)
    ORDER BY b.name, s.marketplace`);
}

async function weekEvidence(db: PGlite, selection: string, exports: PublisherExports, brandId: string, marketplace: string, periodStart: string, asOf: string): Promise<WeekEvidence> {
  const [mart] = await queryRows<MartRow>(db, `
    SELECT active_subscriptions::int AS total, source_report_ids, source_complete, source_period_end::text AS source_period_end
    FROM marts.subscription_weekly WHERE brand_id = $1 AND marketplace = $2 AND period_start = $3::date`, [brandId, marketplace, periodStart]);
  const pipeline: PipelineSnapshot | null = mart ? {
    activeSubscriptions: mart.total, sourceReportIds: mart.source_report_ids,
    sourceComplete: mart.source_complete, sourcePeriodEnd: mart.source_period_end,
  } : null;
  const [chosen] = await queryRows<{ report_id: string }>(db,
    `SELECT report_id FROM (${selection}) s WHERE brand_id = $2 AND marketplace = $3 AND period_start = $4::date`,
    [asOf, brandId, marketplace, periodStart]);
  const rows = await queryRows<ReportRow>(db, METRICS_SQL, [brandId, marketplace, periodStart, asOf]);
  const reports: SourceReport[] = rows.map(row => {
    const published = exports.reports.get(row.publisher_report_id);
    return {
      reportId: row.report_id, publisherReportId: row.publisher_report_id, revision: row.revision, status: row.status,
      periodEnd: row.period_end, generatedAt: row.generated_at, extractedAt: row.extracted_at,
      declaredOfferCount: row.declared_offer_count, declaredActiveSubscriptions: row.declared_active_subscriptions,
      loadedOfferCount: row.loaded_offers, loadedActiveSubscriptions: row.loaded_total,
      usedByPipeline: pipeline?.sourceReportIds.includes(row.report_id) ?? false,
      selected: row.report_id === chosen?.report_id,
      supersededBy: published?.supersededBy ?? null, knownToPublisher: Boolean(published),
    };
  });
  const current = currentPublisherReport(exports, brandId, marketplace, periodStart, asOf);
  return {
    periodStart, expectedPeriodEnd: addDays(periodStart, 6), pipeline,
    selected: reports.find(report => report.selected) ?? null,
    publisher: current ? {
      publisherReportId: current.publisherReportId, status: current.status, periodEnd: current.periodEnd,
      generatedAt: current.generatedAt, offerCount: current.offerCount, activeSubscriptions: current.activeSubscriptions,
      offersListed: current.offersListed, offersTotal: current.offersTotal,
    } : null,
    reports,
  };
}

/** Collects facts only: the shipped mart figure, every candidate report, the corrected selection
 * and the publisher's current report. Judging them is python/reconcile.py's job. */
export async function getEvidence(db: PGlite, brandId: string, marketplace = 'US', exports?: PublisherExports): Promise<Evidence> {
  const [brand] = await queryRows<{ name: string }>(db, 'SELECT name FROM brands WHERE brand_id = $1', [brandId]);
  if (!brand) throw new Error(`Unknown brand: ${brandId}. Query SELECT * FROM brands to see valid IDs.`);
  const [{ known }] = await queryRows<{ known: boolean }>(db, `
    SELECT EXISTS (SELECT 1 FROM raw.subscription_reports WHERE brand_id = $1 AND marketplace = $2)
        OR EXISTS (SELECT 1 FROM raw.sales_daily WHERE brand_id = $1 AND marketplace = $2) AS known`, [brandId, marketplace]);
  if (!known) {
    const scopes = (await listScopes(db)).filter(scope => scope.brandId === brandId);
    throw new Error(`Unknown marketplace for ${brandId}: ${marketplace}. Available: ${scopes.map(scope => scope.marketplace).join(', ') || 'none'}.`);
  }
  const selection = await readFile(path.join(ROOT, 'sql', 'select-reports.sql'), 'utf8');
  const published = exports ?? await loadExports();
  const current = await weekEvidence(db, selection, published, brandId, marketplace, PERIOD_START, AS_OF);
  const previous = await weekEvidence(db, selection, published, brandId, marketplace, PREVIOUS_START, AS_OF);

  const [sales] = await queryRows<{ total: string }>(db, `SELECT COALESCE(SUM(product_revenue + promotions + refunds),0)::text AS total FROM raw.sales_daily WHERE brand_id=$1 AND marketplace=$2 AND date BETWEEN $3::date AND $4::date`, [brandId, marketplace, PERIOD_START, PERIOD_END]);
  const [ads] = await queryRows<{ spend: string; sales: string }>(db, `SELECT COALESCE(SUM(spend),0)::text AS spend, COALESCE(SUM(attributed_sales),0)::text AS sales FROM raw.advertising_daily WHERE brand_id=$1 AND marketplace=$2 AND date BETWEEN $3::date AND $4::date`, [brandId, marketplace, PERIOD_START, PERIOD_END]);
  const [inventory] = await queryRows<{ units: string }>(db, `SELECT COALESCE(SUM(available_units),0)::text AS units FROM raw.inventory_snapshots WHERE brand_id=$1 AND marketplace=$2 AND date=(SELECT MAX(date) FROM raw.inventory_snapshots WHERE brand_id=$1 AND marketplace=$2 AND date <= $3::date)`, [brandId, marketplace, PERIOD_END]);
  const selected = [current.selected, previous.selected].filter((report): report is SourceReport => report !== null);
  return {
    brandId, brandName: brand.name, marketplace, periodStart: PERIOD_START, expectedPeriodEnd: PERIOD_END, asOf: AS_OF,
    current, previous,
    // Verified figures are unknown until reconciled; missing data is never zero.
    activeSubscriptions: null, previousSubscriptions: null, growthPct: null,
    sourcePeriodEnd: current.selected?.periodEnd ?? null, sourceComplete: current.selected?.status === 'complete',
    sourceReports: selected.map(report => report.reportId), ingestedAt: current.selected?.extractedAt ?? null,
    previousSourceComplete: previous.selected?.status === 'complete', previousSourcePeriodEnd: previous.selected?.periodEnd ?? null,
    netSales: Number(sales.total), adSpend: Number(ads.spend), attributedAdSales: Number(ads.sales),
    roas: Number(ads.spend) > 0 ? Math.round(Number(ads.sales) / Number(ads.spend) * 100) / 100 : null,
    inventoryUnits: Number(inventory.units),
    sourceSnapshots: selected.map(report => ({ reportId: report.reportId, activeSubscriptions: report.loadedActiveSubscriptions })),
  };
}
