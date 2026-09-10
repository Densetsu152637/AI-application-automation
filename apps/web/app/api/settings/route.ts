import { settingsPatchSchema } from '@aaa/contracts';
import { requireSession } from '../../../lib/auth.ts';
import { appDb, isoNow, runtimeConfig } from '../../../lib/server.ts';
import { apiError, apiOk, requestId, requireMutationOrigin } from '../../../lib/api.ts';

function defaults() { const c = runtimeConfig(); return { llm: { baseUrl: c.LLM_BASE_URL, modelId: c.LLM_MODEL_ID, timeoutSeconds: c.LLM_TIMEOUT_SECONDS, contextTokens: c.LLM_CONTEXT_TOKENS, outputTokens: c.LLM_OUTPUT_TOKENS }, timezone: c.APP_TIMEZONE, timezoneConfirmed: false }; }
function read(db: ReturnType<typeof appDb>) {
  const row = db.prepare('SELECT * FROM application_settings WHERE id = 1').get() as Record<string, unknown> | undefined;
  if (!row) { const d = defaults(); db.prepare('INSERT INTO application_settings VALUES (1, 1, ?, ?, ?, ?, ?, ?, 0, ?)').run(d.llm.baseUrl, d.llm.modelId, d.llm.timeoutSeconds, d.llm.contextTokens, d.llm.outputTokens, d.timezone, isoNow()); return { revision: 1, ...d }; }
  return { revision: row.revision, llm: { baseUrl: row.llm_base_url, modelId: row.llm_model_id, timeoutSeconds: row.llm_timeout_seconds, contextTokens: row.llm_context_tokens, outputTokens: row.llm_output_tokens }, timezone: row.timezone, timezoneConfirmed: Boolean(row.timezone_confirmed) };
}
export async function GET(request: Request) { const rid = requestId(request); if (!(await requireSession())) return apiError('UNAUTHENTICATED', 401, rid); const db = appDb(); try { const v = read(db); return apiOk(v, 200, rid); } finally { db.close(); } }
export async function PATCH(request: Request) {
  const rid = requestId(request); if (!(await requireSession())) return apiError('UNAUTHENTICATED', 401, rid); if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, rid); const expected = request.headers.get('if-match'); if (!expected) return apiError('PRECONDITION_REQUIRED', 428, rid);
  const body = settingsPatchSchema.safeParse(await request.json().catch(() => null)); if (!body.success) return apiError('VALIDATION_FAILED', 400, rid);
  const db = appDb(); try { const current = read(db); const normalized = expected.replace(/^W\//, '').replaceAll('"', ''); if (normalized !== String(current.revision) && expected !== '*') return apiError('REVISION_CONFLICT', 409, rid); const llm = { ...current.llm, ...body.data.llm }; const timezone = body.data.timezone ?? current.timezone; const confirmed = body.data.timezoneConfirmed ?? current.timezoneConfirmed; const revision = Number(current.revision) + 1; db.prepare('UPDATE application_settings SET revision=?, llm_base_url=?, llm_model_id=?, llm_timeout_seconds=?, llm_context_tokens=?, llm_output_tokens=?, timezone=?, timezone_confirmed=?, updated_at=? WHERE id=1').run(revision, llm.baseUrl, llm.modelId, llm.timeoutSeconds, llm.contextTokens, llm.outputTokens, timezone, confirmed ? 1 : 0, isoNow()); return apiOk({ revision, llm, timezone, timezoneConfirmed: confirmed }, 200, rid); } finally { db.close(); }
}
