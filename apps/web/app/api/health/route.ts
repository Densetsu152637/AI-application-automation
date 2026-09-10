import { NextResponse } from 'next/server';
import { requireSession } from '../../../lib/auth.ts';
import { appDb, runtimeConfig } from '../../../lib/server.ts';
export async function GET() {
  if (!(await requireSession())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const db = appDb();
  try {
    const cfg = runtimeConfig();
    let inference: 'ready' | 'unavailable' = 'unavailable';
    try { const response = await fetch(`${cfg.LLM_BASE_URL}/models`, { signal: AbortSignal.timeout(1500) }); inference = response.ok ? 'ready' : 'unavailable'; } catch { /* report degraded state */ }
    return NextResponse.json({ database: 'ready', worker: 'unknown', output: 'ready', browser: 'unknown', model: inference, modelId: cfg.LLM_MODEL_ID, contextTokens: cfg.LLM_CONTEXT_TOKENS });
  } finally { db.close(); }
}
