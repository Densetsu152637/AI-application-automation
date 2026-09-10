import { NextResponse } from 'next/server';
import { authenticatedSessionBinding, etag, getIntervention, interventionError, publicIntervention, resolveIntervention, revisionFromIfMatch } from '../../../../../lib/interventions.ts';

const resolutions = new Set(['completed', 'not_submitted', 'submission_unknown', 'dismissed']);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authenticatedSessionBinding())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const { id } = await context.params;
  const record = getIntervention(id);
  if (!record) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const expected = revisionFromIfMatch(request.headers.get('if-match'));
  if (expected === undefined) return NextResponse.json({ error: 'PRECONDITION_REQUIRED', message: 'If-Match must contain the current revision.' }, { status: 428 });
  const body = await request.json().catch(() => null) as { kind?: unknown; note?: unknown } | null;
  if (typeof body?.kind !== 'string' || !resolutions.has(body.kind) || typeof body.note !== 'string' || !body.note.trim()) return NextResponse.json({ error: 'INVALID_REQUEST', message: 'kind and a non-empty note are required.' }, { status: 400 });
  try {
    const updated = resolveIntervention(id, expected, body.kind as 'completed' | 'not_submitted' | 'submission_unknown' | 'dismissed', body.note);
    return NextResponse.json(publicIntervention(updated), { headers: { ETag: etag(updated), 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const result = interventionError(error, id);
    return NextResponse.json(result.body, { status: result.status });
  }
}
