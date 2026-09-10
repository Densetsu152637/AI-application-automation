import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { completeStructured, LlmError } from '../packages/adapters/src/llm.ts';

const config = { baseUrl: 'http://inference:8000/v1', modelId: 'Qwen3.5-9B', timeoutSeconds: 1, contextTokens: 4096, outputTokens: 128 };
const schema = z.strictObject({ decision: z.enum(['match', 'reject', 'needs_review']) });
function response(status: number, body: unknown): Response { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
test('LLM gateway validates structured output and sends safe defaults', async () => {
  let request: RequestInit | undefined;
  const value = await completeStructured(config, [{ role: 'user', content: 'untrusted listing' }], schema, async (_url, init) => { request = init; return response(200, { choices: [{ message: { content: '{"decision":"match"}' } }] }); });
  assert.deepEqual(value, { decision: 'match' }); assert.equal(JSON.parse(String(request?.body)).temperature, 0); assert.equal(JSON.parse(String(request?.body)).stream, false);
});
test('LLM gateway classifies auth, invalid output, and timeout errors', async () => {
  await assert.rejects(() => completeStructured(config, [], schema, async () => response(401, {})), (error: unknown) => error instanceof LlmError && error.code === 'MODEL_AUTH_FAILED');
  await assert.rejects(() => completeStructured(config, [], schema, async () => response(200, { choices: [{ message: { content: '{"unexpected":true}' } }] })), (error: unknown) => error instanceof LlmError && error.code === 'MODEL_INVALID_OUTPUT');
  await assert.rejects(() => completeStructured({ ...config, timeoutSeconds: 0.001 }, [], schema, async (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }); })), (error: unknown) => error instanceof LlmError && error.code === 'MODEL_TIMEOUT');
});
test('model diagnostic checks target capacity and runs only structured non-submission probes', async () => {
  const requests: Array<{ url: string; body?: string }> = [];
  const diagnostic = await (await import('../packages/adapters/src/llm.ts')).runModelDiagnostic(config, async (input, init) => {
    requests.push({ url: String(input), body: String(init?.body ?? '') });
    if (String(input).endsWith('/models')) return response(200, { data: [{ id: 'Qwen3.5-9B', max_context_tokens: 32768, active_attention_tokens: 32768 }] });
    const schema = JSON.parse(String(init?.body)).response_format.json_schema.schema;
    const output = schema.properties.action ? { action: 'stop', elementRef: null, value: null, effect: 'non_submission' } : schema.properties.result ? { result: { label: 'ok', enabled: true } } : schema.properties.value.type === 'array' ? { value: [] } : { value: schema.properties.value.nullable ? null : 'ready' };
    return response(200, { choices: [{ message: { content: JSON.stringify(output) } }] });
  });
  assert.equal(diagnostic.checks.every(check => check.state === 'passed'), true);
  assert.equal(requests.length, 5);
  assert.equal(requests.slice(1).every(request => !JSON.parse(request.body ?? '{}').stream), true);
});
