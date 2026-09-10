import { ArtifactStorageError } from '@aaa/adapters/artifacts';
import { requireSession } from '../../../../lib/auth.ts';
import { apiError, apiOk, requireMutationOrigin, requestId, type RequestId } from '../../../../lib/api.ts';
import { exportStorageRoot, readExportArtifact, validateExportKey } from '../../../../lib/exports.ts';
import { appDb, isoNow } from '../../../../lib/server.ts';
import { randomUUID } from 'node:crypto';

export function exportKey(id: string): string {
  const decoded = decodeURIComponent(id);
  return validateExportKey(decoded);
}

export function exportError(error: unknown, id: RequestId) {
  const code = error instanceof ArtifactStorageError ? error.code : 'EXPORT_UNAVAILABLE';
  const status = code === 'ARTIFACT_MISSING' ? 404 : code === 'ARTIFACT_EXPIRED' ? 410 : 400;
  return apiError(code, status, id, { entityId: id });
}

export function ifMatch(request: Request): number | null {
  const value = request.headers.get('if-match')?.trim().replace(/^W\//u, '').replace(/^"|"$/gu, '');
  return value && /^\d+$/u.test(value) ? Number(value) : null;
}

export async function enqueueExportRetry(request: Request, key: string, expected: number | null) {
  const rid = requestId(request);
  if (!requireMutationOrigin(request)) return apiError('ORIGIN_REQUIRED', 403, rid);
  if (expected === null) return apiError('PRECONDITION_REQUIRED', 428, rid, { entityId: key });
  if (expected !== 1) return apiError('REVISION_CONFLICT', 409, rid, { entityId: key });
  const artifact = readExportArtifact(exportStorageRoot(), key);
  const db = appDb();
  try {
    const operationId = randomUUID();
    const now = isoNow();
    db.prepare("INSERT INTO operations (id,kind,state,progress,error_code,created_at,updated_at,target_id) VALUES (?, 'export', 'queued', 0, NULL, ?, ?, ?)").run(operationId, now, now, key);
    return apiOk({ operationId, exportId: key, payloadSha256: artifact.metadata.sha256, state: 'queued' }, 202, rid);
  } finally { db.close(); }
}

export function downloadResponse(artifact: ReturnType<typeof readExportArtifact>, rid: RequestId) {
  return apiOk({ metadata: artifact.metadata, content: JSON.parse(artifact.bytes.toString('utf8')) }, 200, rid);
}
