import { NextResponse } from 'next/server';
import { readFileSync, accessSync, constants } from 'node:fs';
import { appDb, runtimeConfig } from '../../../lib/server.ts';
import { runtimeStatus } from '../../../lib/runtime.ts';
export const dynamic = 'force-dynamic';
export async function GET() {
  const db = appDb();
  try {
    const cfg = runtimeConfig();
    let inference: 'ready' | 'unavailable' = 'unavailable';
    let output: 'ready' | 'unavailable' = 'unavailable';
    try { accessSync(process.env.OUTPUT_ROOT ?? '/output', constants.R_OK | constants.W_OK); output = 'ready'; } catch {}
    try {
      const apiKey = cfg.LLM_API_KEY_FILE ? readFileSync(cfg.LLM_API_KEY_FILE, 'utf8').trim() : undefined;
      const response = await fetch(`${cfg.LLM_BASE_URL}/models`, { signal: AbortSignal.timeout(1500), headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined });
      inference = response.ok ? 'ready' : 'unavailable';
    } catch { /* Inference can be offline while the local app and browser remain available. */ }
    return NextResponse.json({ database: 'ready', ...runtimeStatus(), output, model: inference, modelId: cfg.LLM_MODEL_ID, contextTokens: cfg.LLM_CONTEXT_TOKENS }, { headers: { 'Cache-Control': 'private, no-store' } });
  } finally { db.close(); }
}
