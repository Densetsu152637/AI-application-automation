import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { z } from 'zod';
import { openDatabase, migrate } from '../packages/adapters/src/database.ts';
import { completeStructured } from '../packages/adapters/src/llm.ts';
import { normalizeListingUrl } from '../packages/domain/src/index.ts';
import { createFakeModelServer, createFixtureWebsite, guardedFetch } from './harness/fixture-servers.ts';

test('fixture discovery only reads the local site and collapses tracking duplicates', async () => {
  const site = await createFixtureWebsite();
  const blocked: string[] = [];
  try {
    const response = await guardedFetch([site.url], blocked)(site.startUrl);
    const html = await response.text();
    const links = [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1]!, site.url).toString());
    const unique = [...new Set(links.filter(link => new URL(link).origin === site.url).map(normalizeListingUrl))];
    assert.equal(unique.length, 1);
    assert.equal(unique[0], `${site.url}/jobs/data-engineer`);
    await assert.rejects(() => guardedFetch([site.url], blocked)('https://real-employer.example/jobs/secret'), /fixture network guard blocked/);
    assert.deepEqual(blocked, ['https://real-employer.example/jobs/secret']);
    assert.deepEqual(site.requests.map(request => request.path), ['/search']);
  } finally { await site.close(); }
});

test('fixture model returns deterministic structured output over HTTP', async () => {
  const model = await createFakeModelServer({ decision: 'match' });
  const blocked: string[] = [];
  const schema = z.strictObject({ decision: z.enum(['match', 'reject', 'needs_review']) });
  try {
    const fetcher = guardedFetch([model.url], blocked);
    const config = { baseUrl: `${model.url}/v1`, modelId: model.modelId, timeoutSeconds: 1, contextTokens: 4096, outputTokens: 128 };
    const first = await completeStructured(config, [{ role: 'user', content: 'fixture listing' }], schema, fetcher);
    const second = await completeStructured(config, [{ role: 'user', content: 'fixture listing' }], schema, fetcher);
    assert.deepEqual(first, { decision: 'match' });
    assert.deepEqual(second, first);
    assert.equal(model.requests.length, 2);
    assert.equal(JSON.parse(model.requests[0]!.body).temperature, 0);
    assert.equal(JSON.parse(model.requests[0]!.body).stream, false);
    assert.deepEqual(blocked, []);
  } finally { await model.close(); }
});

test('fixture duplicate persistence is scoped to a source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aaa-fixture-discovery-'));
  const db = openDatabase(join(directory, 'fixture.sqlite'));
  try {
    migrate(db);
    const now = '2026-01-01T00:00:00.000Z'; const sourceId = randomUUID(); const runId = randomUUID();
    db.prepare('INSERT INTO source_configurations VALUES (?,1,?,?,?,?,?,?,?,?)').run(sourceId, 'Fixture board', 'http://fixture.test/search', JSON.stringify(['http://fixture.test']), 1, 'fixture_verified', null, now, now);
    db.prepare("INSERT INTO operations (id,kind,state,progress,error_code,created_at,updated_at) VALUES (?, 'scan', 'queued', 0, NULL, ?, ?)").run(randomUUID(), now, now);
    const operationId = db.prepare("SELECT id FROM operations WHERE kind='scan'").get() as { id: string };
    db.prepare("INSERT INTO scan_runs (id, operation_id, state, started_at, finished_at, source_count, listing_count, error_code) VALUES (?, ?, 'running', ?, NULL, 1, 0, NULL)").run(runId, operationId.id, now);
    const insert = db.prepare("INSERT INTO discovered_listings (id,scan_run_id,source_id,canonical_url,original_url,title,employer,location,first_seen_at,last_seen_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT(source_id, canonical_url) DO UPDATE SET last_seen_at=excluded.last_seen_at,scan_run_id=excluded.scan_run_id");
    const canonical = 'http://fixture.test/jobs/1';
    assert.equal(insert.run(randomUUID(), runId, sourceId, canonical, `${canonical}?utm_source=fixture`, 'Fixture role', now, now).changes, 1);
    assert.equal(insert.run(randomUUID(), runId, sourceId, canonical, canonical, 'Fixture role duplicate', now, now).changes, 1);
    assert.equal((db.prepare('SELECT count(*) AS count FROM discovered_listings').get() as { count: number }).count, 1);
  } finally { db.close(); rmSync(directory, { recursive: true }); }
});
