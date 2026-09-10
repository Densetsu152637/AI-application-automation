import { requireSession } from '../../../../../lib/auth.ts';
import { apiError, apiOk, requestId } from '../../../../../lib/api.ts';
import { appDb } from '../../../../../lib/server.ts';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  if (!(await requireSession())) return apiError('AUTH_REQUIRED', 401, rid);
  const { id } = await context.params;
  const db = appDb();
  try {
    const listing = db.prepare('SELECT id FROM discovered_listings WHERE id=?').get(id);
    if (!listing) return apiError('NOT_FOUND', 404, rid, { entityId: id });
    const rows = db.prepare('SELECT * FROM application_attempts WHERE listing_id=? ORDER BY updated_at DESC').all(id) as Array<Record<string, unknown>>;
    return apiOk(rows.map(row => ({ id: row.id, revision: row.revision, listingId: row.listing_id, state: row.state, answers: JSON.parse(String(row.answers_json)), attachments: JSON.parse(String(row.attachments_json)), blockers: JSON.parse(String(row.blockers_json)), createdAt: row.created_at, updatedAt: row.updated_at })), 200, rid);
  } finally { db.close(); }
}
