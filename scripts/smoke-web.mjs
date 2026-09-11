// CPU-only production HTTP smoke check. Builds must be completed first.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const root = mkdtempSync(join(tmpdir(), 'aaa-http-smoke-'));
const origin = `http://127.0.0.1:${port}`;
const secret = join(root, 'internal.txt'); writeFileSync(secret, 'temporary-smoke-secret-'.repeat(3));
let logs = '';
const child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: resolve('apps/web-app'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, APP_ORIGIN: origin, DB_PATH: join(root, 'app.sqlite'), PROFILE_ROOT: join(root, 'profiles'), RESOURCE_ROOT: join(root, 'resources'), OUTPUT_ROOT: join(root, 'output'), DIAGNOSTIC_ROOT: join(root, 'diagnostics'), INTERNAL_SECRET_FILE: secret, LLM_API_KEY_FILE: secret, LLM_BASE_URL: 'http://127.0.0.1:9/v1', NODE_ENV: 'production' },
});
child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Next.js exited: ${logs}`);
    try { ready = (await fetch(`${origin}/health/live`, { signal: AbortSignal.timeout(1000) })).status === 204; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, `Next.js failed to start: ${logs}`);
  const health = await (await fetch(`${origin}/api/health`)).json();
  assert.equal(health.worker, 'ready'); assert.equal(health.database, 'ready'); assert.equal(health.model, 'unavailable');
  const dashboard = await fetch(`${origin}/dashboard`); assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Sign in \/ manage browser|Sources/);
  const source = { name: 'Smoke source', startUrl: 'https://example.com/jobs', allowedOrigins: ['https://example.com'], enabled: false };
  const post = (path, body, requestOrigin = origin) => fetch(`${origin}${path}`, { method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });
  assert.equal((await post('/api/sources', source, 'https://unrelated.example')).status, 403);
  const created = await post('/api/sources', source); assert.equal(created.status, 201);
  const { data } = await created.json();
  const status = await (await fetch(`${origin}/api/sources/${data.id}/browser`)).json(); assert.equal(status.data.active, false);
  const page = await fetch(`${origin}/browser/${data.id}`); assert.equal(page.status, 200); assert.match(await page.text(), /Save session and release to agent/);
  console.log('Production HTTP smoke passed: runtime, database, dashboard, local API access, origin protection, and source browser routes. No inference or containers started.');
} catch (error) { console.error(logs); throw error; }
finally {
  if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  // The child owns all SQLite handles; only remove its isolated temporary directory after exit.
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
