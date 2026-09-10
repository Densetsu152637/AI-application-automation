import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../lib/auth.ts';
import { appDb } from '../../../../../lib/server.ts';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const { id } = await context.params; const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get('limit') ?? 50)));
  const db = appDb(); try {
    const run = db.prepare('SELECT id FROM scan_runs WHERE id=?').get(id); if (!run) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ items: [], nextCursor: null, runId: id, limit }, { headers: { 'Cache-Control': 'private, no-store' } });
  } finally { db.close(); }
}
