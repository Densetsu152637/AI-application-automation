import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../lib/auth.ts';
import { appDb } from '../../../../../lib/server.ts';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const { id } = await context.params;
  const match = request.headers.get('if-match');
  if (!match) return NextResponse.json({ error: 'PRECONDITION_REQUIRED' }, { status: 428 });
  const db = appDb();
  try {
    const row = db.prepare('SELECT revision,criteria_json FROM searches WHERE id=?').get(id) as { revision: number; criteria_json: string } | undefined;
    if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (match !== `"${row.revision}"`) return NextResponse.json({ error: 'REVISION_CONFLICT', currentRevision: row.revision }, { status: 409 });
    let criteria: unknown;
    try { criteria = JSON.parse(row.criteria_json); } catch { criteria = null; }
    const issues = Array.isArray(criteria) && criteria.length > 0 ? [] : [{ code: 'INVALID_CRITERIA', message: 'At least one criterion is required.' }];
    return NextResponse.json({ valid: issues.length === 0, issues }, { status: 200, headers: { 'Cache-Control': 'private, no-store', ETag: `"${row.revision}"` } });
  } finally { db.close(); }
}
