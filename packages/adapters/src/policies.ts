import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const origin = z.string().trim().min(1).max(8192).refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      !url.pathname.replace(/\/$/, '') && !url.search && !url.hash;
  } catch { return false; }
}, 'must be an HTTP(S) origin');
const artifactRef = z.strictObject({ artifactId: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
function unique<T>(schema: z.ZodType<T>, key = (value: T) => JSON.stringify(value)) {
  return z.array(schema).superRefine((values, ctx) => {
    const seen = new Set<string>();
    values.forEach((value, index) => { const marker = key(value); if (seen.has(marker)) ctx.addIssue({ code: 'custom', path: [index], message: 'duplicate members are not allowed' }); seen.add(marker); });
  });
}
const policyFields = {
  name: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(false),
  mode: z.enum(['review_required', 'automatic']).default('review_required'),
  eligibleSearchIds: unique(z.uuid()).max(100).default([]),
  destinationOrigins: unique(origin).max(100).default([]),
  approvedResumeRefs: unique(artifactRef).max(20).default([]),
  allowGeneratedCoverLetter: z.boolean().default(true),
  maxSubmissionsPerDay: z.number().int().min(1).max(100).default(5),
  timezone: z.string().trim().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
  }, 'must be a valid IANA timezone'),
};
export const policySchema = z.strictObject(policyFields).superRefine((value, ctx) => {
  if (value.enabled && value.mode === 'automatic') {
    if (!value.eligibleSearchIds.length) ctx.addIssue({ code: 'custom', path: ['eligibleSearchIds'], message: 'automatic policy requires an eligible search' });
    if (!value.destinationOrigins.length) ctx.addIssue({ code: 'custom', path: ['destinationOrigins'], message: 'automatic policy requires a destination allowlist' });
    if (!value.approvedResumeRefs.length) ctx.addIssue({ code: 'custom', path: ['approvedResumeRefs'], message: 'automatic policy requires an approved resume' });
  }
});
export const policyPatchSchema = z.strictObject({
  name: policyFields.name.optional(), enabled: z.boolean().optional(), mode: policyFields.mode.optional(),
  eligibleSearchIds: unique(z.uuid()).max(100).optional(), destinationOrigins: unique(origin).max(100).optional(),
  approvedResumeRefs: unique(artifactRef).max(20).optional(), allowGeneratedCoverLetter: z.boolean().optional(),
  maxSubmissionsPerDay: z.number().int().min(1).max(100).optional(), timezone: policyFields.timezone.optional(),
});
export type PolicyFields = z.infer<typeof policySchema>;
export type PolicyRecord = PolicyFields & { id: string; revision: number; createdAt: string; updatedAt: string };

function read(row: Record<string, unknown>): PolicyRecord {
  return { id: String(row.id), revision: Number(row.revision), name: String(row.name), enabled: Boolean(row.enabled), mode: row.mode as PolicyFields['mode'],
    eligibleSearchIds: JSON.parse(String(row.eligible_search_ids_json)), destinationOrigins: JSON.parse(String(row.destination_origins_json)),
    approvedResumeRefs: JSON.parse(String(row.approved_resume_refs_json)), allowGeneratedCoverLetter: Boolean(row.allow_generated_cover_letter),
    maxSubmissionsPerDay: Number(row.max_submissions_per_day), timezone: String(row.timezone), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
export function listPolicies(db: Database.Database): PolicyRecord[] {
  return (db.prepare('SELECT * FROM application_policies ORDER BY updated_at DESC, id DESC').all() as Array<Record<string, unknown>>).map(read);
}
export function getPolicy(db: Database.Database, id: string): PolicyRecord | null {
  const row = db.prepare('SELECT * FROM application_policies WHERE id=?').get(id) as Record<string, unknown> | undefined;
  return row ? read(row) : null;
}
export function createPolicy(db: Database.Database, fields: PolicyFields, now: string): PolicyRecord {
  const id = randomUUID();
  db.prepare('INSERT INTO application_policies VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, 1, fields.name, fields.enabled ? 1 : 0, fields.mode, JSON.stringify(fields.eligibleSearchIds), JSON.stringify(fields.destinationOrigins), JSON.stringify(fields.approvedResumeRefs), fields.allowGeneratedCoverLetter ? 1 : 0, fields.maxSubmissionsPerDay, fields.timezone, now, now);
  return getPolicy(db, id)!;
}
export function updatePolicy(db: Database.Database, id: string, revision: number, fields: PolicyFields, now: string): PolicyRecord | null {
  const changed = db.prepare('UPDATE application_policies SET revision=?,name=?,enabled=?,mode=?,eligible_search_ids_json=?,destination_origins_json=?,approved_resume_refs_json=?,allow_generated_cover_letter=?,max_submissions_per_day=?,timezone=?,updated_at=? WHERE id=? AND revision=?').run(revision + 1, fields.name, fields.enabled ? 1 : 0, fields.mode, JSON.stringify(fields.eligibleSearchIds), JSON.stringify(fields.destinationOrigins), JSON.stringify(fields.approvedResumeRefs), fields.allowGeneratedCoverLetter ? 1 : 0, fields.maxSubmissionsPerDay, fields.timezone, now, id, revision);
  return changed.changes ? getPolicy(db, id) : null;
}
