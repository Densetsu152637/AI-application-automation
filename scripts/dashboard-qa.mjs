// CPU-only production HTTP smoke check. Builds must be completed first.
import { chromium } from 'playwright';
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
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    await page.goto(`${origin}/dashboard`);
    await page.getByText('Smoke source', { exact: true }).waitFor();
    await page.screenshot({ path: resolve('output/dashboard-desktop.png') });
    await page.screenshot({ path: resolve('output/dashboard-full.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Desktop layout overflows');
    await page.getByRole('link', { name: 'Sources', exact: true }).click();
    await page.getByText('Connection settings', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Allowed website and login origins' }).waitFor({ state: 'visible' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: resolve('output/dashboard-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile layout overflows');
    await page.getByRole('textbox', { name: 'Search name', exact: true }).fill('Design engineer');
    await page.getByRole('button', { name: 'Create search', exact: true }).click();
    await page.getByText('Design engineer', { exact: true }).waitFor();
    console.log('Desktop/mobile visual checks, source navigation/settings, and search creation passed.');
    const pollPage = await browser.newPage();
    let operationPolls = 0; let opportunityLoads = 0; let resourceLoads = 0; let opportunityVersion = 0;
    await pollPage.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/operations') { operationPolls++; return route.fulfill({ json: { data: { items: [{ id: 'terminal-1', kind: 'scan', state: 'completed', progress: 100, updatedAt: new Date().toISOString() }] } } }); }
      if (path === '/api/opportunities') { opportunityLoads++; opportunityVersion++; return route.fulfill({ json: { data: { items: [{ id: `opp-${opportunityVersion}`, revision: 1, title: `Refreshed opportunity ${opportunityVersion}`, listingUrl: 'https://example.com/job', decision: 'review' }] } } }); }
      if (path === '/api/resources') { resourceLoads++; return route.fulfill({ json: { data: { items: [{ id: 'resource-1', relativePath: 'resume.pdf', mediaType: 'application/pdf', sizeBytes: 1, extractionState: 'extracted', segmentCount: 1 }] } } }); }
      if (route.request().method() !== 'GET') return route.abort();
      const empty = path.includes('/profile/facts') || path.includes('/applications') || path.includes('/runs') || path.includes('/sources') || path.includes('/searches') ? [] : [];
      return route.fulfill({ json: { data: { items: empty } } });
    });
    await pollPage.goto(`${origin}/dashboard`);
    await pollPage.waitForTimeout(3000);
    await pollPage.getByText(/Refreshed opportunity/).waitFor({ timeout: 5000 });
    assert.ok(opportunityLoads >= 2 && resourceLoads >= 2, 'Terminal first observation refreshes dependent cards');
    const loadsAfterRefresh = opportunityLoads;
    await pollPage.waitForTimeout(2500);
    assert.equal(opportunityLoads, loadsAfterRefresh, 'Identical terminal state does not repeatedly refresh');
    await pollPage.route('**/api/v1/sources', route => route.abort());
    await pollPage.getByRole('textbox', { name: 'Source name', exact: true }).fill('Abort source');
    await pollPage.getByRole('textbox', { name: 'Source URL', exact: true }).fill('https://example.com/jobs');
    await pollPage.getByRole('button', { name: 'Add source', exact: true }).click();
    await pollPage.getByRole('alert').filter({ hasText: 'Unable to connect. Please try again.' }).waitFor();
    console.log('Terminal polling refresh, duplicate terminal suppression, stale-safe background behavior, and aborted mutation UI checks passed.');
    await pollPage.close();
  } finally { await browser.close(); }
  console.log('Production HTTP smoke passed: runtime, database, dashboard, local API access, origin protection, and source browser routes. No inference or containers started.');
} catch (error) { console.error(logs); throw error; }
finally {
  if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  // The child owns all SQLite handles; only remove its isolated temporary directory after exit.
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
