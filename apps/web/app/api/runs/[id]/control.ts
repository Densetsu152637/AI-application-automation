import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { isoNow } from '../../../../lib/server.ts';

export function controlRun(db: Database.Database, id: string, kind: 'pause_run' | 'resume_run' | 'cancel_run', expected: number) {
  const row = db.prepare('SELECT id,revision,state,pause_requested,cancel_requested FROM scan_runs WHERE id=?').get(id) as { id: string; revision: number; state: string; pause_requested: number; cancel_requested: number } | undefined;
  if (!row) return { error: 'NOT_FOUND', status: 404 } as const;
  if (row.revision !== expected) return { error: 'REVISION_CONFLICT', status: 409, currentRevision: row.revision } as const;
  if (['completed', 'failed', 'cancelled'].includes(row.state)) return { error: 'STATE_CONFLICT', status: 409, currentRevision: row.revision } as const;
  const now = isoNow(); const revision = row.revision + 1;
  const fields = kind === 'pause_run' ? 'pause_requested=1' : kind === 'cancel_run' ? 'cancel_requested=1' : 'pause_requested=0,state=\'running\'';
  const operationId = randomUUID();
  db.transaction(() => {
    db.prepare(`UPDATE scan_runs SET ${fields},revision=? WHERE id=? AND revision=?`).run(revision, id, expected);
    db.prepare('INSERT INTO operations (id,kind,state,progress,error_code,created_at,updated_at,target_id) VALUES (?,?,\'queued\',0,NULL,?,?,?)').run(operationId, kind, now, now, id);
  }).immediate();
  return { operationId, id, revision, state: kind === 'cancel_run' ? 'cancellation_requested' : kind === 'pause_run' ? 'pause_requested' : 'resume_requested' } as const;
}
