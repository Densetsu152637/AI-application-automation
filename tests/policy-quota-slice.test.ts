import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { migrate, openDatabase } from '../packages/adapters/src/database.ts';
import { createPolicy, getPolicy, policySchema, updatePolicy } from '../packages/adapters/src/policies.ts';
import { getQuotaUsage, reserveQuota } from '../packages/adapters/src/scheduler.ts';

test('migration persists policies and quota reservations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aaa-policy-')); const db = openDatabase(join(dir, 'app.sqlite'));
  try {
    migrate(db);
    assert.equal(db.pragma('user_version', { simple: true }), 16);
    const parsed = policySchema.parse({ name: 'Default', timezone: 'Australia/Sydney' });
    const created = createPolicy(db, parsed, '2026-01-01T00:00:00.000Z');
    assert.equal(created.maxSubmissionsPerDay, 5);
    assert.equal(created.enabled, false);
    assert.equal(getPolicy(db, created.id)?.revision, 1);
    const updated = updatePolicy(db, created.id, 1, { ...parsed, name: 'Updated' }, '2026-01-01T00:00:01.000Z')!;
    assert.equal(updated.revision, 2);
    assert.equal((db.prepare('SELECT name FROM application_policies WHERE id=?').get(created.id) as { name: string }).name, 'Updated');
    assert.equal(reserveQuota(db, { intentId: 'intent-1', policyRef: created.id, quotaDate: '2026-01-01', timeZone: 'Australia/Sydney', cap: 1 }).ok, true);
    assert.equal(getQuotaUsage(db, { policyRef: created.id, quotaDate: '2026-01-01', cap: 1 }).used, 1);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('automatic enabled policies require all authority fields', () => {
  const result = policySchema.safeParse({ name: 'Auto', enabled: true, mode: 'automatic', timezone: 'UTC' });
  assert.equal(result.success, false);
});

test('released reservation rechecks quota before re-reserving', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aaa-policy-')); const db = openDatabase(join(dir, 'app.sqlite'));
  try {
    migrate(db);
    const base = { policyRef: 'policy-1', quotaDate: '2026-01-01', timeZone: 'UTC', cap: 1 };
    assert.equal(reserveQuota(db, { ...base, intentId: 'intent-1' }).ok, true);
    db.prepare("UPDATE quota_reservations SET state='released' WHERE intent_id='intent-1'").run();
    assert.equal(reserveQuota(db, { ...base, intentId: 'intent-2' }).ok, true);
    assert.deepEqual(reserveQuota(db, { ...base, intentId: 'intent-1' }), { ok: false, reason: 'quota_exhausted' });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
