import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { digest, equalSecret, token } from './security.ts';

export function ensureAdministrator(db: Database.Database, secret: string): void {
  const row = db.prepare('SELECT id FROM administrator LIMIT 1').get() as { id: string } | undefined;
  if (!row) db.prepare('INSERT INTO administrator (id, secret_hash, created_at) VALUES (?, ?, ?)').run(randomUUID(), digest(secret), new Date().toISOString());
}
export function createSession(db: Database.Database, secret: string, ttlHours = 12): string | null {
  const row = db.prepare('SELECT id, secret_hash FROM administrator LIMIT 1').get() as { id: string; secret_hash: string } | undefined;
  if (!row || !equalSecret(digest(secret), row.secret_hash)) return null;
  const raw = token(); const expires = new Date(Date.now() + ttlHours * 3600_000).toISOString();
  db.prepare('INSERT INTO dashboard_sessions VALUES (?, ?, ?, NULL)').run(digest(raw), row.id, expires);
  return raw;
}
export function sessionIsValid(db: Database.Database, raw: string): boolean {
  const row = db.prepare('SELECT expires_at, revoked_at FROM dashboard_sessions WHERE token_hash = ?').get(digest(raw)) as { expires_at: string; revoked_at: string | null } | undefined;
  return !!row && !row.revoked_at && Date.parse(row.expires_at) > Date.now();
}
export function revokeSession(db: Database.Database, raw: string): void { db.prepare('UPDATE dashboard_sessions SET revoked_at = ? WHERE token_hash = ?').run(new Date().toISOString(), digest(raw)); }
export function purgeSessions(db: Database.Database): void { db.prepare('DELETE FROM dashboard_sessions WHERE revoked_at IS NOT NULL OR expires_at <= ?').run(new Date().toISOString()); }
export function claimOperation(db: Database.Database): { id: string; kind: string; targetId: string | null } | null {
  const control = db.prepare('SELECT paused FROM runtime_control WHERE id=1').get() as { paused: number } | undefined;
  if (control?.paused) return null;
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT id,kind,target_id AS targetId FROM operations WHERE state='queued' ORDER BY created_at LIMIT 1").get() as { id: string; kind: string; targetId: string | null } | undefined;
    if (!row) return null;
    const changed = db.prepare("UPDATE operations SET state='running', progress=5, updated_at=? WHERE id=? AND state='queued'").run(new Date().toISOString(), row.id);
    return changed.changes ? row : null;
  });
  return tx.immediate();
}
export function setWorkPaused(db: Database.Database, paused: boolean): void {
  db.prepare('UPDATE runtime_control SET paused=?,updated_at=? WHERE id=1').run(paused ? 1 : 0, new Date().toISOString());
}
export function finishOperation(db: Database.Database, id: string, state: 'succeeded' | 'failed', errorCode: string | null = null): void { db.prepare('UPDATE operations SET state=?, progress=?, error_code=?, updated_at=? WHERE id=?').run(state, state === 'succeeded' ? 100 : 0, errorCode, new Date().toISOString(), id); }
