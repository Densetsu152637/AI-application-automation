import { NextResponse } from 'next/server';
import { ensureSchedulerSchema, getScheduleCursor, setScheduleCursor } from '@aaa/adapters/scheduler';
import { requireSession } from '../../../../lib/auth.ts';
import { appDb } from '../../../../lib/server.ts';

function invalid(message: string) { return NextResponse.json({ error: 'INVALID_REQUEST', message }, { status: 400 }); }

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const { id } = await context.params; const db = appDb();
  try {
    ensureSchedulerSchema(db);
    const row = db.prepare(`SELECT d.search_id,d.enabled,d.interval_ms,d.updated_at,c.next_due_at,c.last_enqueued_at
      FROM schedule_definitions d LEFT JOIN schedule_cursors c ON c.search_id=d.search_id WHERE d.search_id=?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const cursor = getScheduleCursor(db, id);
    return NextResponse.json({ searchId: row.search_id, enabled: Boolean(row.enabled), intervalMinutes: Number(row.interval_ms) / 60000, updatedAt: row.updated_at, cursor: cursor && { nextDueAt: cursor.nextDueAt.toISOString(), lastEnqueuedAt: cursor.lastEnqueuedAt?.toISOString() ?? null } });
  } finally { db.close(); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { enabled?: unknown; intervalMinutes?: unknown } | null;
  if (!body || (body.enabled !== undefined && typeof body.enabled !== 'boolean') || (body.intervalMinutes !== undefined && (!Number.isInteger(body.intervalMinutes) || Number(body.intervalMinutes) < 1 || Number(body.intervalMinutes) > 10080))) return invalid('enabled must be boolean and intervalMinutes must be 1..10080');
  const db = appDb();
  try {
    ensureSchedulerSchema(db);
    const current = db.prepare('SELECT enabled,interval_ms FROM schedule_definitions WHERE search_id=?').get(id) as { enabled: number; interval_ms: number } | undefined;
    if (!current) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const enabled = body.enabled === undefined ? Boolean(current.enabled) : body.enabled;
    const intervalMinutes = body.intervalMinutes === undefined ? current.interval_ms / 60000 : Number(body.intervalMinutes);
    const now = new Date(); const intervalMs = intervalMinutes * 60000;
    db.prepare('UPDATE schedule_definitions SET enabled=?,interval_ms=?,updated_at=? WHERE search_id=?').run(enabled ? 1 : 0, intervalMs, now.toISOString(), id);
    // Re-enabling or changing cadence starts a fresh interval and never catches up old work.
    const cursor = (body.enabled !== undefined || body.intervalMinutes !== undefined)
      ? setScheduleCursor(db, { searchId: id, nextDueAt: new Date(now.getTime() + intervalMs) })
      : getScheduleCursor(db, id);
    return NextResponse.json({ searchId: id, enabled, intervalMinutes, updatedAt: now.toISOString(), cursor: cursor && { nextDueAt: cursor.nextDueAt.toISOString(), lastEnqueuedAt: cursor.lastEnqueuedAt?.toISOString() ?? null } });
  } finally { db.close(); }
}
