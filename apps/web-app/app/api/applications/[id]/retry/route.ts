import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../../lib/auth.ts';
import { appDb, isoNow } from '../../../../../lib/server.ts';
import { apiError, apiOk, bodyHash, findIdempotency, idempotencyKey, idempotencyScope, requestId, requireMutationOrigin, saveIdempotency } from '../../../../../lib/api.ts';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  if (!(await requireSession())) return apiError('UNAUTHENTICATED', 401, rid);
  if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, rid);
  const expected = request.headers.get('if-match'); if (!expected) return apiError('PRECONDITION_REQUIRED', 428, rid);
  const key = idempotencyKey(request); if (!key) return apiError('IDEMPOTENCY_KEY_REQUIRED', 428, rid);
  const { id } = await context.params; const db = appDb(); const raw = await request.json().catch(() => null); const hash = bodyHash(raw);
  try {
    const scope = idempotencyScope(request, `/api/v1/applications/${id}/retry`, 'administrator');
    const prior = findIdempotency(db, scope, key, hash); if (prior === 'CONFLICT') return apiError('IDEMPOTENCY_CONFLICT', 409, rid, { entityId: id }); if (prior) return apiOk(prior.body, prior.status, rid);
    const row = db.prepare('SELECT * FROM application_attempts WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return apiError('NOT_FOUND', 404, rid, { entityId: id });
    const normalized = expected.replace(/^W\//, '').replaceAll('"', ''); if (normalized !== String(row.revision) && expected !== '*') return apiError('REVISION_CONFLICT', 409, rid, { entityId: id });
    if (!['failed', 'cancelled'].includes(String(row.state))) return apiError(row.state === 'submission_unknown' ? 'SUBMISSION_UNKNOWN' : 'STATE_CONFLICT', 409, rid, { entityId: id });
    const nextId = randomUUID(); const operationId = randomUUID(); const now = isoNow();
    db.transaction(() => {
      db.prepare("INSERT INTO application_attempts(id,revision,listing_id,state,answers_json,attachments_json,blockers_json,created_at,updated_at,policy_ref,search_id,destination_origin) VALUES (?,1,?,'queued',?,?,?,?,?,?,?,?)")
        .run(nextId, row.listing_id, row.answers_json, row.attachments_json, '[]', now, now, row.policy_ref ?? null, row.search_id ?? null, row.destination_origin ?? null);
      db.prepare("INSERT INTO operations (id,kind,state,progress,error_code,created_at,updated_at,target_id) VALUES (?, 'prepare_application', 'queued', 0, NULL, ?, ?, ?)").run(operationId, now, now, nextId);
      db.prepare('INSERT INTO application_events VALUES (?,?,?,?,?,?)').run(randomUUID(), nextId, null, 'queued', `RETRY_OF:${id}`, now);
      db.prepare('INSERT INTO application_events VALUES (?,?,?,?,?,?)').run(randomUUID(), id, row.state, 'queued', `REPLACED_BY_RETRY:${nextId}`, now);
      saveIdempotency(db, scope, key, hash, 202, { id: nextId, previousId: id, operationId, revision: 1, listingId: row.listing_id, state: 'queued' }, now);
    })();
    return apiOk({ id: nextId, previousId: id, operationId, revision: 1, listingId: row.listing_id, state: 'queued' }, 202, rid);
  } finally { db.close(); }
}
