import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './database.ts';
import type { Evidence, Quality } from './types.ts';

export const venvPython = path.join(ROOT, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const verified = new Set<string>();
export function pythonCommand(useVenv = true): string {
  const choices = useVenv && existsSync(venvPython) ? [venvPython]
    : process.env.PYTHON ? [process.env.PYTHON] : ['python3', 'python'];
  for (const command of choices) {
    if (verified.has(command)) return command;
    const result = spawnSync(command, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'], { timeout: 10000 });
    if (result.status === 0) { verified.add(command); return command; }
  }
  throw new Error('Python 3.11+ was not found. Install Python, then run npm run setup. PYTHON may specify its executable path.');
}

export interface Reconciled { evidence: Evidence; quality: Quality }

function isReconciled(value: unknown): value is Reconciled {
  const item = value as Partial<Reconciled> | null;
  return Boolean(item?.evidence) && ['ready', 'insufficient'].includes(item?.quality?.status ?? '')
    && Array.isArray(item?.quality?.reasons) && Array.isArray(item?.quality?.checks);
}

/** One Python process judges any number of evidence objects; its output is validated before use. */
export function reconcileMany(evidence: Evidence[]): Reconciled[] {
  if (evidence.length === 0) return [];
  const result = spawnSync(pythonCommand(), [path.join(ROOT, 'python/reconcile.py')], {
    input: JSON.stringify(evidence), encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  if (result.error || result.status !== 0) throw new Error(`Python reconciliation failed: ${result.error?.message ?? result.stderr}`);
  let output: unknown;
  try { output = JSON.parse(result.stdout); }
  catch { throw new Error('Python reconciliation returned invalid JSON.'); }
  if (!Array.isArray(output) || output.length !== evidence.length || !output.every(isReconciled)) {
    throw new Error('Python reconciliation returned an invalid result.');
  }
  return output;
}

export function reconcile(evidence: Evidence): Reconciled {
  return reconcileMany([evidence])[0];
}
