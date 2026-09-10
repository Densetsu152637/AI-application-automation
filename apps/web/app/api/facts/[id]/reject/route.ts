import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../lib/auth.ts';
import { apiError, apiOk, bodyHash, findIdempotency, idempotencyKey, idempotencyScope, requireMutationOrigin, saveIdempotency } from '../../../../../lib/api.ts';
import { appDb, isoNow } from '../../../../../lib/server.ts';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return apiError('UNAUTHENTICATED', 401);
  if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403);
  const expected = request.headers.get('if-match'); if (!expected) return apiError('REVISION_REQUIRED', 428); const key = idempotencyKey(request); if (!key) return apiError('IDEMPOTENCY_KEY_REQUIRED', 428);
  const body = await request.json().catch(() => null) as { reason?: unknown } | null;
  if (!body || typeof body.reason !== 'string' || body.reason.length > 2000) return apiError('VALIDATION_FAILED', 400);
  const { id } = await context.params; const db = appDb(); const hash = bodyHash(body);
  try {
    const scope = idempotencyScope(request, `/api/v1/facts/${id}/reject`, 'administrator'); const prior = findIdempotency(db, scope, key, hash); if (prior === 'CONFLICT') return apiError('IDEMPOTENCY_CONFLICT', 409, undefined, { entityId: id }); if (prior) return apiOk(prior.body, prior.status);
    const row = db.prepare('SELECT revision FROM applicant_facts WHERE id=?').get(id) as { revision: number } | undefined;
    if (!row) return apiError('NOT_FOUND', 404);
    if (String(row.revision) !== expected.replace(/^W\//, '').replaceAll('"', '')) return apiError('REVISION_CONFLICT', 409, undefined, { entityId: id });
    const now = isoNow(); const revision = row.revision + 1;
    const data = { id, revision, status: 'rejected' }; db.transaction(() => { db.prepare("UPDATE applicant_facts SET revision=?,status='rejected',confirmed_at=NULL,confirmed_by=NULL,updated_at=? WHERE id=?").run(revision, now, id); saveIdempotency(db, scope, key, hash, 200, data, now); })();
    return apiOk(data);
  } finally { db.close(); }
}
