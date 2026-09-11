import { digest, token } from '@aaa/adapters/security';
import { createIntervention, InterventionDomainError, transitionIntervention, type InterventionEvent, type ViewerTicket } from '../../../packages/domain/src/intervention.ts';
import { appDb } from './server.ts';

export type InterventionRecord = ReturnType<typeof createIntervention> & { revision: number };
type Db = ReturnType<typeof appDb>;
type InterventionRow = {
  id: string; target_id: string; state: InterventionRecord['state']; required_action: string;
  known_context_json: string; browser_generation: number; revision: number;
  resolution: InterventionRecord['resolution'] | null; resolution_note: string | null;
  created_at: string; updated_at: string;
};
type TicketRow = {
  token_hash: string; session_id: string; intervention_id: string; browser_generation: number;
  issued_at: string; expires_at: string; consumed_at: string | null; revoked_at: string | null;
};

function close<T>(db: Db, fn: () => T): T { try { return fn(); } finally { db.close(); } }
function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid persisted ${field}`);
  return date;
}
function fromRow(row: InterventionRow): InterventionRecord {
  let context: Record<string, string>;
  try { context = JSON.parse(row.known_context_json) as Record<string, string>; } catch { throw new Error('invalid persisted intervention context'); }
  return {
    id: row.id, targetId: row.target_id, state: row.state, requiredAction: row.required_action,
    knownContext: context, browserGeneration: row.browser_generation, revision: row.revision,
    ...(row.resolution === null ? {} : { resolution: row.resolution }),
    ...(row.resolution_note === null ? {} : { resolutionNote: row.resolution_note }),
    createdAt: parseDate(row.created_at, 'created_at'), updatedAt: parseDate(row.updated_at, 'updated_at'),
  };
}
function selectIntervention(db: Db, id: string): InterventionRecord | undefined {
  const row = db.prepare('SELECT * FROM interventions WHERE id = ?').get(id) as InterventionRow | undefined;
  return row ? fromRow(row) : undefined;
}
function insertIntervention(db: Db, record: InterventionRecord): void {
  db.prepare(`INSERT INTO interventions
    (id, target_id, state, required_action, known_context_json, browser_generation, revision, resolution, resolution_note, created_at, updated_at)
    VALUES (@id, @targetId, @state, @requiredAction, @knownContextJson, @browserGeneration, @revision, @resolution, @resolutionNote, @createdAt, @updatedAt)`)
    .run({ id: record.id, targetId: record.targetId, state: record.state, requiredAction: record.requiredAction,
      knownContextJson: JSON.stringify(record.knownContext), browserGeneration: record.browserGeneration, revision: record.revision,
      resolution: record.resolution ?? null, resolutionNote: record.resolutionNote ?? null,
      createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() });
}

export async function authenticatedSessionBinding(): Promise<string | null> {
  // A local deployment has one implicit dashboard principal. Keep the binding
  // stable so agent and browser requests can share intervention tickets.
  return digest('local-dashboard-principal');
}

export function registerIntervention(input: Parameters<typeof createIntervention>[0], id = input.id): InterventionRecord {
  const db = appDb();
  return close(db, () => db.transaction(() => {
    const existing = selectIntervention(db, id);
    if (existing) return existing;
    const record = { ...createIntervention({ ...input, id }), revision: 1 };
    insertIntervention(db, record);
    return record;
  }).immediate());
}

export function getIntervention(id: string): InterventionRecord | undefined {
  const db = appDb();
  return close(db, () => selectIntervention(db, id));
}

export function listInterventions(state?: string, targetId?: string): InterventionRecord[] {
  const db = appDb();
  return close(db, () => {
    const clauses: string[] = []; const params: Record<string, string> = {};
    if (state) { clauses.push('state = @state'); params.state = state; }
    if (targetId) { clauses.push('target_id = @targetId'); params.targetId = targetId; }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    return (db.prepare(`SELECT * FROM interventions${where} ORDER BY updated_at DESC, id ASC`).all(params) as InterventionRow[]).map(fromRow);
  });
}

function withRevision(id: string, expected: number | undefined, event: InterventionEvent): InterventionRecord {
  if (expected === undefined) throw new InterventionDomainError('INVALID_TRANSITION', 'If-Match revision is required');
  const db = appDb();
  return close(db, () => db.transaction(() => {
    const record = selectIntervention(db, id);
    if (!record) throw new InterventionDomainError('INVALID_INTERVENTION', 'intervention was not found');
    if (expected !== record.revision) throw new InterventionDomainError('INVALID_TRANSITION', 'intervention revision is stale');
    const updated = { ...transitionIntervention(record, event), revision: record.revision + 1 };
    const result = db.prepare(`UPDATE interventions SET state=@state, resolution=@resolution, resolution_note=@resolutionNote,
      revision=@nextRevision, updated_at=@updatedAt WHERE id=@id AND revision=@revision`)
      .run({ id, state: updated.state, resolution: updated.resolution ?? null, resolutionNote: updated.resolutionNote ?? null,
        nextRevision: updated.revision, updatedAt: updated.updatedAt.toISOString(), revision: record.revision });
    if (result.changes !== 1) throw new InterventionDomainError('INVALID_TRANSITION', 'intervention revision is stale');
    return updated;
  }).immediate());
}

export function requestTakeover(id: string, expectedRevision: number): InterventionRecord { return withRevision(id, expectedRevision, { type: 'request_takeover' }); }

/** Worker/bridge acknowledgement hook. It intentionally is not exposed as a browser API. */
export function acknowledgeSuspension(id: string): InterventionRecord {
  const db = appDb();
  return close(db, () => db.transaction(() => {
    const record = selectIntervention(db, id);
    if (!record) throw new InterventionDomainError('INVALID_INTERVENTION', 'intervention was not found');
    const updated = { ...transitionIntervention(record, { type: 'suspend_automation' }), revision: record.revision + 1 };
    const result = db.prepare('UPDATE interventions SET state = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?')
      .run(updated.state, updated.revision, updated.updatedAt.toISOString(), id, record.revision);
    if (result.changes !== 1) throw new InterventionDomainError('INVALID_TRANSITION', 'intervention revision is stale');
    return updated;
  }).immediate());
}

export function issueViewTicket(id: string, sessionId: string): { token: string; expiresAt: string; viewerPath: string } {
  const db = appDb();
  return close(db, () => db.transaction(() => {
    const record = selectIntervention(db, id);
    if (!record) throw new InterventionDomainError('INVALID_INTERVENTION', 'intervention was not found');
    if (record.state !== 'suspended') throw new InterventionDomainError('INVALID_TRANSITION', 'browser suspension has not been acknowledged');
    const now = new Date();
    const active = db.prepare(`SELECT 1 FROM intervention_viewer_tickets
      WHERE session_id = ? AND intervention_id = ? AND browser_generation = ?
      AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ? LIMIT 1`)
      .get(sessionId, id, record.browserGeneration, now.toISOString());
    if (active) throw new InterventionDomainError('TICKET_ALREADY_ISSUED', 'an active ticket already exists for this binding');
    const plain = token(); const issuedAt = now.toISOString(); const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO intervention_viewer_tickets
      (token_hash, session_id, intervention_id, browser_generation, issued_at, expires_at, consumed_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`).run(digest(plain), sessionId, id, record.browserGeneration, issuedAt, expiresAt);
    return { token: plain, expiresAt, viewerPath: `/browser/${encodeURIComponent(id)}` };
  }).immediate());
}

