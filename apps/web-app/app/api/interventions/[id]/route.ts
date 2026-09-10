import { NextResponse } from 'next/server';
import { authenticatedSessionBinding, etag, getIntervention, publicIntervention } from '../../../../lib/interventions.ts';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authenticatedSessionBinding())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const { id } = await context.params;
  const record = getIntervention(id);
  if (!record) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json(publicIntervention(record), { headers: { ETag: etag(record), 'Cache-Control': 'private, no-store' } });
}
