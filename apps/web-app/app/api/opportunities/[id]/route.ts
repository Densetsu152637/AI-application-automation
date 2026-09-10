import { requireSession } from '../../../../lib/auth.ts';
import { apiError, apiOk, requestId } from '../../../../lib/api.ts';
import { appDb } from '../../../../lib/server.ts';

function shape(row: Record<string, unknown>) {
  return {
    id: row.id,
    revision: row.revision,
    sourceId: row.source_id,
    listingUrl: row.canonical_url,
    originalUrl: row.original_url,
    title: row.title,
    employer: row.employer,
    location: row.location,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    decision: 'needs_review',
    noveltyState: 'pending',
    applicationState: row.application_state ?? 'not_started',
    dismissed: Boolean(row.dismissed),
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, rid);
  const { id } = await context.params;
  const db = appDb();
  try {
    const row = db.prepare(`SELECT l.*, COALESCE(a.state, 'not_started') AS application_state
      FROM discovered_listings l LEFT JOIN application_attempts a ON a.listing_id = l.id
      WHERE l.id=? ORDER BY a.updated_at DESC LIMIT 1`).get(id) as Record<string, unknown> | undefined;
    if (!row) return apiError('NOT_FOUND', 404, rid, { entityId: id });
    return apiOk(shape(row), 200, rid);
  } finally { db.close(); }
}
