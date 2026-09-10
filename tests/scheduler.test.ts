import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../packages/adapters/src/database.ts';
import {
  getQuotaUsage,
  getScheduleCursor,
  observeSchedule,
  releaseQuota,
  reserveQuota,
  schedulerSchemaSql,
  consumeQuota,
  setScheduleCursor,
} from '../packages/adapters/src/scheduler.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'aaa-scheduler-'));
  const db = openDatabase(join(dir, 'scheduler.sqlite'));
  db.exec(schedulerSchemaSql);
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const at = (value: string) => new Date(value);

test('persisted schedule cursor emits one catch-up and skips historical ticks', () => {
  const { db, cleanup } = fixture();
  try {
    const first = observeSchedule(db, {
      searchId: 'search-1', enabled: true, nextDueAt: at('2026-01-01T00:00:00Z'),
      now: at('2026-01-03T13:00:00Z'), intervalMs: 6 * 60 * 60 * 1000,
    });
    assert.equal(first.enqueued, true);
    assert.equal(first.reason, 'catch_up');
    assert.equal(first.cursor.nextDueAt.toISOString(), '2026-01-03T18:00:00.000Z');
    assert.equal(first.cursor.lastEnqueuedAt?.toISOString(), '2026-01-03T13:00:00.000Z');

    const retry = observeSchedule(db, {
      searchId: 'search-1', enabled: true, nextDueAt: at('1999-01-01T00:00:00Z'),
      now: at('2026-01-03T13:01:00Z'), intervalMs: 6 * 60 * 60 * 1000,
    });
    assert.equal(retry.enqueued, false);
    assert.equal(retry.reason, 'not_due');
    assert.equal(getScheduleCursor(db, 'search-1')?.nextDueAt.toISOString(), '2026-01-03T18:00:00.000Z');
  } finally { cleanup(); }
});

test('schedule cursor updates are durable and disabled schedules do not enqueue', () => {
  const { db, cleanup } = fixture();
  try {
    setScheduleCursor(db, { searchId: 'search-2', nextDueAt: at('2026-01-01T00:00:00Z') });
    const disabled = observeSchedule(db, {
      searchId: 'search-2', enabled: false, nextDueAt: at('2025-01-01T00:00:00Z'),
      now: at('2026-01-02T00:00:00Z'), intervalMs: 3600000,
    });
    assert.equal(disabled.enqueued, false);
    assert.equal(disabled.reason, 'disabled');
    assert.equal(disabled.cursor.nextDueAt.toISOString(), '2026-01-01T00:00:00.000Z');
  } finally { cleanup(); }
});

test('quota reservation is persistent, atomic in effect, and idempotent', () => {
  const { db, cleanup } = fixture();
  try {
    const input = { intentId: 'intent-1', policyRef: 'policy-1', quotaDate: '2026-01-01', timeZone: 'Australia/Sydney', cap: 2, now: at('2026-01-01T00:00:00Z') };
    const first = reserveQuota(db, input);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.idempotent, false);
    assert.deepEqual(getQuotaUsage(db, input), { policyRef: 'policy-1', quotaDate: '2026-01-01', cap: 2, submitted: 0, reserved: 1, used: 1, available: 1 });
    const retry = reserveQuota(db, input);
    assert.equal(retry.ok, true);
    if (!retry.ok) return;
    assert.equal(retry.idempotent, true);
    assert.equal(reserveQuota(db, { ...input, intentId: 'intent-2' }).ok, true);
    assert.equal(reserveQuota(db, { ...input, intentId: 'intent-3' }).ok, false);
  } finally { cleanup(); }
});

test('quota release can be retried, consume is terminal, and original scope is retained', () => {
  const { db, cleanup } = fixture();
  try {
    const base = { intentId: 'intent-1', policyRef: 'policy-1', quotaDate: '2026-01-01', timeZone: 'UTC', cap: 1 };
    reserveQuota(db, base);
    const released = releaseQuota(db, 'intent-1', at('2026-01-02T00:00:00Z'))!;
    assert.equal(released.state, 'released');
    assert.equal(releaseQuota(db, 'intent-1')?.state, 'released');
    const retry = reserveQuota(db, { ...base, now: at('2026-01-03T00:00:00Z') });
    assert.equal(retry.ok, true);
    const consumed = consumeQuota(db, 'intent-1', at('2026-01-04T00:00:00Z'))!;
    assert.equal(consumed.state, 'consumed');
    assert.equal(consumeQuota(db, 'intent-1')?.state, 'consumed');
    assert.equal(getQuotaUsage(db, base).used, 1);
    assert.equal((db.prepare('SELECT quota_date,time_zone FROM quota_reservations WHERE intent_id=?').get('intent-1') as { quota_date: string; time_zone: string }).quota_date, '2026-01-01');
  } finally { cleanup(); }
});

test('a reservation cannot be replayed under a different policy scope', () => {
  const { db, cleanup } = fixture();
  try {
    const base = { intentId: 'intent-1', policyRef: 'policy-1', quotaDate: '2026-01-01', timeZone: 'UTC', cap: 2 };
    assert.equal(reserveQuota(db, base).ok, true);
    assert.deepEqual(reserveQuota(db, { ...base, policyRef: 'policy-2' }), { ok: false, reason: 'reservation_conflict' });
  } finally { cleanup(); }
});
