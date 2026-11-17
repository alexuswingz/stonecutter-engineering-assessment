import { getDeps } from './runtime.ts';
import { ReviewError, type ReviewDeps } from './service.ts';
import type { ApiError } from './types.ts';

/** Runs a service call and maps the outcome to JSON. Every failure has the same shape
 * ({ error: { code, message, details } }) so the client can explain it and offer a way forward. */
export async function respond(work: (deps: ReviewDeps) => Promise<unknown>, status = 200): Promise<Response> {
  try {
    return Response.json(await work(await getDeps()), { status, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ReviewError) {
      const body: ApiError = { error: { code: error.code, message: error.message, details: error.details } };
      return Response.json(body, { status: error.status });
    }
    console.error('[review] request failed', error);
    // Full detail goes to the server log; the reviewer gets the cause in one line and a way forward.
    const cause = (error instanceof Error ? error.message : 'Unexpected error.').split('\n')[0].slice(0, 240);
    const body: ApiError = { error: { code: 'internal_error', message: 'The review service could not complete the request. Nothing was saved. Try again; if it keeps failing, check the server log.', details: [cause] } };
    return Response.json(body, { status: 500 });
  }
}

/** Reads a JSON body; a missing or malformed body becomes null and is rejected by the service. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch { return null; }
}
