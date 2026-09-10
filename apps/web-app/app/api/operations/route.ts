import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../lib/auth.ts';
import { appDb, isoNow } from '../../../lib/server.ts';
import { apiError, apiList, apiOk, bodyHash, findIdempotency, idempotencyKey, idempotencyScope, requestId, requireMutationOrigin, saveIdempotency } from '../../../lib/api.ts';
const kinds = new Set(['scan', 'reindex', 'model_diagnostic', 'export']);
export async function POST(request: Request) {
  const rid = requestId(request);
  if (!(await requireSession())) return apiError('UNAUTHENTICATED', 401, rid);
  if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, rid);
  const body = await request.json().catch(() => null) as { kind?: unknown } | null;
  if (typeof body?.kind !== 'string' || !kinds.has(body.kind)) return apiError('VALIDATION_FAILED', 400, rid);
  const key = idempotencyKey(request); if (!key) return apiError('IDEMPOTENCY_KEY_REQUIRED', 428, rid);
  const scope = idempotencyScope(request, '/api/v1/operations', 'administrator'); const hash = bodyHash(body);
  const id = randomUUID(); const now = isoNow(); const db = appDb();
  try { const prior = findIdempotency(db, scope, key, hash); if (prior === 'CONFLICT') return apiError('IDEMPOTENCY_CONFLICT', 409, rid); if (prior) return apiOk(prior.body, prior.status, rid); const data = { id, kind: body.kind, state: 'queued', progress: 0, createdAt: now }; db.transaction(() => { db.prepare('INSERT INTO operations VALUES (?, ?, \'queued\', 0, NULL, ?, ?, NULL)').run(id, body.kind, now, now); saveIdempotency(db, scope, key, hash, 202, data, now); })(); return apiOk(data, 202, rid); } finally { db.close(); }
}
export async function GET() {
  if (!(await requireSession())) return apiError('UNAUTHENTICATED', 401);
  const db = appDb(); try { const rows = db.prepare('SELECT id,kind,state,progress,error_code,created_at,updated_at,target_id FROM operations ORDER BY created_at DESC LIMIT 50').all() as Array<Record<string, unknown>>; return apiList(rows.map(row => ({ id: row.id, kind: row.kind, state: row.state, progress: row.progress, errorCode: row.error_code, targetId: row.target_id, createdAt: row.created_at, updatedAt: row.updated_at }))); } finally { db.close(); }
}
