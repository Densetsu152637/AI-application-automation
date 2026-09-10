import { createPolicy, listPolicies, policySchema } from '@aaa/adapters/policies';
import { requireSession } from '../../../lib/auth.ts';
import { appDb, isoNow, runtimeConfig } from '../../../lib/server.ts';
import { apiError, apiOk, requestId, requireMutationOrigin } from '../../../lib/api.ts';

function defaultTimezone(db: ReturnType<typeof appDb>): string {
  const row = db.prepare('SELECT timezone FROM application_settings WHERE id=1').get() as { timezone: string } | undefined;
  return row?.timezone ?? runtimeConfig().APP_TIMEZONE;
}

export async function GET(request: Request) {
  const rid = requestId(request); if (!(await requireSession())) return apiError('UNAUTHENTICATED', 401, rid);
  const db = appDb(); try { return apiOk(listPolicies(db), 200, rid); } finally { db.close(); }
}

export async function POST(request: Request) {
  const rid = requestId(request); if (!(await requireSession())) return apiError('UNAUTHENTICATED', 401, rid); if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, rid);
  const raw = await request.json().catch(() => null);
  const db = appDb();
  try {
    const parsed = policySchema.safeParse({ ...(raw && typeof raw === 'object' ? raw : {}), timezone: (raw as Record<string, unknown> | null)?.timezone ?? defaultTimezone(db) });
    if (!parsed.success) return apiError('VALIDATION_FAILED', 422, rid);
    return apiOk(createPolicy(db, parsed.data, isoNow()), 201, rid);
  } finally { db.close(); }
}
