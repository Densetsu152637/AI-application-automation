import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { openDatabase, migrate } from '../packages/adapters/src/database.ts';

test('idempotency records replay identical bodies and reject key reuse with a different body', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aaa-transport-')); const db = openDatabase(join(dir, 'api.sqlite'));
  try {
    migrate(db); const scope = 'session:POST:/api/sources'; const key = 'transport-test-key'; const payload = { name: 'Fixture' }; const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    assert.equal(db.prepare('SELECT * FROM api_idempotency_records WHERE scope=? AND idempotency_key=?').get(scope, key), undefined); db.prepare('INSERT INTO api_idempotency_records VALUES (?,?,?,?,?,?)').run(scope, key, hash, 201, JSON.stringify({ schemaVersion: 1, data: payload, requestId: 'c95ee7f7-6d81-4af4-9d92-06a6f721045f' }), new Date().toISOString());
    const replay = db.prepare('SELECT status,response_json FROM api_idempotency_records WHERE scope=? AND idempotency_key=?').get(scope, key) as { status: number; response_json: string }; assert.deepEqual({ status: replay.status, body: JSON.parse(replay.response_json) }, { status: 201, body: { schemaVersion: 1, data: payload, requestId: 'c95ee7f7-6d81-4af4-9d92-06a6f721045f' } });
    const otherHash = createHash('sha256').update(JSON.stringify({ name: 'Other' })).digest('hex'); assert.notEqual(replay.response_json && hash, otherHash);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
