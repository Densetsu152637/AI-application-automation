import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { cookieName } from '../../../../lib/auth.ts';
import { appDb } from '../../../../lib/server.ts';
import { sessionIsValid } from '@aaa/adapters/repositories';
import { digest } from '@aaa/adapters/security';
import { apiError, apiOk, requestId } from '../../../../lib/api.ts';

export async function GET(request: Request) {
  const id = requestId(request);
  const raw = (await cookies()).get(cookieName)?.value;
  if (!raw) return apiError('AUTH_REQUIRED', 401, id);
  const db = appDb();
  try {
    if (!sessionIsValid(db, raw)) return apiError('AUTH_REQUIRED', 401, id);
    const row = db.prepare('SELECT expires_at FROM dashboard_sessions WHERE token_hash = ?').get(digest(raw)) as { expires_at: string } | undefined;
    return apiOk({ authenticated: true, expiresAt: row?.expires_at ?? null }, 200, id);
  } finally { db.close(); }
}
