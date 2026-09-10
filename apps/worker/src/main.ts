import { createServer } from 'node:http';
import { accessSync, constants } from 'node:fs';
import { chromium } from 'playwright';
import { readDeployment } from '@aaa/adapters/config';
import { openDatabase, assertSchema } from '@aaa/adapters/database';
import { claimOperation, finishOperation, setWorkPaused } from '@aaa/adapters/repositories';
import { createBackup, restoreBackup } from '@aaa/adapters/backup';
import { indexResourceRoot } from '@aaa/adapters/resources';
import { atomicWriteArtifact, serializeImmutableJson } from '@aaa/adapters/artifacts';
import { tickSchedules } from '@aaa/adapters/scheduler';
import { normalizeListingUrl, validateResolvedEgressUrl } from '@aaa/domain';
import { runModelDiagnostic } from '@aaa/adapters/llm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

async function discover(db: ReturnType<typeof openDatabase>, operationId: string): Promise<void> {
  const sources = db.prepare("SELECT id,start_url,allowed_origins_json FROM source_configurations WHERE enabled=1 ORDER BY updated_at").all() as Array<{ id: string; start_url: string; allowed_origins_json: string }>;
  const started = new Date().toISOString(); const runId = randomUUID();
  db.prepare("INSERT INTO scan_runs (id, operation_id, state, started_at, finished_at, source_count, listing_count, error_code) VALUES (?, ?, 'running', ?, NULL, ?, 0, NULL)").run(runId, operationId, started, sources.length);
  if (sources.length === 0) { db.prepare("UPDATE scan_runs SET state='failed',finished_at=?,error_code='VALIDATION_FAILED' WHERE id=?").run(new Date().toISOString(), runId); throw new Error('VALIDATION_FAILED'); }
  let listingCount = 0; let failed = false; const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  try {
    for (const source of sources) {
      const requested = db.prepare('SELECT state,pause_requested,cancel_requested FROM scan_runs WHERE id=?').get(runId) as { state: string; pause_requested: number; cancel_requested: number };
      if (requested.cancel_requested) { db.prepare("UPDATE scan_runs SET state='cancelled',finished_at=?,revision=revision+1 WHERE id=?").run(new Date().toISOString(), runId); return; }
      if (requested.pause_requested) { db.prepare("UPDATE scan_runs SET state='paused',revision=revision+1 WHERE id=?").run(runId); return; }
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage(); const allowedOrigins = (JSON.parse(source.allowed_origins_json) as string[]).map(value => new URL(value).origin); const allowed = new Set(allowedOrigins);
      await context.route('**/*', async route => {
        const request = route.request();
        let url: URL;
        try { url = new URL(request.url()); } catch { return route.abort('blockedbyclient'); }
        if (!['http:', 'https:'].includes(url.protocol) || !(await validateResolvedEgressUrl(url.toString(), allowedOrigins)).allowed) return route.abort('blockedbyclient');
        return route.continue();
      });
      try {
        await page.goto(source.start_url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const links = await page.locator('a[href]').evaluateAll(anchors => anchors.map(anchor => ({ href: (anchor as HTMLAnchorElement).href, title: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim() })));
        const now = new Date().toISOString();
        for (const link of links.slice(0, 100)) {
          try { const url = new URL(link.href); if (!allowed.has(url.origin) || !link.title) continue; const canonical = normalizeListingUrl(url.toString()); const id = randomUUID(); const result = db.prepare("INSERT INTO discovered_listings (id,scan_run_id,source_id,canonical_url,original_url,title,employer,location,first_seen_at,last_seen_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT(source_id, canonical_url) DO UPDATE SET last_seen_at=excluded.last_seen_at,scan_run_id=excluded.scan_run_id").run(id, runId, source.id, canonical, link.href, link.title, now, now); if (result.changes) listingCount++; } catch { /* malformed links are not candidates */ }
        }
      } catch { failed = true; } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  db.prepare("UPDATE scan_runs SET state=?,finished_at=?,listing_count=?,error_code=? WHERE id=?").run(failed ? 'partial' : 'completed', new Date().toISOString(), listingCount, failed ? 'SOURCE_FAILED' : null, runId);
  const exportedListings = db.prepare('SELECT id,source_id,canonical_url,title,employer,location,first_seen_at,last_seen_at FROM discovered_listings WHERE scan_run_id=? ORDER BY first_seen_at').all(runId);
  atomicWriteArtifact('/output', `exports/${runId}/base.json`, serializeImmutableJson({ schemaVersion: 1, runId, discoveryStatus: failed ? 'partial' : 'completed', opportunities: exportedListings }));
}

async function main() {
  readDeployment();
  for (const path of ['/data', '/browser-profiles', '/output', '/diagnostics']) accessSync(path, constants.R_OK | constants.W_OK);
  accessSync('/resources', constants.R_OK);
  const db = openDatabase('/data/application.sqlite');
  assertSchema(db);
  const operatorCommand = process.argv[2];
  if (operatorCommand === 'backup' || operatorCommand === 'restore') {
    const backupPath = process.env.BACKUP_PATH; if (!backupPath) throw new Error('BACKUP_PATH_REQUIRED');
    if (operatorCommand === 'backup') { await createBackup({ db, destination: backupPath, artifactRoot: process.env.OUTPUT_ROOT ?? '/output', profileRoot: process.env.PROFILE_ROOT ?? '/browser-profiles', hooks: { stopWork: () => setWorkPaused(db, true), checkpoint: () => { db.pragma('wal_checkpoint(PASSIVE)'); }, waitForSubmissions: () => { const row = db.prepare("SELECT count(*) AS count FROM application_attempts WHERE state='submitting'").get() as { count: number }; if (row.count) throw new Error('SUBMISSION_IN_FLIGHT'); } } }); db.close(); return; }
    setWorkPaused(db, true); db.close();
    await restoreBackup({ source: backupPath, dbPath: process.env.DB_PATH ?? '/data/application.sqlite', artifactRoot: process.env.OUTPUT_ROOT ?? '/output', profileRoot: process.env.PROFILE_ROOT ?? '/browser-profiles', hooks: { stopWork: () => undefined } }); return;
  }
  // Do not launch Chromium during worker startup. Queue operations such as
  // reindexing and model diagnostics must be executable even when the browser
  // sandbox is unavailable; discovery launches a guarded browser on demand.
  const server = createServer((req, res) => {
    res.writeHead(req.method === 'GET' && req.url === '/health/live' ? 204 : 404, { 'Cache-Control': 'private, no-store' });
    res.end();
  }).listen(3001, '0.0.0.0');
  const poller = setInterval(async () => {
    tickSchedules(db);
    const operation = claimOperation(db); if (!operation) return;
    try {
      if (operation.kind === 'model_diagnostic') {
        const cfg = readDeployment();
        const diagnostic = await runModelDiagnostic({ baseUrl: cfg.LLM_BASE_URL, modelId: cfg.LLM_MODEL_ID, timeoutSeconds: cfg.LLM_TIMEOUT_SECONDS, contextTokens: cfg.LLM_CONTEXT_TOKENS, outputTokens: cfg.LLM_OUTPUT_TOKENS, apiKey: cfg.LLM_API_KEY_FILE ? readFileSync(cfg.LLM_API_KEY_FILE, 'utf8').trim() : undefined });
        atomicWriteArtifact('/output', `diagnostics/${operation.id}.json`, serializeImmutableJson(diagnostic));
        finishOperation(db, operation.id, diagnostic.checks.every(check => check.state === 'passed') ? 'succeeded' : 'failed', diagnostic.checks.find(check => check.state === 'failed')?.error ?? null);
      } else if (operation.kind === 'reindex') {
        const cfg = readDeployment(); indexResourceRoot(db, '/resources', cfg.RESOURCE_MAX_BYTES); finishOperation(db, operation.id, 'succeeded');
      } else if ((operation.kind === 'pause_run' || operation.kind === 'resume_run' || operation.kind === 'cancel_run') && operation.targetId) {
        const state = operation.kind === 'cancel_run' ? 'cancelled' : operation.kind === 'pause_run' ? 'paused' : 'running';
        db.prepare('UPDATE scan_runs SET state=?,pause_requested=?,cancel_requested=?,revision=revision+1 WHERE id=? AND state NOT IN (\'completed\',\'failed\',\'cancelled\')').run(state, operation.kind === 'pause_run' ? 1 : 0, operation.kind === 'cancel_run' ? 1 : 0, operation.targetId);
        finishOperation(db, operation.id, 'succeeded');
      } else if (operation.kind === 'prepare_application' && operation.targetId) {
        db.prepare("UPDATE application_attempts SET state='preparing',revision=revision+1,updated_at=? WHERE id=? AND state='queued'").run(new Date().toISOString(), operation.targetId);
        db.prepare("UPDATE application_attempts SET state='needs_review',revision=revision+1,blockers_json=?,updated_at=? WHERE id=? AND state='preparing'").run(JSON.stringify([{ code: 'PREPARATION_REVIEW_REQUIRED', message: 'Browser form inspection is required before approval.' }]), new Date().toISOString(), operation.targetId);
        finishOperation(db, operation.id, 'succeeded');
      } else if (operation.kind === 'submit_application' && operation.targetId) {
        const now = new Date().toISOString();
        db.transaction(() => {
          db.prepare("UPDATE submission_intents SET state='submission_unknown',dispatched_at=? WHERE application_id=? AND state='committed'").run(now, operation.targetId);
          db.prepare("UPDATE application_attempts SET state='submission_unknown',revision=revision+1,updated_at=? WHERE id=? AND state='submitting'").run(now, operation.targetId);
          db.prepare('INSERT INTO application_events VALUES (?,?,?,?,?,?)').run(randomUUID(), operation.targetId, 'submitting', 'submission_unknown', 'SUBMISSION_REQUIRES_CONFIRMATION', now);
        })();
        finishOperation(db, operation.id, 'succeeded');
      } else if (operation.kind === 'scan') {
        await discover(db, operation.id); finishOperation(db, operation.id, 'succeeded');
      } else finishOperation(db, operation.id, 'succeeded');
    } catch { finishOperation(db, operation.id, 'failed', 'OPERATION_FAILED'); }
  }, 1000);
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), severity: 'info', code: 'WORKER_READY', correlationId: null }));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { clearInterval(poller); server.close(() => { db.close(); process.exit(0); }); });
}
main().catch((error) => {
  console.error('WORKER_STARTUP_FAILED', error instanceof Error ? error.stack : error);
  process.exit(1);
});
