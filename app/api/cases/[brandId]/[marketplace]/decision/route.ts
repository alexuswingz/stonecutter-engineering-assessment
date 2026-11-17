import { readJson, respond } from '../../../../../../src/review/http.ts';
import { saveDecision } from '../../../../../../src/review/service.ts';

type Context = { params: Promise<{ brandId: string; marketplace: string }> };

/** POST: save a review decision. The service recomputes the evidence and rejects unsupported approvals. */
export async function POST(request: Request, { params }: Context) {
  const { brandId, marketplace } = await params;
  const body = await readJson(request);
  return respond(deps => saveDecision(deps, brandId, marketplace, body), 201);
}
