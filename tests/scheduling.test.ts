import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  consumeQuota,
  decideScheduleTick,
  nextDueAtAfter,
  policyDayKey,
  quotaUsed,
  releaseQuota,
  reserveQuota,
  type QuotaState,
} from '../packages/domain/src/scheduling.ts';

const at = (value: string) => new Date(value);

test('UTC interval arithmetic advances to the first boundary after now', () => {
  const due = nextDueAtAfter(at('2026-01-01T10:00:00.000Z'), 6 * 60 * 60 * 1000, at('2026-01-01T00:00:00.000Z'));
  assert.equal(due.toISOString(), '2026-01-01T12:00:00.000Z');
  assert.equal(nextDueAtAfter(at('2026-01-01T06:00:00Z'), 3600000, at('2026-01-01T05:00:00Z')).toISOString(), '2026-01-01T07:00:00.000Z');
});

test('DST does not alter elapsed UTC schedule intervals', () => {
  const decision = decideScheduleTick({ enabled: true, nextDueAt: at('2026-10-04T15:00:00Z'), now: at('2026-10-04T16:30:00Z'), intervalMs: 6 * 3600000 });
  assert.equal(decision.enqueueCatchUp, true);
  assert.equal(decision.nextDueAt.toISOString(), '2026-10-04T21:00:00.000Z');
});

test('policy day key follows the IANA timezone across DST boundary', () => {
  assert.equal(policyDayKey(at('2026-04-05T09:30:00Z'), 'Australia/Sydney'), '2026-04-05');
  assert.equal(policyDayKey(at('2026-04-05T16:30:00Z'), 'America/Los_Angeles'), '2026-04-05');
  assert.equal(policyDayKey(at('2026-04-06T06:30:00Z'), 'America/Los_Angeles'), '2026-04-05');
});

test('a missed schedule produces one catch-up and skips historical ticks', () => {
  const decision = decideScheduleTick({ enabled: true, nextDueAt: at('2026-01-01T00:00:00Z'), now: at('2026-01-03T13:00:00Z'), intervalMs: 6 * 3600000 });
  assert.equal(decision.due, true);
  assert.equal(decision.enqueueCatchUp, true);
  assert.equal(decision.nextDueAt.toISOString(), '2026-01-03T18:00:00.000Z');
  assert.equal(decideScheduleTick({ enabled: true, nextDueAt: decision.nextDueAt, now: at('2026-01-03T13:01:00Z'), intervalMs: 6 * 3600000, activeRun: true }).enqueueCatchUp, false);
});

test('disabled schedules and future cursors do not enqueue work', () => {
  const next = at('2026-01-02T00:00:00Z');
  assert.equal(decideScheduleTick({ enabled: false, nextDueAt: next, now: at('2026-01-03T00:00:00Z'), intervalMs: 3600000 }).reason, 'disabled');
  assert.equal(decideScheduleTick({ enabled: true, nextDueAt: next, now: at('2026-01-01T00:00:00Z'), intervalMs: 3600000 }).enqueueCatchUp, false);
});

test('quota reservations count submitted and pending work, with idempotent retry', () => {
  let state: QuotaState = { cap: 2, submitted: 1, reservations: new Map() };
  const input = { intentId: 'i-1', policyRef: 'p-1', quotaDate: '2026-01-01', timeZone: 'UTC' };
  const first = reserveQuota(state, input);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  state = first.state;
  assert.equal(quotaUsed(state), 2);
  const retry = reserveQuota(state, input);
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.idempotent, true);
  assert.equal(quotaUsed(retry.state), 2);
  assert.equal(reserveQuota(state, { ...input, intentId: 'i-2' }).ok, false);
});

test('release frees a pending slot, while consume and release are idempotent', () => {
  const base: QuotaState = { cap: 1, submitted: 0, reservations: new Map() };
  const reserved = reserveQuota(base, { intentId: 'i-1', policyRef: 'p', quotaDate: '2026-01-01', timeZone: 'UTC' });
  assert.equal(reserved.ok, true);
  if (!reserved.ok) return;
  const consumed = consumeQuota(reserved.state, 'i-1');
  assert.equal(quotaUsed(consumed), 1);
  assert.equal(releaseQuota(consumed, 'i-1'), consumed);
  const released = releaseQuota(reserved.state, 'i-1');
  assert.equal(quotaUsed(released), 0);
  assert.equal(reserveQuota(released, { intentId: 'i-2', policyRef: 'p', quotaDate: '2026-01-01', timeZone: 'UTC' }).ok, true);
});
