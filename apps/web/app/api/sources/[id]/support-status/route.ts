import { requireSession } from '../../../../../lib/auth.ts';
import { appDb, isoNow } from '../../../../../lib/server.ts';
import { apiError, apiOk, bodyHash, findIdempotency, idempotencyKey, idempotencyScope, requestId, requireMutationOrigin, saveIdempotency } from '../../../../../lib/api.ts';

const allowed = new Set(['user_verified', 'unverified']);
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request); if (!(await requireSession())) return apiError('UNAUTHENTICATED', 401, rid); if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, rid);
  const { id } = await context.params; const match = request.headers.get('if-match');
  if (!match) return apiError('PRECONDITION_REQUIRED', 428, rid);
  const key = idempotencyKey(request); if (!key) return apiError('IDEMPOTENCY_KEY_REQUIRED', 428, rid);
  const body = await request.json().catch(() => null) as { status?: unknown; note?: unknown } | null;
  if (typeof body?.status !== 'string' || !allowed.has(body.status) || (body.note !== undefined && typeof body.note !== 'string')) return apiError('VALIDATION_FAILED', 400, rid);
  const db = appDb(); const hash = bodyHash(body);
  try {
    const scope = idempotencyScope(request, `/api/v1/sources/${id}/support-status`, 'administrator'); const prior = findIdempotency(db, scope, key, hash); if (prior === 'CONFLICT') return apiError('IDEMPOTENCY_CONFLICT', 409, rid, { entityId: id }); if (prior) return apiOk(prior.body, prior.status, rid);
    const row = db.prepare('SELECT revision,support_status,support_note FROM source_configurations WHERE id=?').get(id) as { revision: number; support_status: string; support_note: string | null } | undefined;
    if (!row) return apiError('NOT_FOUND', 404, rid, { entityId: id });
    if (match !== `"${row.revision}"`) return apiError('REVISION_CONFLICT', 409, rid, { entityId: id });
    if (row.support_status === 'known_restriction') return apiError('SOURCE_RESTRICTED', 409, rid, { entityId: id });
    const revision = row.revision + 1; const now = isoNow(); const note = body.note === undefined ? row.support_note : body.note;
    const data = { id, revision, status: body.status, note, updatedAt: now }; db.transaction(() => { db.prepare('UPDATE source_configurations SET revision=?,support_status=?,support_note=?,updated_at=? WHERE id=? AND revision=?').run(revision, body.status, note, now, id, row.revision); saveIdempotency(db, scope, key, hash, 200, data, now); })();
    return apiOk(data, 200, rid);
  } finally { db.close(); }
}
