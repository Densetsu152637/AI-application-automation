import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { cookieName } from '../../../../lib/auth.ts';
import { appDb } from '../../../../lib/server.ts';
import { revokeSession } from '@aaa/adapters/repositories';
import { apiError, apiOk, requestId, requireMutationOrigin } from '../../../../lib/api.ts';
export async function POST(request: Request) {
  const id = requestId(request);
  if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, id);
  const jar = await cookies(); const raw = jar.get(cookieName)?.value;
  if (raw) { const db = appDb(); try { revokeSession(db, raw); } finally { db.close(); } }
  const response = apiOk({ authenticated: false }, 200, id); response.cookies.delete(cookieName); return response;
}
