import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate, assertSchema } from '../packages/adapters/src/database.ts';
import { deploymentSchema } from '../packages/adapters/src/config.ts';
import { referenceSchema } from '../packages/contracts/src/index.ts';

test('migration is repeatable and refuses incompatible schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aaa-db-'));
  const db = openDatabase(join(dir, 'test.sqlite'));
  try {
    assert.throws(() => assertSchema(db), /SCHEMA_INCOMPATIBLE/);
    migrate(db); migrate(db); assertSchema(db);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.deepEqual(db.prepare('SELECT count(*) AS count FROM schema_migrations').get(), { count: 16 });
    db.pragma('user_version = 17');
    assert.throws(() => migrate(db), /SCHEMA_INCOMPATIBLE/);
  } finally { db.close(); rmSync(dir, { recursive: true }); }
});

test('deployment accepts unconfigured model but rejects invalid budgets and infrastructure URLs', () => {
  const base = { ADMIN_SECRET_FILE: join(tmpdir(), 'admin'), INTERNAL_SECRET_FILE: join(tmpdir(), 'internal') };
  assert.equal(deploymentSchema.parse(base).LLM_MODEL_ID, 'Qwen3.5-9B');
  assert.equal(deploymentSchema.parse(base).LLM_CONTEXT_TOKENS, 32768);
  for (const overrides of [{ LLM_OUTPUT_TOKENS: 20000 }, { LLM_BASE_URL: 'http://user:pass@localhost/v1' }, { APP_TIMEZONE: 'bad/timezone' }, { DB_BUSY_TIMEOUT_MS: 1 }]) {
    assert.equal(deploymentSchema.safeParse({ ...base, ...overrides }).success, false);
  }
});

test('reference contracts reject extra fields and nonpositive revisions', () => {
  const ref = { id: 'c95ee7f7-6d81-4af4-9d92-06a6f721045f', revision: 1 };
  assert.equal(referenceSchema.safeParse(ref).success, true);
  assert.equal(referenceSchema.safeParse({ ...ref, extra: true }).success, false);
  assert.equal(referenceSchema.safeParse({ ...ref, revision: 0 }).success, false);
});
