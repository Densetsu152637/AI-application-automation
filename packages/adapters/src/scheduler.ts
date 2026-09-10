import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { decideScheduleTick, type ScheduleTickDecision } from '../../domain/src/scheduling.ts';

/**
 * Tables required by this adapter. This is intentionally exported instead of
 * being a migration: deployments may provision these tables independently.
 * The adapter never creates or alters schema implicitly.
 */
export const schedulerSchemaSql = `
CREATE TABLE IF NOT EXISTS schedule_cursors (
  search_id TEXT PRIMARY KEY,
  next_due_at TEXT NOT NULL,
  last_enqueued_at TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS quota_reservations (
  intent_id TEXT PRIMARY KEY,
  policy_ref TEXT NOT NULL,
  quota_date TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'consumed', 'released')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS quota_reservations_scope_idx
  ON quota_reservations(policy_ref, quota_date, state);
CREATE TABLE IF NOT EXISTS schedule_definitions (
  search_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  interval_ms INTEGER NOT NULL CHECK (interval_ms > 0),
  updated_at TEXT NOT NULL
) STRICT;
`;

/** Provision the scheduler contract when the deployment has not supplied it. */
export function ensureSchedulerSchema(db: Database.Database): void { db.exec(schedulerSchemaSql); }

export interface ScheduleCursor {
  searchId: string;
  nextDueAt: Date;
  lastEnqueuedAt: Date | null;
}

export interface ObserveScheduleInput {
  searchId: string;
  enabled: boolean;
  /** Used to initialize a missing cursor (normally now + interval). */
  nextDueAt: Date;
  intervalMs: number;
  now?: Date;
  activeRun?: boolean;
}

export interface ObserveScheduleResult extends ScheduleTickDecision {
  cursor: ScheduleCursor;
  /** True only for the transaction that advanced a due cursor and emitted work. */
  enqueued: boolean;
}

type CursorRow = { search_id: string; next_due_at: string; last_enqueued_at: string | null };
type ReservationRow = {
  intent_id: string; policy_ref: string; quota_date: string; time_zone: string;
  state: 'reserved' | 'consumed' | 'released'; created_at: string; resolved_at: string | null;
};

function validId(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) throw new TypeError(`${name} must be 1..256 characters`);
  return value;
}
function iso(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new RangeError('invalid date');
  return date.toISOString();
}
function toCursor(row: CursorRow): ScheduleCursor {
  return { searchId: row.search_id, nextDueAt: new Date(row.next_due_at), lastEnqueuedAt: row.last_enqueued_at ? new Date(row.last_enqueued_at) : null };
}
function transaction<T>(db: Database.Database, fn: () => T): T {
  return db.transaction(fn).immediate();
}

export function getScheduleCursor(db: Database.Database, searchId: string): ScheduleCursor | null {
  validId(searchId, 'searchId');
  const row = db.prepare('SELECT search_id,next_due_at,last_enqueued_at FROM schedule_cursors WHERE search_id=?').get(searchId) as CursorRow | undefined;
  return row ? toCursor(row) : null;
}

/** Upsert is useful when enabling a schedule; it does not enqueue work. */
export function setScheduleCursor(db: Database.Database, input: { searchId: string; nextDueAt: Date; lastEnqueuedAt?: Date | null }): ScheduleCursor {
  const searchId = validId(input.searchId, 'searchId');
  const nextDueAt = iso(input.nextDueAt);
  const last = input.lastEnqueuedAt == null ? null : iso(input.lastEnqueuedAt);
  transaction(db, () => {
    db.prepare(`INSERT INTO schedule_cursors(search_id,next_due_at,last_enqueued_at) VALUES (?,?,?)
      ON CONFLICT(search_id) DO UPDATE SET next_due_at=excluded.next_due_at,last_enqueued_at=excluded.last_enqueued_at`).run(searchId, nextDueAt, last);
  });
  return getScheduleCursor(db, searchId)!;
}

/**
 * Atomically observes and advances one cursor. A missed cursor emits one
 * catch-up at most; it is advanced past all historical boundaries in the
 * same transaction, so concurrent workers cannot emit a duplicate catch-up.
 */
