import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../../lib/auth.ts';
import { appDb, isoNow } from '../../../../../lib/server.ts';
import { apiError, apiOk, bodyHash, findIdempotency, idempotencyKey, idempotencyScope, requestId, requireMutationOrigin, saveIdempotency } from '../../../../../lib/api.ts';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request); if (!(await requireSession())) return apiError('UNAUTHENTICATED', 401, rid); if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, rid);
  const key = idempotencyKey(request); if (!key) return apiError('IDEMPOTENCY_KEY_REQUIRED', 428, rid);
  const { id } = await context.params;
  const db = appDb();
  try {
    if (!db.prepare('SELECT id FROM searches WHERE id=?').get(id)) return apiError('NOT_FOUND', 404, rid, { entityId: id });
    const active = db.prepare("SELECT 1 FROM operations WHERE kind='scan' AND target_id=? AND state IN ('queued','running') LIMIT 1").get(id);
    const scope = idempotencyScope(request, `/api/v1/searches/${id}/runs`, 'administrator'); const hash = bodyHash({ searchId: id }); const prior = findIdempotency(db, scope, key, hash);
    if (prior === 'CONFLICT') return apiError('IDEMPOTENCY_CONFLICT', 409, rid, { entityId: id });
    if (prior) return apiOk(prior.body, prior.status, rid);
    if (active) return apiError('ACTIVE_RUN_EXISTS', 409, rid, { entityId: id });
    const operationId = randomUUID(); const now = isoNow();
    db.prepare("INSERT INTO operations (id,kind,state,progress,error_code,created_at,updated_at,target_id) VALUES (?, 'scan', 'queued', 0, NULL, ?, ?, ?)").run(operationId, now, now, id);
    const data = { operationId, target: { kind: 'search', id } }; saveIdempotency(db, scope, key, hash, 202, data, now); return apiOk(data, 202, rid);
  } finally { db.close(); }
}
