import { createServer } from 'node:http';
import { accessSync, constants } from 'node:fs';
import { chromium } from 'playwright';
import { readDeployment } from '@aaa/adapters/config';
import { openDatabase, assertSchema } from '@aaa/adapters/database';

async function main() {
  readDeployment();
  for (const path of ['/data', '/browser-profiles', '/output', '/diagnostics']) accessSync(path, constants.R_OK | constants.W_OK);
  accessSync('/resources', constants.R_OK);
  const db = openDatabase('/data/application.sqlite');
  assertSchema(db);
  // Smoke-check only: no job navigation until validated egress is implemented.
  const browser = await chromium.launch({ headless: false, chromiumSandbox: true });
  await browser.close();
  const server = createServer((req, res) => {
    res.writeHead(req.method === 'GET' && req.url === '/health/live' ? 204 : 404, { 'Cache-Control': 'private, no-store' });
    res.end();
  }).listen(3001, '0.0.0.0');
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), severity: 'info', code: 'SCAFFOLD_IDLE', correlationId: null }));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
main().catch(() => { console.error('WORKER_STARTUP_FAILED'); process.exit(1); });
