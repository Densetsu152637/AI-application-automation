import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { requireSession } from '../../../lib/auth.ts';
import { appDb, runtimeConfig } from '../../../lib/server.ts';
export async function GET() {
  if (!(await requireSession())) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const db = appDb();
  try {
    const cfg = runtimeConfig();
    let inference: 'ready' | 'unavailable' = 'unavailable';
    let worker: 'ready' | 'unavailable' = 'unavailable';
    let browser: 'ready' | 'unavailable' = 'unavailable';
    try {
      const internalKey = readFileSync(cfg.INTERNAL_SECRET_FILE, 'utf8').trim();
      const response = await fetch(process.env.WORKER_INTERNAL_URL ?? 'http://worker:3001/internal/health', {
        signal: AbortSignal.timeout(1500),
        headers: { authorization: `Bearer ${internalKey}` },
      });
      if (response.ok) {
        const status = await response.json() as { worker?: string; browser?: string; model?: string };
        worker = status.worker === 'ready' ? 'ready' : 'unavailable';
        browser = status.browser === 'ready' ? 'ready' : 'unavailable';
        inference = status.model === 'ready' ? 'ready' : 'unavailable';
      }
    } catch { /* report degraded state */ }
    return NextResponse.json({ database: 'ready', worker, output: 'ready', browser, model: inference, modelId: cfg.LLM_MODEL_ID, contextTokens: cfg.LLM_CONTEXT_TOKENS });
  } finally { db.close(); }
}
