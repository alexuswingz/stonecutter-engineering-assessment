/** Reproduce "the evidence changed" without touching the bundled inputs.
 *
 * Copies the publisher exports to .runtime/changed-exports and appends one newer, complete publisher
 * report for a brand and marketplace in the reporting week. Start the app with EXPORTS_DIR pointing
 * at the copy: any decision saved for that scope then needs attention and its report is withheld.
 *
 *   npm run evidence:change -- --brand cedar-coast --marketplace US
 */
import { appendFile, cp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { AS_OF, PERIOD_END, PERIOD_START, ROOT } from '../src/database.ts';
import { EXPORTS_DIR, currentPublisherReport, loadExports } from '../src/exports.ts';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const brandId = option('--brand'), marketplace = option('--marketplace');
const target = path.join(ROOT, '.runtime', 'changed-exports');

async function main(): Promise<void> {
  if (!brandId || !marketplace) throw new Error('Usage: npm run evidence:change -- --brand <brand_id> --marketplace <marketplace>');
  const current = currentPublisherReport(await loadExports(EXPORTS_DIR), brandId, marketplace, PERIOD_START, AS_OF);
  if (!current) throw new Error(`The publisher export has no report for ${brandId} / ${marketplace} in the week of ${PERIOD_START}.`);

  await rm(target, { recursive: true, force: true });
  await cp(EXPORTS_DIR, target, { recursive: true });
  const [header, ...lines] = (await readFile(path.join(EXPORTS_DIR, 'subscription_offers.csv'), 'utf8')).trim().split(/\r?\n/);
  const columns = header.split(',');
  const at = (name: string) => columns.indexOf(name);
  const offers = lines.map(line => line.split(',')).filter(cells => cells[at('publisher_report_id')] === current.publisherReportId);

  // One more subscription per offer than the report it replaces, published an hour before the evaluation time.
  const id = `${current.publisherReportId}-revised`;
  const generatedAt = new Date(Date.parse(AS_OF) - 3_600_000).toISOString().replace('.000Z', 'Z');
  const total = offers.reduce((sum, cells) => sum + Number(cells[at('active_subscriptions')]) + 1, 0);
  await appendFile(path.join(target, 'subscription_reports.csv'),
    `${id},${brandId},${marketplace},${PERIOD_START},${PERIOD_END},complete,${generatedAt},,${offers.length},${total}\n`);
  await appendFile(path.join(target, 'subscription_offers.csv'), offers.map(cells => {
    const row = [...cells];
    row[at('publisher_report_id')] = id;
    row[at('active_subscriptions')] = String(Number(cells[at('active_subscriptions')]) + 1);
    return row.join(',');
  }).join('\n') + '\n');

  console.log(`Wrote ${path.relative(ROOT, target)} with a new publisher report ${id} (${total} subscriptions, complete).`);
  console.log('The bundled data/exports is unchanged. Restart the app against the copy:');
  console.log('  macOS/Linux:  EXPORTS_DIR=.runtime/changed-exports npm run dev');
  console.log('  PowerShell:   $env:EXPORTS_DIR=".runtime/changed-exports"; npm run dev');
  console.log('Restart without EXPORTS_DIR to return to the bundled evidence.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
