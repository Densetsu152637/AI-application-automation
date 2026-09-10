import { randomUUID } from 'node:crypto';
import { profileQuestionSchema } from '@aaa/contracts';
import { requireSession } from '../../../../lib/auth.ts';
import { appDb, isoNow } from '../../../../lib/server.ts';
import { apiError, apiList, apiOk, bodyHash, findIdempotency, idempotencyKey, idempotencyScope, requestId, requireMutationOrigin, saveIdempotency } from '../../../../lib/api.ts';

function shape(row: Record<string, unknown>) {
  return { id: row.id, revision: row.revision, question: row.question, state: row.state, answer: row.answer_text, evidence: JSON.parse(String(row.evidence_json)), errorCode: row.error_code, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function GET(request: Request) {
  const rid = requestId(request); if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, rid);
  const db = appDb(); try { const rows = db.prepare('SELECT * FROM profile_questions ORDER BY created_at DESC LIMIT 50').all() as Array<Record<string, unknown>>; return apiList(rows.map(shape), null, 200, rid); } finally { db.close(); }
}

export async function POST(request: Request) {
  const rid = requestId(request); if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, rid); if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, rid);
  const key = idempotencyKey(request); if (!key) return apiError('IDEMPOTENCY_KEY_REQUIRED', 428, rid);
  const raw = await request.json().catch(() => null); const hash = bodyHash(raw); const parsed = profileQuestionSchema.safeParse(raw); if (!parsed.success) return apiError('INVALID_REQUEST', 400, rid);
  const db = appDb(); try {
    const scope = idempotencyScope(request, '/api/v1/profile/questions', 'administrator'); const prior = findIdempotency(db, scope, key, hash); if (prior === 'CONFLICT') return apiError('IDEMPOTENCY_CONFLICT', 409, rid); if (prior) return apiOk(prior.body, prior.status, rid);
    const id = randomUUID(); const operationId = randomUUID(); const now = isoNow(); const data = { id, operationId, revision: 1, question: parsed.data.question, state: 'queued', answer: null, evidence: [], createdAt: now, updatedAt: now };
    db.transaction(() => { db.prepare("INSERT INTO profile_questions VALUES (?,1,?,'queued',NULL,'[]',NULL,?,?)").run(id, parsed.data.question, now, now); db.prepare("INSERT INTO operations (id,kind,state,progress,error_code,created_at,updated_at,target_id) VALUES (?, 'answer_profile_question', 'queued', 0, NULL, ?, ?, ?)").run(operationId, now, now, id); saveIdempotency(db, scope, key, hash, 202, data, now); })(); return apiOk(data, 202, rid);
  } finally { db.close(); }
}
