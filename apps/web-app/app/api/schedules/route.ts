import { NextResponse } from 'next/server';
import { ensureSchedulerSchema, getScheduleCursor, setScheduleCursor } from '@aaa/adapters/scheduler';
import { requireSession } from '../../../lib/auth.ts';
import { appDb, isoNow } from '../../../lib/server.ts';

type ScheduleBody = { searchId?: unknown; enabled?: unknown; intervalMinutes?: unknown };

function invalid(message: string) { return NextResponse.json({ error: 'INVALID_REQUEST', message }, { status: 400 }); }
function parseBody(body: ScheduleBody | null): { searchId: string; enabled: boolean; intervalMinutes: number } | null {
  if (!body || typeof body.searchId !== 'string' || body.searchId.length < 1 || body.searchId.length > 256 || typeof body.enabled !== 'boolean') return null;
  const interval = body.intervalMinutes;
  if (!Number.isInteger(interval) || Number(interval) < 1 || Number(interval) > 10080) return null;
  return { searchId: body.searchId, enabled: body.enabled, intervalMinutes: Number(interval) };
}
function shape(row: Record<string, unknown>) {
  const cursor = row.next_due_at ? { nextDueAt: row.next_due_at, lastEnqueuedAt: row.last_enqueued_at } : null;
  return { searchId: row.search_id, enabled: Boolean(row.enabled), intervalMinutes: Number(row.interval_ms) / 60000, updatedAt: row.updated_at, cursor };
}

export async function GET() {
  if (!(await requireSession())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const db = appDb();
  try {
    ensureSchedulerSchema(db);
    const rows = db.prepare(`SELECT d.search_id,d.enabled,d.interval_ms,d.updated_at,c.next_due_at,c.last_enqueued_at
      FROM schedule_definitions d LEFT JOIN schedule_cursors c ON c.search_id=d.search_id ORDER BY d.updated_at DESC`).all() as Array<Record<string, unknown>>;
    return NextResponse.json(rows.map(shape));
  } finally { db.close(); }
}

export async function POST(request: Request) {
  if (!(await requireSession())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const parsed = parseBody(await request.json().catch(() => null) as ScheduleBody | null);
  if (!parsed) return invalid('searchId, enabled, and intervalMinutes (1..10080) are required');
  const db = appDb();
  try {
    ensureSchedulerSchema(db);
    if (!db.prepare('SELECT id FROM searches WHERE id=?').get(parsed.searchId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const now = new Date(); const nowIso = now.toISOString(); const intervalMs = parsed.intervalMinutes * 60000;
    db.prepare(`INSERT INTO schedule_definitions(search_id,enabled,interval_ms,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(search_id) DO UPDATE SET enabled=excluded.enabled,interval_ms=excluded.interval_ms,updated_at=excluded.updated_at`).run(parsed.searchId, parsed.enabled ? 1 : 0, intervalMs, nowIso);
    setScheduleCursor(db, { searchId: parsed.searchId, nextDueAt: new Date(now.getTime() + intervalMs) });
    return NextResponse.json({ searchId: parsed.searchId, enabled: parsed.enabled, intervalMinutes: parsed.intervalMinutes, updatedAt: nowIso, cursor: { nextDueAt: getScheduleCursor(db, parsed.searchId)!.nextDueAt.toISOString(), lastEnqueuedAt: null } }, { status: 201 });
  } finally { db.close(); }
}
