import { NextResponse } from 'next/server';
import { authenticatedSessionBinding, interventionError, issueViewTicket, getIntervention } from '../../../../../lib/interventions.ts';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionId = await authenticatedSessionBinding();
  if (!sessionId) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const { id } = await context.params;
  if (!getIntervention(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const ticket = issueViewTicket(id, sessionId);
    return NextResponse.json(ticket, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const result = interventionError(error, id);
    return NextResponse.json(result.body, { status: result.status });
  }
}
