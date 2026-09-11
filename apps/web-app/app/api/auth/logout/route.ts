import { cookieName } from '../../../../lib/auth.ts';
import { apiError, apiOk, requestId, requireMutationOrigin } from '../../../../lib/api.ts';
export async function POST(request: Request) {
  const id = requestId(request);
  if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, id);
  const response = apiOk({ authenticated: true, mode: 'local' }, 200, id);
  response.cookies.delete(cookieName);
  return response;
}
