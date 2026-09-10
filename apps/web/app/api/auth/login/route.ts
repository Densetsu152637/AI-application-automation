import { login, cookieName } from '../../../../lib/auth.ts';
import { apiError, apiOk, requestId, requireMutationOrigin } from '../../../../lib/api.ts';
export async function POST(request: Request) {
  const id = requestId(request);
  if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, id);
  const body = await request.json().catch(() => null) as { secret?: unknown } | null;
  if (typeof body?.secret !== 'string' || body.secret.length < 1) return apiError('INVALID_REQUEST', 400, id);
  const value = login(body.secret);
  if (!value) return apiError('AUTH_FAILED', 401, id);
  const response = apiOk({ authenticated: true }, 200, id);
  response.cookies.set(cookieName, value, { httpOnly: true, sameSite: 'strict', secure: process.env.APP_ORIGIN?.startsWith('https://') ?? false, path: '/', maxAge: 43200 });
  return response;
}
