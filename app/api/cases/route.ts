import { respond } from '../../../src/review/http.ts';
import { listCases } from '../../../src/review/service.ts';

export const dynamic = 'force-dynamic';

/** GET /api/cases: every brand and marketplace in the data, with its evidence summary and case status. */
export function GET() {
  return respond(deps => listCases(deps));
}
