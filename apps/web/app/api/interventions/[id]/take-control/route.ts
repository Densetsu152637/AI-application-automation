import { NextResponse } from 'next/server';
import { authenticatedSessionBinding, etag, getIntervention, interventionError, publicIntervention, requestTakeover, revisionFromIfMatch } from '../../../../../lib/interventions.ts';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authenticatedSessionBinding())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const { id } = await context.params;
  const record = getIntervention(id);
  if (!record) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const expected = revisionFromIfMatch(request.headers.get('if-match'));
  if (expected === undefined) return NextResponse.json({ error: 'PRECONDITION_REQUIRED', message: 'If-Match must contain the current revision.' }, { status: 428 });
  try {
    const updated = requestTakeover(id, expected);
    return NextResponse.json({ operationId: null, target: { kind: 'intervention', id }, data: publicIntervention(updated) }, { status: 202, headers: { ETag: etag(updated), 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const result = interventionError(error, id);
    return NextResponse.json(result.body, { status: result.status });
  }
}
