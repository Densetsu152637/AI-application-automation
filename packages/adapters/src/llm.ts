import { z, type ZodType } from 'zod';

export type LlmConfig = { baseUrl: string; modelId: string; timeoutSeconds: number; contextTokens: number; outputTokens: number; apiKey?: string };
export class LlmError extends Error { constructor(public readonly code: 'MODEL_UNAVAILABLE' | 'MODEL_AUTH_FAILED' | 'MODEL_NOT_FOUND' | 'MODEL_TIMEOUT' | 'MODEL_INVALID_OUTPUT' | 'MODEL_CONTEXT_LIMIT', message: string = code) { super(message); } }
type ChatResponse = { choices?: Array<{ message?: { content?: unknown } }> };
export async function completeStructured<T>(config: LlmConfig, messages: Array<{ role: 'system' | 'user'; content: string }>, schema: ZodType<T>, fetcher: typeof fetch = fetch): Promise<T> {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);
  try {
    let response: Response;
    try { response = await fetcher(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) }, body: JSON.stringify({ model: config.modelId, messages, temperature: 0, stream: false, max_tokens: config.outputTokens, response_format: { type: 'json_schema', json_schema: { name: 'contract', strict: true, schema: z.toJSONSchema(schema) } } }), signal: controller.signal }); } catch (error) { if (error instanceof Error && error.name === 'AbortError') throw new LlmError('MODEL_TIMEOUT'); throw new LlmError('MODEL_UNAVAILABLE', error instanceof Error ? error.message : 'request failed'); }
    if (response.status === 401 || response.status === 403) throw new LlmError('MODEL_AUTH_FAILED'); if (response.status === 404) throw new LlmError('MODEL_NOT_FOUND'); if (response.status === 400) throw new LlmError('MODEL_CONTEXT_LIMIT'); if (!response.ok) throw new LlmError('MODEL_UNAVAILABLE', `HTTP_${response.status}`);
    let payload: ChatResponse; try { payload = await response.json() as ChatResponse; } catch { throw new LlmError('MODEL_INVALID_OUTPUT', 'invalid response envelope'); }
    const content = payload.choices?.[0]?.message?.content; if (typeof content !== 'string') throw new LlmError('MODEL_INVALID_OUTPUT', 'missing content');
    let value: unknown; try { value = JSON.parse(content); } catch { throw new LlmError('MODEL_INVALID_OUTPUT', 'content is not JSON'); }
    const parsed = schema.safeParse(value); if (!parsed.success) throw new LlmError('MODEL_INVALID_OUTPUT', parsed.error.message); return parsed.data;
  } finally { clearTimeout(timeout); }
}

export type DiagnosticCheck = { kind: 'connection' | 'model' | 'capacity' | 'schema_enum' | 'schema_nested' | 'schema_nullable' | 'schema_action'; state: 'passed' | 'failed'; error: string | null };
export type ModelDiagnostic = { modelId: string; checks: DiagnosticCheck[]; tokenizerMethod: 'utf8_bytes'; checkedAt: string };
const probeSchemas = [
  ['schema_enum', z.strictObject({ value: z.enum(['ready', 'not_ready']) })],
  ['schema_nested', z.strictObject({ result: z.strictObject({ label: z.string(), enabled: z.boolean() }) })],
  ['schema_nullable', z.strictObject({ value: z.string().nullable() })],
  ['schema_action', z.strictObject({ action: z.enum(['stop', 'navigate', 'click', 'fill']), elementRef: z.string().nullable(), value: z.string().nullable(), effect: z.literal('non_submission') })],
] as const;

/** Fixed, bounded capability check. The action probe explicitly has no submission shape. */
export async function runModelDiagnostic(config: LlmConfig, fetcher: typeof fetch = fetch): Promise<ModelDiagnostic> {
  const checks: DiagnosticCheck[] = [];
  const base = config.baseUrl.replace(/\/$/, '');
  let models: unknown;
  try {
    const response = await fetcher(`${base}/models`, { signal: AbortSignal.timeout(config.timeoutSeconds * 1000), headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined });
    if (response.status === 401 || response.status === 403) throw new LlmError('MODEL_AUTH_FAILED');
    if (!response.ok) throw new LlmError('MODEL_UNAVAILABLE', `HTTP_${response.status}`);
    models = await response.json();
    checks.push({ kind: 'connection', state: 'passed', error: null });
  } catch (error) {
    const e = error instanceof LlmError ? error : new LlmError('MODEL_UNAVAILABLE');
    checks.push({ kind: 'connection', state: 'failed', error: e.code });
    return { modelId: config.modelId, checks, tokenizerMethod: 'utf8_bytes', checkedAt: new Date().toISOString() };
  }
  const data = (models as { data?: Array<{ id?: unknown; max_context_tokens?: unknown; max_model_len?: unknown; active_attention_tokens?: unknown }> }).data;
  const target = data?.find(item => item.id === config.modelId);
  checks.push({ kind: 'model', state: target ? 'passed' : 'failed', error: target ? null : 'MODEL_NOT_FOUND' });
  const capacity = Number(target?.max_context_tokens ?? target?.max_model_len ?? 0);
  const active = Number(target?.active_attention_tokens ?? capacity);
  const capacityOk = !!target && Number.isFinite(capacity) && capacity >= config.contextTokens && Number.isFinite(active) && active >= config.contextTokens;
  checks.push({ kind: 'capacity', state: capacityOk ? 'passed' : 'failed', error: capacityOk ? null : 'MODEL_CONTEXT_LIMIT' });
  if (!target || !capacityOk) return { modelId: config.modelId, checks, tokenizerMethod: 'utf8_bytes', checkedAt: new Date().toISOString() };
  for (const [kind, schema] of probeSchemas) {
    try {
      const probeSchema = schema as unknown as ZodType<unknown>;
      await completeStructured(config, [{ role: 'system', content: 'Return only the requested JSON. This is a diagnostic; do not navigate, submit, or perform any external action.' }, { role: 'user', content: `Diagnostic probe ${kind}. Use only the fixed schema and choose a non-submitting result.` }], probeSchema, fetcher);
      checks.push({ kind, state: 'passed', error: null });
    } catch (error) { checks.push({ kind, state: 'failed', error: error instanceof LlmError ? error.code : 'MODEL_UNAVAILABLE' }); }
  }
  return { modelId: config.modelId, checks, tokenizerMethod: 'utf8_bytes', checkedAt: new Date().toISOString() };
}
