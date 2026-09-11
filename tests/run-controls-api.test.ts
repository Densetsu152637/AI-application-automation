import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, openDatabase } from '../packages/adapters/src/database.ts';
import { POST as pause } from '../apps/web-app/app/api/runs/[id]/pause/route.ts';
import { POST as resume } from '../apps/web-app/app/api/runs/[id]/resume/route.ts';
import { POST as cancel } from '../apps/web-app/app/api/runs/[id]/cancel/route.ts';

test('run controls reject foreign origins and enforce revisions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-run-controls-')); const dbPath = join(root, 'app.sqlite');
  const secret = join(root, 'internal'); writeFileSync(secret, 'x'.repeat(40));
  const old = { DB_PATH: process.env.DB_PATH, APP_ORIGIN: process.env.APP_ORIGIN, INTERNAL_SECRET_FILE: process.env.INTERNAL_SECRET_FILE };
  process.env.DB_PATH = dbPath; process.env.APP_ORIGIN = 'http://localhost:3000'; process.env.INTERNAL_SECRET_FILE = secret;
  const db = openDatabase(dbPath); migrate(db); const now = new Date().toISOString();
  db.prepare("INSERT INTO operations (id,kind,state,progress,created_at,updated_at) VALUES ('scan-op','scan','running',0,?,?)").run(now, now);
  db.prepare("INSERT INTO scan_runs (id,operation_id,state,started_at,source_count,listing_count) VALUES ('run-1','scan-op','running',?,1,0)").run(now); db.close();
  const call = (handler: typeof pause, origin: string, revision: number) => handler(new Request('http://localhost:3000/api/runs/run-1/pause', { method: 'POST', headers: { origin, 'if-match': `"${revision}"` } }), { params: Promise.resolve({ id: 'run-1' }) });
  try {
    assert.equal((await call(pause, 'https://evil.example', 1)).status, 403);
    let check = openDatabase(dbPath); assert.deepEqual(check.prepare('SELECT count(*) AS n FROM operations').get(), { n: 1 }); check.close();
    assert.equal((await call(pause, 'http://localhost:3000', 1)).status, 202);
    check = openDatabase(dbPath); assert.deepEqual(check.prepare('SELECT count(*) AS n FROM operations').get(), { n: 2 }); check.close();
    assert.equal((await call(pause, 'http://localhost:3000', 1)).status, 409);
    check = openDatabase(dbPath); check.prepare("UPDATE scan_runs SET state='paused',revision=3,pause_requested=1").run(); check.close();
    const resumeResponse = await resume(new Request('http://localhost:3000/api/runs/run-1/resume', { method: 'POST', headers: { origin: 'http://localhost:3000', 'if-match': '"2"' } }), { params: Promise.resolve({ id: 'run-1' }) });
    assert.equal(resumeResponse.status, 409);
    const validResume = await resume(new Request('http://localhost:3000/api/runs/run-1/resume', { method: 'POST', headers: { origin: 'http://localhost:3000', 'if-match': '"3"' } }), { params: Promise.resolve({ id: 'run-1' }) });
    assert.equal(validResume.status, 202);
    const cancelResponse = await cancel(new Request('http://localhost:3000/api/runs/run-1/cancel', { method: 'POST', headers: { origin: 'https://evil.example', 'if-match': '"3"' } }), { params: Promise.resolve({ id: 'run-1' }) });
    assert.equal(cancelResponse.status, 403);
  } finally { process.env.DB_PATH = old.DB_PATH; process.env.APP_ORIGIN = old.APP_ORIGIN; process.env.INTERNAL_SECRET_FILE = old.INTERNAL_SECRET_FILE; }
});
