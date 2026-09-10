import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate } from '../packages/adapters/src/database.ts';
import { claimOperation, createSession, ensureAdministrator, finishOperation, purgeSessions, revokeSession, sessionIsValid } from '../packages/adapters/src/repositories.ts';
import { digest } from '../packages/adapters/src/security.ts';
import { searchSchema, settingsPatchSchema, sourceSchema } from '../packages/contracts/src/index.ts';
import { indexResourceRoot } from '../packages/adapters/src/resources.ts';
import { decideMatch, evaluateCriterion, normalizeListingUrl } from '../packages/domain/src/index.ts';
import { createPolicy } from '../packages/adapters/src/policies.ts';
import { commitSubmission } from '../packages/adapters/src/applications.ts';

function dbFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'aaa-app-'));
  const db = openDatabase(join(dir, 'app.sqlite')); migrate(db);
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('administrator sessions are hashed, revocable, and expire', () => {
  const { db, cleanup } = dbFixture();
  try {
    ensureAdministrator(db, 'a'.repeat(40));
    const raw = createSession(db, 'a'.repeat(40));
    assert.ok(raw); assert.equal(sessionIsValid(db, raw), true);
    const stored = db.prepare('SELECT token_hash FROM dashboard_sessions').get() as { token_hash: string };
    assert.equal(stored.token_hash, digest(raw));
    revokeSession(db, raw); assert.equal(sessionIsValid(db, raw), false);
    const second = createSession(db, 'a'.repeat(40)); assert.ok(second);
    db.prepare('UPDATE dashboard_sessions SET expires_at=? WHERE token_hash=?').run('2000-01-01T00:00:00.000Z', digest(second));
    purgeSessions(db); assert.equal(sessionIsValid(db, second), false);
  } finally { cleanup(); }
});

test('search and settings contracts are closed and bounded', () => {
  assert.equal(searchSchema.safeParse({ name: 'Frontend roles', enabled: false, criteria: [{ field: 'title', value: 'TypeScript', strength: 'required' }] }).success, true);
  assert.equal(searchSchema.safeParse({ name: 'bad', enabled: false, criteria: [{ field: 'title', value: 'x', strength: 'required' }], extra: true }).success, false);
  assert.equal(settingsPatchSchema.safeParse({ llm: { contextTokens: 32768 }, timezoneConfirmed: true }).success, true);
  assert.equal(settingsPatchSchema.safeParse({ llm: { contextTokens: 65536 } }).success, false);
  assert.equal(sourceSchema.safeParse({ name: 'Fixture board', startUrl: 'https://jobs.example.test/search', allowedOrigins: ['https://jobs.example.test'] }).success, true);
  assert.equal(sourceSchema.safeParse({ name: 'Unsafe', startUrl: 'https://jobs.example.test/search', allowedOrigins: ['https://other.example.test'] }).success, false);
});

test('queued operations have a single durable worker claim', () => {
  const { db, cleanup } = dbFixture();
  try {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO operations VALUES ('op-1','scan','queued',0,NULL,?, ?, NULL)").run(now, now);
    assert.deepEqual(claimOperation(db), { id: 'op-1', kind: 'scan', targetId: null });
    assert.equal(claimOperation(db), null);
    finishOperation(db, 'op-1', 'succeeded');
    assert.equal((db.prepare('SELECT state,progress FROM operations WHERE id=\'op-1\'').get() as { state: string; progress: number }).state, 'succeeded');
    assert.equal((db.prepare('SELECT state,progress FROM operations WHERE id=\'op-1\'').get() as { state: string; progress: number }).progress, 100);
  } finally { cleanup(); }
});

test('resource indexing is bounded, repeatable, and records unsupported/missing files', () => {
  const fixture = dbFixture(); const root = mkdtempSync(join(tmpdir(), 'aaa-res-'));
  try {
    mkdirSync(join(root, 'nested')); writeFileSync(join(root, 'profile.md'), '# Alex\nTypeScript'); writeFileSync(join(root, 'nested', 'data.json'), '{"email":"alex@example.test"}'); writeFileSync(join(root, 'image.bin'), Buffer.from([1, 2, 3]));
    assert.deepEqual(indexResourceRoot(fixture.db, root), { indexed: 2, unchanged: 0, unsupported: 1, failed: 0, ignored: 0 });
    assert.equal((fixture.db.prepare("SELECT extraction_state FROM resource_documents WHERE relative_path='profile.md'").get() as { extraction_state: string }).extraction_state, 'extracted');
    assert.equal(indexResourceRoot(fixture.db, root).unchanged, 2);
    rmSync(join(root, 'profile.md')); assert.equal(indexResourceRoot(fixture.db, root).failed, 0);
    assert.equal((fixture.db.prepare("SELECT extraction_state FROM resource_documents WHERE relative_path='profile.md'").get() as { extraction_state: string }).extraction_state, 'missing');
  } finally { fixture.cleanup(); rmSync(root, { recursive: true, force: true }); }
});

