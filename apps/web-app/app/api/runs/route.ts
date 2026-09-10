import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth.ts';
import { appDb } from '../../../lib/server.ts';
export async function GET() { if (!(await requireSession())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 }); const db = appDb(); try { const runs = db.prepare('SELECT id,operation_id,state,started_at,finished_at,source_count,listing_count,error_code FROM scan_runs ORDER BY started_at DESC LIMIT 50').all() as Array<Record<string, unknown>>; return NextResponse.json(runs.map(run => ({ id: run.id, operationId: run.operation_id, state: run.state, startedAt: run.started_at, finishedAt: run.finished_at, sourceCount: run.source_count, listingCount: run.listing_count, errorCode: run.error_code }))); } finally { db.close(); } }
