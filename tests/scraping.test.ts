import assert from 'node:assert/strict';
import test from 'node:test';
import { discover, parseJobPostings, selectCandidates, type ScrapeDeps } from '../apps/web-app/lib/scraping.ts';
import { migrate, openDatabase } from '../packages/adapters/src/database.ts';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';

test('selectCandidates rejects navigation links and duplicate tracking URLs', () => {
  const result = selectCandidates([
    { href: 'https://jobs.example.test/jobs/1?utm_source=x', title: ' Engineer  ' },
    { href: 'https://jobs.example.test/jobs/1?utm_medium=y', title: 'Engineer duplicate' },
    { href: 'mailto:jobs@example.test', title: 'Email' },
    { href: 'https://other.example.test/jobs/2', title: 'Other' },
    { href: 'https://jobs.example.test/jobs/3', title: '  ' },
  ], ['https://jobs.example.test']);
  assert.deepEqual(result.map(item => item.href), ['https://jobs.example.test/jobs/1?utm_source=x']);
  assert.equal(result[0]?.title, 'Engineer');
});

test('selectCandidates applies the limit after filtering', () => {
  const items = Array.from({ length: 4 }, (_, i) => ({ href: `https://jobs.example.test/${i}`, title: `Job ${i}` }));
  assert.equal(selectCandidates(items, ['https://jobs.example.test'], 2).length, 2);
});

