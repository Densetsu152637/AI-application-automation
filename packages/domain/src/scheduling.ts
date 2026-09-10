/** Pure scheduling and quota rules. All instants are represented by Date, but
 * interval arithmetic is deliberately performed on epoch milliseconds. */

export interface ScheduleTickInput {
  enabled: boolean;
  nextDueAt: Date;
  now: Date;
  intervalMs: number;
  activeRun?: boolean;
}

export interface ScheduleTickDecision {
  due: boolean;
  enqueueCatchUp: boolean;
  /** The cursor after this scheduler observation. */
  nextDueAt: Date;
  reason: 'disabled' | 'not_due' | 'catch_up' | 'active_run' | 'advanced';
}

function assertInterval(intervalMs: number): void {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new RangeError('intervalMs must be a positive integer');
  }
}

/** Returns the first interval boundary strictly after now. */
export function nextDueAtAfter(now: Date, intervalMs: number, boundaryAt: Date = now): Date {
  assertInterval(intervalMs);
  const nowMs = now.getTime();
  const boundaryMs = boundaryAt.getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(boundaryMs)) throw new RangeError('invalid date');
  if (boundaryMs > nowMs) return new Date(boundaryMs);
  const elapsedIntervals = Math.floor((nowMs - boundaryMs) / intervalMs) + 1;
  return new Date(boundaryMs + elapsedIntervals * intervalMs);
}

/**
 * Observe a schedule cursor. A missed schedule emits at most one catch-up
 * signal, then advances directly to the first future UTC boundary.
 */
export function decideScheduleTick(input: ScheduleTickInput): ScheduleTickDecision {
  assertInterval(input.intervalMs);
  const nowMs = input.now.getTime();
  const dueMs = input.nextDueAt.getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(dueMs)) throw new RangeError('invalid date');
  if (!input.enabled) return { due: false, enqueueCatchUp: false, nextDueAt: new Date(dueMs), reason: 'disabled' };
  if (dueMs > nowMs) return { due: false, enqueueCatchUp: false, nextDueAt: new Date(dueMs), reason: 'not_due' };

  const next = nextDueAtAfter(input.now, input.intervalMs, input.nextDueAt);
  if (input.activeRun) return { due: true, enqueueCatchUp: false, nextDueAt: next, reason: 'active_run' };
  return { due: true, enqueueCatchUp: true, nextDueAt: next, reason: 'catch_up' };
}

/** Return YYYY-MM-DD in the supplied IANA timezone, without host-local time. */
export function policyDayKey(at: Date, timeZone: string): string {
  if (!Number.isFinite(at.getTime())) throw new RangeError('invalid date');
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(at);
  } catch {
    throw new RangeError(`invalid IANA timezone: ${timeZone}`);
  }
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  if (!year || !month || !day) throw new RangeError(`could not derive policy day for ${timeZone}`);
  return `${year}-${month}-${day}`;
}

export type QuotaReservationState = 'reserved' | 'consumed' | 'released';

export interface QuotaState {
  cap: number;
  submitted: number;
  reservations: ReadonlyMap<string, QuotaReservationState>;
}

export interface QuotaReservation {
  intentId: string;
  policyRef: string;
  quotaDate: string;
  timeZone: string;
  state: QuotaReservationState;
}

export type QuotaReservationResult =
  | { ok: true; state: QuotaState; reservation: QuotaReservation; idempotent: boolean }
  | { ok: false; reason: 'invalid_cap' | 'already_consumed' | 'quota_exhausted' };

function activeReservationCount(state: QuotaState): number {
  return [...state.reservations.values()].filter((value) => value === 'reserved').length;
}

/** Reserve one automatic slot. Repeating the same intent is idempotent. */
export function reserveQuota(
  state: QuotaState,
  reservation: Omit<QuotaReservation, 'state'>,
): QuotaReservationResult {
  if (!Number.isInteger(state.cap) || state.cap < 0 || !Number.isInteger(state.submitted) || state.submitted < 0) {
    return { ok: false, reason: 'invalid_cap' };
  }
  const existing = state.reservations.get(reservation.intentId);
  if (existing === 'reserved') {
    return { ok: true, state, reservation: { ...reservation, state: existing }, idempotent: true };
  }
  if (existing === 'consumed') return { ok: false, reason: 'already_consumed' };
  if (state.submitted + activeReservationCount(state) >= state.cap) return { ok: false, reason: 'quota_exhausted' };
  const reservations = new Map(state.reservations);
  reservations.set(reservation.intentId, 'reserved');
  return { ok: true, state: { ...state, reservations }, reservation: { ...reservation, state: 'reserved' }, idempotent: false };
}

/** Release only a still-pending reservation; consumed quota cannot be undone. */
export function releaseQuota(state: QuotaState, intentId: string): QuotaState {
  if (state.reservations.get(intentId) !== 'reserved') return state;
  const reservations = new Map(state.reservations);
  reservations.set(intentId, 'released');
  return { ...state, reservations };
}

/** Convert a reservation to consumed quota exactly once. */
export function consumeQuota(state: QuotaState, intentId: string): QuotaState {
  if (state.reservations.get(intentId) !== 'reserved') return state;
  const reservations = new Map(state.reservations);
  reservations.set(intentId, 'consumed');
  return { ...state, submitted: state.submitted + 1, reservations };
}

export function quotaUsed(state: QuotaState): number {
  return state.submitted + activeReservationCount(state);
}
