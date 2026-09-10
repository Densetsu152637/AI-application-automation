import { requireSession } from '../../../lib/auth.ts';
import { appDb } from '../../../lib/server.ts';
import { isoNow } from '../../../lib/server.ts';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { apiError, apiList, apiOk, bodyHash, findIdempotency, idempotencyKey, idempotencyScope, requestId, requireMutationOrigin, saveIdempotency } from '../../../lib/api.ts';

export async function POST(request: Request) {
  const rid = requestId(request); if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, rid); if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, rid);
  const key = idempotencyKey(request); if (!key) return apiError('IDEMPOTENCY_KEY_REQUIRED', 428, rid);
  const form = await request.formData().catch(() => null); const file = form?.get('file');
  if (!(file instanceof File) || file.type !== 'application/pdf') return apiError('INVALID_REQUEST', 400, rid);
  const name = basename(file.name); if (!name || name !== file.name || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.pdf$/i.test(name)) return apiError('INVALID_REQUEST', 400, rid);
  const bytes = Buffer.from(await file.arrayBuffer()); if (bytes.length > 20 * 1024 * 1024 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return apiError('INVALID_REQUEST', 400, rid);
  const sha256 = createHash('sha256').update(bytes).digest('hex'); const hash = bodyHash({ name, sha256, size: bytes.length }); const db = appDb();
  try { const scope = idempotencyScope(request, '/api/v1/resources', 'administrator'); const prior = findIdempotency(db, scope, key, hash); if (prior === 'CONFLICT') return apiError('IDEMPOTENCY_CONFLICT', 409, rid); if (prior) return apiOk(prior.body, prior.status, rid);
    const root = process.env.RESOURCES_ROOT ?? '/resources'; const tmp = join(root, `.${randomUUID()}.tmp`); await mkdir(root, { recursive: true }); await writeFile(tmp, bytes, { flag: 'wx' }); await rename(tmp, join(root, name));
    const operationId = randomUUID(); const now = isoNow(); const data = { operationId, state: 'queued', relativePath: name, mediaType: 'application/pdf', sizeBytes: bytes.length, sha256 };
    db.transaction(() => { db.prepare("INSERT INTO operations (id,kind,state,progress,error_code,created_at,updated_at,target_id) VALUES (?, 'reindex', 'queued', 0, NULL, ?, ?, NULL)").run(operationId, now, now); saveIdempotency(db, scope, key, hash, 202, data, now); })(); return apiOk(data, 202, rid);
  } catch { return apiError('RESOURCE_UPLOAD_FAILED', 500, rid); } finally { db.close(); }
}
export async function GET(request: Request) { const rid = requestId(request); if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, rid); const state = new URL(request.url).searchParams.get('extractionState'); if (state !== null && !['extracted', 'unsupported', 'failed', 'missing'].includes(state)) return apiError('INVALID_REQUEST', 400, rid); const db = appDb(); try { const rows = (state ? db.prepare('SELECT id,revision,relative_path,media_type,size_bytes,sha256,extraction_state,segments_json,error_code,updated_at FROM resource_documents WHERE extraction_state=? ORDER BY relative_path').all(state) : db.prepare('SELECT id,revision,relative_path,media_type,size_bytes,sha256,extraction_state,segments_json,error_code,updated_at FROM resource_documents ORDER BY relative_path').all()) as Array<Record<string, unknown>>; return apiList(rows.map(row => ({ id: row.id, revision: row.revision, relativePath: row.relative_path, mediaType: row.media_type, sizeBytes: row.size_bytes, sha256: row.sha256, extractionState: row.extraction_state, segmentCount: (JSON.parse(String(row.segments_json)) as unknown[]).length, errorCode: row.error_code, updatedAt: row.updated_at })), null, 200, rid); } finally { db.close(); } }
