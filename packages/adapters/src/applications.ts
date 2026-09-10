import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { policyDayKey } from '../../domain/src/scheduling.ts';
import { reserveQuota } from './scheduler.ts';

export type ApplicationGuard =
  | { ok: true; authority: 'manual' | 'automatic'; policyId: string | null }
  | { ok: false; reason: 'POLICY_DISABLED' | 'POLICY_INELIGIBLE' | 'QUOTA_EXHAUSTED' };

function json(value: unknown): unknown[] {
  try { const parsed = JSON.parse(String(value)); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

/** Checks the policy at the intent linearization point, never from a stale preparation snapshot. */
export function applicationGuard(db: Database.Database, row: Record<string, unknown>, policyRef: string | null): ApplicationGuard {
  if (!policyRef) return { ok: true, authority: 'manual', policyId: null };
  const policy = db.prepare('SELECT * FROM application_policies WHERE id=?').get(policyRef) as Record<string, unknown> | undefined;
  if (!policy || !policy.enabled || policy.mode !== 'automatic') return { ok: false, reason: 'POLICY_DISABLED' };
  const searches = json(policy.eligible_search_ids_json) as string[];
  const origins = json(policy.destination_origins_json) as string[];
  const resumes = json(policy.approved_resume_refs_json) as Array<{ artifactId?: string; sha256?: string }>;
  if (!row.search_id || !searches.includes(String(row.search_id))) return { ok: false, reason: 'POLICY_INELIGIBLE' };
  let origin: string;
  try { origin = new URL(String(row.destination_origin || '')).origin; } catch { return { ok: false, reason: 'POLICY_INELIGIBLE' }; }
  if (!origins.some(value => { try { return new URL(value).origin === origin; } catch { return false; } })) return { ok: false, reason: 'POLICY_INELIGIBLE' };
  const attachments = json(row.attachments_json) as Array<{ artifactId?: string; sha256?: string }>;
  if (!attachments.some(file => resumes.some(ref => ref.artifactId === file.artifactId && ref.sha256 === file.sha256))) return { ok: false, reason: 'POLICY_INELIGIBLE' };
  return { ok: true, authority: 'automatic', policyId: String(policy.id) };
}

export interface CommitSubmissionResult { intentId: string; operationId: string; authority: 'manual' | 'automatic'; policyId: string | null; }

/** Commits intent, policy authority, and automatic quota reservation before dispatch can be queued. */
export function commitSubmission(db: Database.Database, row: Record<string, unknown>, snapshotHash: string, now: Date, policyRef: string | null): CommitSubmissionResult | ApplicationGuard {
  const guard = applicationGuard(db, row, policyRef);
  if (!guard.ok) return guard;
  const intentId = randomUUID(); const operationId = randomUUID(); const timestamp = now.toISOString();
  const tx = db.transaction(() => {
    const current = db.prepare('SELECT state,revision FROM application_attempts WHERE id=?').get(row.id) as { state: string; revision: number } | undefined;
    if (!current || current.state !== 'ready' || current.revision !== Number(row.revision)) throw new Error('STATE_CONFLICT');
    db.prepare("INSERT INTO submission_intents VALUES (?, ?, ?, ?, ?, 'committed', ?, NULL, NULL)").run(intentId, row.id, row.revision, snapshotHash, guard.authority, timestamp);
    if (guard.authority === 'automatic') {
      const policy = db.prepare('SELECT id,timezone,max_submissions_per_day FROM application_policies WHERE id=?').get(policyRef) as { id: string; timezone: string; max_submissions_per_day: number };
      const quota = reserveQuota(db, { intentId, policyRef: policy.id, quotaDate: policyDayKey(now, policy.timezone), timeZone: policy.timezone, cap: policy.max_submissions_per_day, now });
      if (!quota.ok) throw new Error(quota.reason === 'quota_exhausted' ? 'QUOTA_EXHAUSTED' : quota.reason.toUpperCase());
    }
    db.prepare("UPDATE application_attempts SET state='submitting',revision=revision+1,updated_at=? WHERE id=? AND state='ready' AND revision=?").run(timestamp, row.id, row.revision);
    db.prepare('INSERT INTO application_events VALUES (?,?,?,?,?,?)').run(randomUUID(), row.id, 'ready', 'submitting', `SUBMISSION_INTENT_COMMITTED_${guard.authority.toUpperCase()}`, timestamp);
    db.prepare("INSERT INTO operations (id,kind,state,progress,error_code,created_at,updated_at,target_id) VALUES (?, 'submit_application', 'queued', 0, NULL, ?, ?, ?)").run(operationId, timestamp, timestamp, row.id);
  });
  try { tx.immediate(); } catch (error) { if (error instanceof Error && error.message === 'QUOTA_EXHAUSTED') return { ok: false, reason: 'QUOTA_EXHAUSTED' }; throw error; }
  return { intentId, operationId, authority: guard.authority, policyId: guard.policyId };
}
