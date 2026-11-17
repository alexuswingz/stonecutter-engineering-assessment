import { openDatabase } from '../../../src/database.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await openDatabase(true);
  try {
    const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM brands');
    return Response.json({ ok: true, brands: rows[0].n });
  } finally { await db.close(); }
}
