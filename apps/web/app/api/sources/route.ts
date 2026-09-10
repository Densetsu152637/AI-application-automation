import { randomUUID } from 'node:crypto';
import { sourceSchema } from '@aaa/contracts';
import { requireSession, sessionToken } from '../../../lib/auth.ts';
import { appDb, isoNow } from '../../../lib/server.ts';
import { apiError, apiOk, bodyHash, findIdempotency, idempotencyKey, idempotencyScope, requestId, requireMutationOrigin, saveIdempotency, type RequestId } from '../../../lib/api.ts';
function shape(row: Record<string, unknown>) { return { id: row.id, revision: row.revision, name: row.name, startUrl: row.start_url, allowedOrigins: JSON.parse(String(row.allowed_origins_json)), enabled: Boolean(row.enabled), supportStatus: row.support_status, supportNote: row.support_note, createdAt: row.created_at, updatedAt: row.updated_at }; }
export async function GET(request: Request) { const rid = requestId(request); if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, rid); const db = appDb(); try { return apiOk((db.prepare('SELECT * FROM source_configurations ORDER BY updated_at DESC').all() as Array<Record<string, unknown>>).map(shape), 200, rid); } finally { db.close(); } }
export async function POST(request: Request) {
  const rid = requestId(request); if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, rid); if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, rid);
  const key = idempotencyKey(request); if (!key) return apiError('IDEMPOTENCY_KEY_REQUIRED', 400, rid);
  const input = await request.json().catch(() => null); const parsed = sourceSchema.safeParse(input); if (!parsed.success) return apiError('INVALID_REQUEST', 422, rid, { details: parsed.error.issues.map(issue => ({ field: issue.path.join('.') || null, reason: issue.message })) });
  const hash = bodyHash(parsed.data); const token = await sessionToken(); const scope = idempotencyScope(request, '/api/sources', token ?? 'anonymous'); const db = appDb();
  try {
    const previous = findIdempotency(db, scope, key, hash); if (previous === 'CONFLICT') return apiError('IDEMPOTENCY_CONFLICT', 409, rid); if (previous) return apiOk((previous.body as { data: unknown }).data, previous.status, (previous.body as { requestId: string }).requestId as RequestId);
    const id = randomUUID(); const now = isoNow(); const data = { id, revision: 1, ...parsed.data, createdAt: now, updatedAt: now }; const envelope = { schemaVersion: 1, data, requestId: rid };
    db.transaction(() => { db.prepare('INSERT INTO source_configurations VALUES (?,1,?,?,?,?,?,?,?,?)').run(id, parsed.data.name, parsed.data.startUrl, JSON.stringify(parsed.data.allowedOrigins), parsed.data.enabled ? 1 : 0, parsed.data.supportStatus, parsed.data.supportNote, now, now); saveIdempotency(db, scope, key, hash, 201, envelope, now); })();
    return apiOk(data, 201, rid);
  } finally { db.close(); }
}
