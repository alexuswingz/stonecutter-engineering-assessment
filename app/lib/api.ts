'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError } from '../../src/review/types.ts';

/** A failed API call, carrying the service's error code so the UI can offer the right recovery. */
export class ApiFailure extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly details: string[] = []) {
    super(message);
    this.name = 'ApiFailure';
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init, cache: 'no-store',
      ...(init?.json !== undefined ? { body: JSON.stringify(init.json), headers: { 'content-type': 'application/json' } } : {}),
    });
  } catch {
    throw new ApiFailure('network', 0, 'The review service could not be reached. Check that the server is running, then try again.');
  }
  let body: unknown = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const error = (body as ApiError | null)?.error;
    throw new ApiFailure(error?.code ?? 'http_error', response.status, error?.message ?? `The request failed (HTTP ${response.status}).`, error?.details ?? []);
  }
  return body as T;
}

export type Resource<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: ApiFailure };

/** Loads a resource whenever `key` changes. A changed key returns to the loading state at once, and a
 * response that arrives for an earlier key is ignored, so the screen never shows another case's data. */
export function useResource<T>(key: string, load: () => Promise<T>): Resource<T> & { reload: () => void; set: (data: T) => void } {
  const [state, setState] = useState<{ key: string; resource: Resource<T> }>({ key, resource: { status: 'loading', data: null, error: null } });
  const [attempt, setAttempt] = useState(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    let active = true;
    setState({ key, resource: { status: 'loading', data: null, error: null } });
    loader.current().then(
      data => { if (active) setState({ key, resource: { status: 'ready', data, error: null } }); },
      (error: unknown) => {
        if (!active) return;
        const failure = error instanceof ApiFailure ? error : new ApiFailure('unexpected', 0, error instanceof Error ? error.message : 'Unexpected error.');
        setState({ key, resource: { status: 'error', data: null, error: failure } });
      });
    return () => { active = false; };
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt(value => value + 1), []);
  const set = useCallback((data: T) => setState(current => ({ key: current.key, resource: { status: 'ready', data, error: null } })), []);
  const resource: Resource<T> = state.key === key ? state.resource : { status: 'loading', data: null, error: null };
  return { ...resource, reload, set };
}

export const caseUrl = (brandId: string, marketplace: string) => `/api/cases/${encodeURIComponent(brandId)}/${encodeURIComponent(marketplace)}`;
export const casePath = (brandId: string, marketplace: string) => `/cases/${encodeURIComponent(brandId)}/${encodeURIComponent(marketplace)}`;
