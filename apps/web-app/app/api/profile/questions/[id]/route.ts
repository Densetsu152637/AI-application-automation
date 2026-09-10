import { requireSession } from '../../../../../lib/auth.ts';
import { appDb } from '../../../../../lib/server.ts';
import { apiError, apiOk, requestId } from '../../../../../lib/api.ts';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request); if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, rid); const { id } = await context.params; const db = appDb();
  try { const row = db.prepare('SELECT * FROM profile_questions WHERE id=?').get(id) as Record<string, unknown> | undefined; if (!row) return apiError('NOT_FOUND', 404, rid, { entityId: id }); return apiOk({ id: row.id, revision: row.revision, question: row.question, state: row.state, answer: row.answer_text, evidence: JSON.parse(String(row.evidence_json)), errorCode: row.error_code, createdAt: row.created_at, updatedAt: row.updated_at }, 200, rid); } finally { db.close(); }
}
