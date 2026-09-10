import { getPolicy, policyPatchSchema, policySchema, updatePolicy } from '@aaa/adapters/policies';
import { requireSession } from '../../../../lib/auth.ts';
import { appDb, isoNow } from '../../../../lib/server.ts';
import { apiError, apiOk, requestId, requireMutationOrigin } from '../../../../lib/api.ts';

function matchRevision(request: Request, revision: number): boolean {
  return request.headers.get('if-match') === `"${revision}"`;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request); if (!(await requireSession())) return apiError('UNAUTHENTICATED', 401, rid); if (!requireMutationOrigin(request)) return apiError('FORBIDDEN_ORIGIN', 403, rid);
  const { id } = await context.params;
  const db = appDb();
  try {
    const current = getPolicy(db, id);
    if (!current) return apiError('NOT_FOUND', 404, rid, { entityId: id });
    if (!request.headers.has('if-match')) return apiError('PRECONDITION_REQUIRED', 428, rid);
    if (!matchRevision(request, current.revision)) return apiError('REVISION_CONFLICT', 409, rid, { entityId: id });
    const body = policyPatchSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return apiError('VALIDATION_FAILED', 422, rid);
    const next = { ...current, ...body.data };
    const parsed = policySchema.safeParse({
      name: next.name, enabled: next.enabled, mode: next.mode, eligibleSearchIds: next.eligibleSearchIds,
      destinationOrigins: next.destinationOrigins, approvedResumeRefs: next.approvedResumeRefs,
      allowGeneratedCoverLetter: next.allowGeneratedCoverLetter, maxSubmissionsPerDay: next.maxSubmissionsPerDay, timezone: next.timezone,
    });
    if (!parsed.success) return apiError('VALIDATION_FAILED', 422, rid);
    const updated = updatePolicy(db, id, current.revision, parsed.data, isoNow());
    return updated ? apiOk(updated, 200, rid) : apiError('REVISION_CONFLICT', 409, rid, { entityId: id });
  } finally { db.close(); }
}
