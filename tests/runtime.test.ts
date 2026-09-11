import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { openDatabase, migrate } from '../packages/adapters/src/database.ts';
import { startRuntime, stopRuntime, runtimeStatus } from '../apps/web-app/lib/runtime.ts';

test('the in-process backend migrates, recovers interrupted scans and processes jobs without inference', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-runtime-'));
  const env = { DB_PATH: join(root, 'app.sqlite'), PROFILE_ROOT: join(root, 'profiles'), OUTPUT_ROOT: join(root, 'output'), DIAGNOSTIC_ROOT: join(root, 'diagnostics'), RESOURCE_ROOT: join(root, 'resources'), INTERNAL_SECRET_FILE: join(root, 'secret'), LLM_BASE_URL: 'http://127.0.0.1:9/v1' };
  const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  writeFileSync(env.INTERNAL_SECRET_FILE, 'test-only-secret-'.repeat(3)); mkdirSync(env.RESOURCE_ROOT); writeFileSync(join(env.RESOURCE_ROOT, 'profile.txt'), 'Experience with TypeScript.');
  const probe = mock.method(chromium, 'launch', async () => ({ close: async () => {} }) as never);
  const db = openDatabase(env.DB_PATH); migrate(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO operations (id,kind,state,progress,created_at,updated_at) VALUES ('interrupted','scan','running',0,?,?),('index','reindex','queued',0,?,?)").run(now, now, now, now);
  db.prepare("INSERT INTO scan_runs (id,operation_id,state,started_at,source_count) VALUES ('interrupted-run','interrupted','running',?,1)").run(now);
  try {
    await startRuntime(); await startRuntime();
    for (let count = 0; count < 40; count++) {
      const op = db.prepare("SELECT state FROM operations WHERE id='index'").get() as { state: string };
      if (op.state === 'succeeded') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(runtimeStatus().worker, 'ready');
    assert.equal(probe.mock.calls.length, 1);
    assert.deepEqual(db.prepare("SELECT state,error_code FROM scan_runs WHERE id='interrupted-run'").get(), { state: 'failed', error_code: 'SERVER_RESTARTED' });
    assert.equal((db.prepare("SELECT state FROM operations WHERE id='index'").get() as { state: string }).state, 'succeeded');
    assert.equal((db.prepare('SELECT count(*) AS n FROM resource_documents').get() as { n: number }).n, 1);
    await stopRuntime(); assert.equal(runtimeStatus().worker, 'unavailable');
  } finally {
    await stopRuntime(); db.close(); mock.restoreAll();
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  }
});