export function observeSchedule(db: Database.Database, input: ObserveScheduleInput): ObserveScheduleResult {
  const searchId = validId(input.searchId, 'searchId');
  const now = input.now ?? new Date();
  const nowIso = iso(now);
  const initialNext = iso(input.nextDueAt);
  let result!: ObserveScheduleResult;
  transaction(db, () => {
    let row = db.prepare('SELECT search_id,next_due_at,last_enqueued_at FROM schedule_cursors WHERE search_id=?').get(searchId) as CursorRow | undefined;
    if (!row) {
      db.prepare('INSERT INTO schedule_cursors(search_id,next_due_at,last_enqueued_at) VALUES (?,?,NULL)').run(searchId, initialNext);
      row = { search_id: searchId, next_due_at: initialNext, last_enqueued_at: null };
    }
    const decision = decideScheduleTick({ enabled: input.enabled, nextDueAt: new Date(row.next_due_at), now, intervalMs: input.intervalMs, activeRun: input.activeRun });
    const enqueued = decision.enqueueCatchUp;
    if (decision.nextDueAt.toISOString() !== row.next_due_at || enqueued) {
      db.prepare('UPDATE schedule_cursors SET next_due_at=?,last_enqueued_at=? WHERE search_id=?').run(decision.nextDueAt.toISOString(), enqueued ? nowIso : row.last_enqueued_at, searchId);
    }
    const updated = db.prepare('SELECT search_id,next_due_at,last_enqueued_at FROM schedule_cursors WHERE search_id=?').get(searchId) as CursorRow;
    result = { ...decision, cursor: toCursor(updated), enqueued };
  });
  return result;
}

export interface ScheduleTick {
  searchId: string;
  enabled: boolean;
  intervalMs: number;
  result: ObserveScheduleResult;
  operationId: string | null;
}

/**
 * Worker-facing scheduler hook. It applies the pure cursor rules, and when a
 * cursor is due emits one durable scan operation. The schema is a contract,
 * so callers must provision it with ensureSchedulerSchema first.
 */
export function tickSchedules(db: Database.Database, now = new Date()): ScheduleTick[] {
  ensureSchedulerSchema(db);
  const definitions = db.prepare('SELECT search_id,enabled,interval_ms FROM schedule_definitions ORDER BY search_id').all() as Array<{ search_id: string; enabled: number; interval_ms: number }>;
  return definitions.map((definition) => {
    const result = observeSchedule(db, {
      searchId: definition.search_id,
      enabled: Boolean(definition.enabled),
      nextDueAt: new Date(now.getTime() + definition.interval_ms),
      intervalMs: definition.interval_ms,
      now,
    });
    let operationId: string | null = null;
    if (result.enqueued) {
      operationId = randomUUID();
      db.prepare("INSERT INTO operations (id,kind,state,progress,error_code,created_at,updated_at,target_id) VALUES (?, 'scan', 'queued', 0, NULL, ?, ?, ?)").run(operationId, now.toISOString(), now.toISOString(), definition.search_id);
    }
    return { searchId: definition.search_id, enabled: Boolean(definition.enabled), intervalMs: definition.interval_ms, result, operationId };
  });
}

export type ReservationState = ReservationRow['state'];
export interface QuotaReservation { intentId: string; policyRef: string; quotaDate: string; timeZone: string; state: ReservationState; createdAt: Date; resolvedAt: Date | null; }
export interface QuotaUsage { policyRef: string; quotaDate: string; cap: number; submitted: number; reserved: number; used: number; available: number; }
export type ReserveQuotaResult = { ok: true; reservation: QuotaReservation; idempotent: boolean; usage: QuotaUsage } | { ok: false; reason: 'invalid_cap' | 'already_consumed' | 'quota_exhausted' | 'reservation_conflict' };

