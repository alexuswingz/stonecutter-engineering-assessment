import { respond } from '../../../../../../src/review/http.ts';
import { clientReport } from '../../../../../../src/review/service.ts';

type Context = { params: Promise<{ brandId: string; marketplace: string }> };

/** GET: the client report generated from the saved decision, or 409 when there is none or it is stale. */
export async function GET(_request: Request, { params }: Context) {
  const { brandId, marketplace } = await params;
  return respond(deps => clientReport(deps, brandId, marketplace));
}
