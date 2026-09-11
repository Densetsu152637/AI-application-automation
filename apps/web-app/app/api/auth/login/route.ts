import { apiError, apiOk, requestId, requireMutationOrigin } from '../../../../lib/api.ts';
export async function POST(request: Request) {
  const id = requestId(request);
  if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, id);
  return apiOk({ authenticated: true }, 200, id);
}
