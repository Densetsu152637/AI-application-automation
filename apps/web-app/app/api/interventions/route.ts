import { NextResponse } from 'next/server';
import { authenticatedSessionBinding, interventionError, listInterventions, publicIntervention } from '../../../lib/interventions.ts';

export async function GET(request: Request) {
  if (!(await authenticatedSessionBinding())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? undefined;
  const targetId = url.searchParams.get('targetId') ?? undefined;
  const allowed = new Set(['open', 'takeover_requested', 'suspended', 'human_active', 'resolving', 'resolved', 'cancelled', 'expired']);
  if (state && !allowed.has(state)) return NextResponse.json({ error: 'INVALID_REQUEST', message: 'state is invalid' }, { status: 400 });
  return NextResponse.json(listInterventions(state, targetId).map(publicIntervention), { headers: { 'Cache-Control': 'private, no-store' } });
}
