import { requireSession } from '../../../../../lib/auth.ts';
import { apiError, apiOk, bodyHash, findIdempotency, idempotencyKey, idempotencyScope, requestId, requireMutationOrigin, saveIdempotency } from '../../../../../lib/api.ts';
import { appDb, isoNow } from '../../../../../lib/server.ts';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, rid);
  if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, rid);
  const match = request.headers.get('if-match');
  if (!match) return apiError('PRECONDITION_REQUIRED', 428, rid);
  const key = idempotencyKey(request); if (!key) return apiError('IDEMPOTENCY_KEY_REQUIRED', 428, rid);
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { dismissed?: unknown } | null;
  const hash = bodyHash(body);
  const db = appDb();
  try {
    const scope = idempotencyScope(request, `/api/v1/opportunities/${id}/dismiss`, 'administrator'); const prior = findIdempotency(db, scope, key, hash); if (prior === 'CONFLICT') return apiError('IDEMPOTENCY_CONFLICT', 409, rid, { entityId: id }); if (prior) return apiOk(prior.body, prior.status, rid);
    const row = db.prepare('SELECT id,revision FROM discovered_listings WHERE id=?').get(id) as { id: string; revision: number } | undefined;
    if (!row) return apiError('NOT_FOUND', 404, rid, { entityId: id });
    const expected = match.replace(/^W\//, '').replaceAll('"', '');
    if (expected !== String(row.revision) && match !== '*') return apiError('REVISION_CONFLICT', 409, rid, { entityId: id });
    if (typeof body?.dismissed !== 'boolean') return apiError('VALIDATION_FAILED', 400, rid);
    const revision = row.revision + 1;
    const data = { id, revision, dismissed: body.dismissed }; db.transaction(() => { db.prepare('UPDATE discovered_listings SET dismissed=?,revision=? WHERE id=?').run(body.dismissed ? 1 : 0, revision, id); saveIdempotency(db, scope, key, hash, 200, data, isoNow()); })();
    return apiOk(data, 200, rid);
  } finally { db.close(); }
}