export function consumeViewTicket(plainToken: string, binding: { sessionId: string; interventionId: string; browserGeneration: number }, now = new Date()): ViewerTicket {
  const db = appDb();
  return close(db, () => db.transaction(() => {
    const row = db.prepare('SELECT * FROM intervention_viewer_tickets WHERE token_hash = ?').get(digest(plainToken)) as TicketRow | undefined;
    if (!row) throw new InterventionDomainError('TICKET_NOT_FOUND', 'viewer ticket is invalid');
    if (row.revoked_at) throw new InterventionDomainError('TICKET_REVOKED', 'viewer ticket has been revoked');
    if (row.consumed_at) throw new InterventionDomainError('TICKET_REPLAYED', 'viewer ticket has already been consumed');
    if (parseDate(row.expires_at, 'expires_at') <= now) throw new InterventionDomainError('TICKET_EXPIRED', 'viewer ticket has expired');
    if (row.session_id !== binding.sessionId || row.intervention_id !== binding.interventionId || row.browser_generation !== binding.browserGeneration) throw new InterventionDomainError('TICKET_BINDING_MISMATCH', 'viewer ticket binding does not match');
    const result = db.prepare('UPDATE intervention_viewer_tickets SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL').run(now.toISOString(), row.token_hash);
    if (result.changes !== 1) throw new InterventionDomainError('TICKET_REPLAYED', 'viewer ticket has already been consumed');
    return { tokenHash: row.token_hash, sessionId: row.session_id, interventionId: row.intervention_id, browserGeneration: row.browser_generation,
      issuedAt: parseDate(row.issued_at, 'issued_at'), expiresAt: parseDate(row.expires_at, 'expires_at'), consumedAt: now, revokedAt: null };
  }).immediate());
}

export function resolveIntervention(id: string, expectedRevision: number, resolution: NonNullable<InterventionRecord['resolution']>, note?: string): InterventionRecord {
  const record = getIntervention(id);
  if (!record) throw new InterventionDomainError('INVALID_INTERVENTION', 'intervention was not found');
  if (!note?.trim()) throw new InterventionDomainError('INVALID_INTERVENTION', 'resolution note is required');
  return withRevision(id, expectedRevision, { type: 'resolve', resolution, note: note.trim() });
}

export function publicIntervention(record: InterventionRecord) {
  return { id: record.id, revision: record.revision, targetId: record.targetId, state: record.state, requiredAction: record.requiredAction, knownContext: record.knownContext, browserGeneration: record.browserGeneration, browserAvailable: record.state === 'suspended' || record.state === 'human_active', resolution: record.resolution ?? null, resolutionNote: record.resolutionNote ?? null, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
}
export function revisionFromIfMatch(value: string | null): number | undefined { if (!value) return undefined; const match = /^"?(\d+)"?$/.exec(value.trim()); return match ? Number(match[1]) : undefined; }
export function interventionError(error: unknown, entityId: string | null = null) {
  if (error instanceof InterventionDomainError) { const code = error.message.includes('revision') ? 'REVISION_CONFLICT' : error.code; const status = code === 'REVISION_CONFLICT' || error.code === 'INVALID_TRANSITION' ? 409 : 400; return { status, body: { error: code, message: error.message, entityId } }; }
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'The intervention request could not be completed.', entityId } };
}
export function etag(record: InterventionRecord): string { return `"${record.revision}"`; }
