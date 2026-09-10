import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../lib/auth.ts';
import { appDb, isoNow } from '../../../../lib/server.ts';
import { apiError, apiOk, findIdempotency, idempotencyKey, idempotencyScope, requestId, requireMutationOrigin, saveIdempotency, bodyHash } from '../../../../lib/api.ts';

export async function POST(request: Request) {
  const id = requestId(request);
  if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, id);
  if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, id);
  const key = idempotencyKey(request); if (!key) return apiError('IDEMPOTENCY_KEY_REQUIRED', 428, id);
  const db = appDb();
  try {
    const scope = idempotencyScope(request, '/api/v1/settings/model-test', 'administrator'); const hash = bodyHash(null); const prior = findIdempotency(db, scope, key, hash); if (prior === 'CONFLICT') return apiError('IDEMPOTENCY_CONFLICT', 409, id); if (prior) return apiOk(prior.body, prior.status, id);
    const now = isoNow();
    const operationId = randomUUID();
    db.prepare("INSERT INTO operations (id,kind,state,progress,error_code,created_at,updated_at) VALUES (?, 'model_diagnostic', 'queued', 0, NULL, ?, ?)").run(operationId, now, now);
    const data = { operationId, target: { kind: 'model_diagnostic', id: operationId } }; saveIdempotency(db, scope, key, hash, 202, data, now); return apiOk(data, 202, id);
  } finally { db.close(); }
}