function reservation(row: ReservationRow): QuotaReservation {
  return { intentId: row.intent_id, policyRef: row.policy_ref, quotaDate: row.quota_date, timeZone: row.time_zone, state: row.state, createdAt: new Date(row.created_at), resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null };
}
function scope(input: { intentId: string; policyRef: string; quotaDate: string; timeZone: string }): void {
  validId(input.intentId, 'intentId'); validId(input.policyRef, 'policyRef'); validId(input.timeZone, 'timeZone');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.quotaDate) || !Number.isFinite(Date.parse(`${input.quotaDate}T00:00:00Z`))) throw new RangeError('quotaDate must be YYYY-MM-DD');
}
function usageInTx(db: Database.Database, policyRef: string, quotaDate: string, cap: number): QuotaUsage {
  const row = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN state='consumed' THEN 1 ELSE 0 END),0) AS submitted,
    COALESCE(SUM(CASE WHEN state='reserved' THEN 1 ELSE 0 END),0) AS reserved
    FROM quota_reservations WHERE policy_ref=? AND quota_date=?`).get(policyRef, quotaDate) as { submitted: number; reserved: number };
  return { policyRef, quotaDate, cap, submitted: row.submitted, reserved: row.reserved, used: row.submitted + row.reserved, available: Math.max(0, cap - row.submitted - row.reserved) };
}

/** Reserve is linearized with BEGIN IMMEDIATE and retries of the same intent are idempotent. */
export function reserveQuota(db: Database.Database, input: { intentId: string; policyRef: string; quotaDate: string; timeZone: string; cap: number; now?: Date }): ReserveQuotaResult {
  scope(input);
  if (!Number.isInteger(input.cap) || input.cap < 0) return { ok: false, reason: 'invalid_cap' };
  const createdAt = iso(input.now ?? new Date()); let result!: ReserveQuotaResult;
  transaction(db, () => {
    const existing = db.prepare('SELECT * FROM quota_reservations WHERE intent_id=?').get(input.intentId) as ReservationRow | undefined;
    if (existing) {
      if (existing.policy_ref !== input.policyRef || existing.quota_date !== input.quotaDate || existing.time_zone !== input.timeZone) { result = { ok: false, reason: 'reservation_conflict' }; return; }
      if (existing.state === 'consumed') { result = { ok: false, reason: 'already_consumed' }; return; }
      if (existing.state === 'reserved') { result = { ok: true, reservation: reservation(existing), idempotent: true, usage: usageInTx(db, input.policyRef, input.quotaDate, input.cap) }; return; }
      const usage = usageInTx(db, input.policyRef, input.quotaDate, input.cap);
      if (usage.used >= input.cap) { result = { ok: false, reason: 'quota_exhausted' }; return; }
      db.prepare("UPDATE quota_reservations SET state='reserved',resolved_at=NULL WHERE intent_id=?").run(input.intentId);
    } else {
      const usage = usageInTx(db, input.policyRef, input.quotaDate, input.cap);
      if (usage.used >= input.cap) { result = { ok: false, reason: 'quota_exhausted' }; return; }
      db.prepare('INSERT INTO quota_reservations(intent_id,policy_ref,quota_date,time_zone,state,created_at,resolved_at) VALUES (?,?,?,?,?,?,NULL)').run(input.intentId, input.policyRef, input.quotaDate, input.timeZone, 'reserved', createdAt);
    }
    const row = db.prepare('SELECT * FROM quota_reservations WHERE intent_id=?').get(input.intentId) as ReservationRow;
    result = { ok: true, reservation: reservation(row), idempotent: false, usage: usageInTx(db, input.policyRef, input.quotaDate, input.cap) };
  });
  return result;
}

export function getQuotaUsage(db: Database.Database, input: { policyRef: string; quotaDate: string; cap: number }): QuotaUsage {
  validId(input.policyRef, 'policyRef'); if (!Number.isInteger(input.cap) || input.cap < 0) throw new RangeError('cap must be a non-negative integer');
  return usageInTx(db, input.policyRef, input.quotaDate, input.cap);
}
function resolveQuota(db: Database.Database, intentId: string, state: 'consumed' | 'released', now: Date): QuotaReservation | null {
  validId(intentId, 'intentId'); const timestamp = iso(now); let out: QuotaReservation | null = null;
  transaction(db, () => {
    const row = db.prepare('SELECT * FROM quota_reservations WHERE intent_id=?').get(intentId) as ReservationRow | undefined;
    if (!row || row.state !== 'reserved') { out = row ? reservation(row) : null; return; }
    db.prepare('UPDATE quota_reservations SET state=?,resolved_at=? WHERE intent_id=? AND state=\'reserved\'').run(state, timestamp, intentId);
    out = reservation(db.prepare('SELECT * FROM quota_reservations WHERE intent_id=?').get(intentId) as ReservationRow);
  });
  return out;
}
export function consumeQuota(db: Database.Database, intentId: string, now = new Date()): QuotaReservation | null { return resolveQuota(db, intentId, 'consumed', now); }
export function releaseQuota(db: Database.Database, intentId: string, now = new Date()): QuotaReservation | null { return resolveQuota(db, intentId, 'released', now); }