test('deterministic matching preserves unknown required criteria and URL identity', () => {
  const criteria = [
    { id: 'title', field: 'title' as const, value: 'typescript', strength: 'required' as const },
    { id: 'location', field: 'location' as const, value: 'Sydney', strength: 'required' as const },
    { id: 'keyword', field: 'keywords' as const, value: 'remote internship', strength: 'preferred' as const },
  ];
  const facts = { title: 'Senior TypeScript Engineer', location: null, description: 'Remote role' };
  const results = criteria.map(criterion => evaluateCriterion(criterion, facts));
  assert.equal(results[0]?.outcome, 'pass'); assert.equal(results[1]?.outcome, 'unknown'); assert.equal(decideMatch(criteria, results), 'needs_review');
  assert.equal(normalizeListingUrl('HTTPS://Example.TEST:443/jobs/ABC?utm_source=x&id=4&gclid=y&id=5#apply'), 'https://example.test/jobs/ABC?id=4&id=5#apply');
  assert.equal(decideMatch(criteria, results.map(result => ({ ...result, outcome: result.criterionId === 'location' ? 'fail' : 'pass' }))), 'reject');
});

test('automatic submission intent guards policy and reserves quota before dispatch', () => {
  const { db, cleanup } = dbFixture();
  try {
    const source = '10000000-0000-4000-8000-000000000001'; const run = '10000000-0000-4000-8000-000000000002'; const listing = '10000000-0000-4000-8000-000000000003'; const search = '10000000-0000-4000-8000-000000000004'; const resume = '10000000-0000-4000-8000-000000000005';
    const now = new Date('2026-01-01T00:00:00.000Z'); const iso = now.toISOString();
    db.prepare("INSERT INTO source_configurations VALUES (?,?,?,?,?,?,?,?,?,?)").run(source, 1, 'Fixture', 'https://jobs.example.test', '["https://jobs.example.test"]', 1, 'fixture_verified', null, iso, iso);
    db.prepare("INSERT INTO operations (id,kind,state,progress,error_code,created_at,updated_at) VALUES (?, 'scan', 'succeeded', 100, NULL, ?, ?)").run('op', iso, iso);
    db.prepare("INSERT INTO scan_runs (id, operation_id, state, started_at, finished_at, source_count, listing_count, error_code) VALUES (?,?,'completed',?, ?, 1, 1, NULL)").run(run, 'op', iso, iso);
    db.prepare("INSERT INTO discovered_listings (id,scan_run_id,source_id,canonical_url,original_url,title,employer,location,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,NULL,NULL,?,?)").run(listing, run, source, 'https://jobs.example.test/a', 'https://jobs.example.test/a', 'A', iso, iso);
    db.prepare("INSERT INTO searches VALUES (?,?,?,?,?,?,?)").run(search, 1, 'Search', 1, '[]', iso, iso);
    const policy = createPolicy(db, { name: 'Auto', enabled: true, mode: 'automatic', eligibleSearchIds: [search], destinationOrigins: ['https://jobs.example.test'], approvedResumeRefs: [{ artifactId: resume, sha256: 'a'.repeat(64) }], allowGeneratedCoverLetter: true, maxSubmissionsPerDay: 1, timezone: 'UTC' }, iso);
    const app = '10000000-0000-4000-8000-000000000006';
    db.prepare("INSERT INTO application_attempts(id,revision,listing_id,state,answers_json,attachments_json,blockers_json,created_at,updated_at,policy_ref,search_id,destination_origin) VALUES (?,1,?,'ready','[]',?,?, ?,?,?,?,?)").run(app, listing, JSON.stringify([{ artifactId: resume, sha256: 'a'.repeat(64) }]), '[]', iso, iso, policy.id, search, 'https://jobs.example.test');
    const row = db.prepare('SELECT * FROM application_attempts WHERE id=?').get(app) as Record<string, unknown>;
    const result = commitSubmission(db, row, 'b'.repeat(64), now, policy.id);
    assert.equal('intentId' in result, true); assert.equal((db.prepare('SELECT state FROM quota_reservations').get() as { state: string }).state, 'reserved');
  } finally { cleanup(); }
});

test('application creation requires and replays idempotency keys', () => {
  const route = readFileSync(join(process.cwd(), 'apps/web-app/app/api/applications/route.ts'), 'utf8');
  assert.match(route, /idempotencyKey\(request\)/);
  assert.match(route, /IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(route, /findIdempotency\(db, scope, key, hash\)/);
  assert.match(route, /IDEMPOTENCY_CONFLICT/);
  assert.match(route, /saveIdempotency\(db, scope, key, hash, 202, envelope, now\)/);
});
