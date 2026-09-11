import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
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
    assert.deepEqual(db.prepare('SELECT count(*) AS count FROM schema_migrations').get(), { count: 18 });
    db.pragma('user_version = 19');
    assert.throws(() => migrate(db), /SCHEMA_INCOMPATIBLE/);
  } finally { db.close(); rmSync(dir, { recursive: true }); }
});

test('deployment accepts unconfigured model but rejects invalid budgets and infrastructure URLs', () => {
  const base = { INTERNAL_SECRET_FILE: join(tmpdir(), 'internal') };
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

test('existing version 17 runs retain listings and foreign keys through the state migration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aaa-migrate-')); const db = openDatabase(join(dir, 'app.sqlite'));
  try {
    const migrations = new URL('../packages/adapters/migrations/', import.meta.url);
    for (const name of readdirSync(migrations).filter(name => Number(name.slice(0, 3)) <= 17).sort()) db.exec(readFileSync(new URL(name, migrations), 'utf8'));
    db.pragma('user_version = 17');
    const now = '2026-09-01T00:00:00.000Z';
    db.prepare("INSERT INTO operations (id,kind,state,progress,created_at,updated_at) VALUES ('op','scan','running',0,?,?)").run(now, now);
    db.prepare("INSERT INTO source_configurations VALUES ('source',1,'Jobs','https://example.test/jobs','[\"https://example.test\"]',1,'unverified',NULL,?,?)").run(now, now);
    db.prepare("INSERT INTO scan_runs VALUES ('run','op','running',?,NULL,1,1,NULL,3,0,0)").run(now);
    db.prepare("INSERT INTO discovered_listings (id,scan_run_id,source_id,canonical_url,original_url,title,first_seen_at,last_seen_at) VALUES ('listing','run','source','https://example.test/jobs/1','https://example.test/jobs/1','Engineer',?,?)").run(now, now);
    migrate(db); migrate(db);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal((db.prepare('SELECT revision FROM scan_runs').get() as { revision: number }).revision, 3);
    db.prepare("UPDATE scan_runs SET state='paused' WHERE id='run'").run();
    db.prepare("UPDATE scan_runs SET state='cancelled' WHERE id='run'").run();
    assert.deepEqual(db.prepare('SELECT scan_run_id FROM discovered_listings').get(), { scan_run_id: 'run' });
    assert.throws(() => db.prepare("DELETE FROM scan_runs WHERE id='run'").run(), /FOREIGN KEY/);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
