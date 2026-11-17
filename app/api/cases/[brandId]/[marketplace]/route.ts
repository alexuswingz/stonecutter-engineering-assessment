import { respond } from '../../../../../src/review/http.ts';
import { getCase, openCase } from '../../../../../src/review/service.ts';

type Context = { params: Promise<{ brandId: string; marketplace: string }> };

/** GET: read the case and its current evidence without changing anything. */
export async function GET(_request: Request, { params }: Context) {
  const { brandId, marketplace } = await params;
  return respond(deps => getCase(deps, brandId, marketplace));
}

/** POST: open the case (idempotent) and return it. */
export async function POST(_request: Request, { params }: Context) {
  const { brandId, marketplace } = await params;
  return respond(deps => openCase(deps, brandId, marketplace));
}
