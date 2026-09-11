import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../lib/auth.ts';
import { appDb } from '../../../../../lib/server.ts';
import { controlRun } from '../control.ts';
import { apiError, requestId, requireMutationOrigin } from '../../../../../lib/api.ts';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const id = requestId(request); if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, id);
  const expected = Number((request.headers.get('if-match') ?? '').replaceAll('"', ''));
  if (!Number.isInteger(expected) || expected < 1) return NextResponse.json({ error: 'PRECONDITION_REQUIRED' }, { status: 428 });
  const db = appDb(); try { const result = controlRun(db, (await context.params).id, 'cancel_run', expected); return NextResponse.json(result, { status: result.status ?? 202 }); } finally { db.close(); }
}