test('structured listings support graphs, relative URLs and arbitrary job titles', () => {
  const postings = parseJobPostings([JSON.stringify({ '@graph': [
    { '@type': ['Thing', 'JobPosting'], url: '/opening/1', title: 'Baker', hiringOrganization: { name: 'Bakery' } },
    { '@type': 'JobPosting', url: 'http://[', title: 'Malformed' },
    { '@type': 'JobPosting', title: 'Gardener' },
  ] }), '{broken'], 'https://jobs.example.test/detail');
  const results = selectCandidates(postings, ['https://jobs.example.test']);
  assert.deepEqual(results.map(item => item.title), ['Baker', 'Gardener']);
  assert.equal(results[0]?.href, 'https://jobs.example.test/opening/1');
  assert.equal(results[0]?.employer, 'Bakery');
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aaa-scrape-'));
  const db = openDatabase(join(root, 'app.sqlite')); migrate(db);
  const oldRoot = process.env.OUTPUT_ROOT; process.env.OUTPUT_ROOT = root;
  const now = '2026-09-01T00:00:00.000Z';
  db.prepare("INSERT INTO operations (id,kind,state,progress,created_at,updated_at) VALUES ('operation','scan','running',0,?,?)").run(now, now);
  db.prepare("INSERT INTO source_configurations VALUES ('source',1,'Jobs','https://jobs.example.test/jobs','[\"https://jobs.example.test\"]',1,'unverified',NULL,?,?)").run(now, now);
  return { db, root, cleanup() { db.close(); if (oldRoot === undefined) delete process.env.OUTPUT_ROOT; else process.env.OUTPUT_ROOT = oldRoot; rmSync(root, { recursive: true, force: true }); } };
}
function fakePage(options: { httpStatus?: number; login?: boolean; empty?: boolean } = {}): Page {
  return {
    goto: async () => ({ status: () => options.httpStatus ?? 200 }),
    url: () => 'https://jobs.example.test/jobs',
    waitForFunction: async () => undefined,
    locator: (selector: string) => ({
      count: async () => selector.includes('password') && options.login ? 1 : 0,
      evaluateAll: async () => options.empty ? [] : [
        { href: 'https://jobs.example.test/jobs/1?utm_source=a', title: 'Engineer' },
        { href: 'https://jobs.example.test/jobs/1?utm_source=b', title: 'Engineer' },
      ],
      allTextContents: async () => [],
    }),
  } as unknown as Page;
}
function pageDeps(page: Page, after?: () => void): ScrapeDeps {
  return { withSourcePage: async (_source, fn) => { const result = await fn(page); after?.(); return result; } };
}

test('discovery deduplicates persistence and writes its final export', async () => {
  const f = fixture();
  try {
    await discover(f.db, 'operation', pageDeps(fakePage()));
    const run = f.db.prepare('SELECT * FROM scan_runs').get() as { id: string; state: string; listing_count: number };
    assert.equal(run.state, 'completed'); assert.equal(run.listing_count, 1);
    const exported = JSON.parse(readFileSync(join(f.root, 'exports', run.id, 'base.json'), 'utf8'));
    assert.equal(exported.opportunities.length, 1);
  } finally { f.cleanup(); }
});

test('browser launch, HTTP, login and empty-page failures finish the run', async () => {
  for (const [expected, deps] of [
    ['SOURCE_FAILED', { withSourcePage: async () => { throw new Error('browser launch failed'); } }],
    ['SOURCE_HTTP_ERROR', pageDeps(fakePage({ httpStatus: 500 }))],
    ['SOURCE_LOGIN_REQUIRED', pageDeps(fakePage({ login: true }))],
    ['SOURCE_NO_LISTINGS', pageDeps(fakePage({ empty: true }))],
  ] as Array<[string, ScrapeDeps]>) {
    const f = fixture();
    try {
      await assert.rejects(() => discover(f.db, 'operation', deps), new RegExp(expected));
      const run = f.db.prepare('SELECT state,error_code,finished_at FROM scan_runs').get() as Record<string, unknown>;
      assert.equal(run.state, 'failed'); assert.equal(run.error_code, expected); assert.ok(run.finished_at);
    } finally { f.cleanup(); }
  }
});

test('pause on the last source preserves counts and resume keeps the same run', async () => {
  const f = fixture();
  try {
    await discover(f.db, 'operation', pageDeps(fakePage(), () => { f.db.prepare('UPDATE scan_runs SET pause_requested=1').run(); }));
    const paused = f.db.prepare('SELECT id,state,listing_count FROM scan_runs').get() as { id: string; state: string; listing_count: number };
    assert.equal(paused.state, 'paused'); assert.equal(paused.listing_count, 1);
    f.db.prepare('UPDATE scan_runs SET pause_requested=0').run();
    await discover(f.db, 'operation', pageDeps(fakePage()));
    assert.deepEqual(f.db.prepare('SELECT id,state,listing_count FROM scan_runs').all(), [{ id: paused.id, state: 'completed', listing_count: 1 }]);
  } finally { f.cleanup(); }
});

test('shutdown stops at the source boundary and preserves the current run', async () => {
  const f = fixture(); let stopping = false; let calls = 0;
  try {
    const now = '2026-09-01T00:00:00.000Z';
    f.db.prepare("INSERT INTO source_configurations VALUES ('source-two',1,'Second jobs','https://jobs.example.test/second','[\"https://jobs.example.test\"]',1,'unverified',NULL,?,?)").run(now, now);
    await discover(f.db, 'operation', { shouldStop: () => stopping, withSourcePage: async (_source, fn) => { calls++; const result = await fn(fakePage()); stopping = true; return result; } });
    assert.equal(calls, 1);
    assert.deepEqual(f.db.prepare('SELECT state,pause_requested,error_code,listing_count FROM scan_runs').get(), { state: 'paused', pause_requested: 1, error_code: 'SERVER_SHUTDOWN', listing_count: 1 });
    assert.deepEqual(f.db.prepare('SELECT count(*) AS count FROM scan_runs').get(), { count: 1 });
  } finally { f.cleanup(); }
});

test('cancel on the last source remains cancelled and export failures cannot report success', async () => {
  const f = fixture();
  try {
    await discover(f.db, 'operation', pageDeps(fakePage(), () => { f.db.prepare('UPDATE scan_runs SET cancel_requested=1').run(); }));
    assert.equal((f.db.prepare('SELECT state FROM scan_runs').get() as { state: string }).state, 'cancelled');
  } finally { f.cleanup(); }
  const g = fixture();
  try {
    const file = join(g.root, 'not-a-directory'); writeFileSync(file, 'x'); process.env.OUTPUT_ROOT = file;
    await assert.rejects(() => discover(g.db, 'operation', pageDeps(fakePage())));
    assert.deepEqual(g.db.prepare('SELECT state,error_code FROM scan_runs').get(), { state: 'failed', error_code: 'EXPORT_FAILED' });
  } finally { g.cleanup(); }
});
