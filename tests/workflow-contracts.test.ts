import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  atomicWriteArtifact,
  immutableJsonHash,
  readArtifact,
  serializeImmutableJson,
  sha256,
  verifyArtifact,
} from '../packages/adapters/src/artifacts.ts';
import { indexResourceRoot } from '../packages/adapters/src/resources.ts';
import { openDatabase, migrate } from '../packages/adapters/src/database.ts';
import {
  consumeQuota,
  decideScheduleTick,
  quotaUsed,
  releaseQuota,
  reserveQuota,
  type QuotaState,
} from '../packages/domain/src/scheduling.ts';
import {
  createIntervention,
  transitionIntervention,
  ViewerTicketLedger,
} from '../packages/domain/src/intervention.ts';
import {
  decideMatch,
  evaluateCriterion,
  normalizeListingUrl,
} from '../packages/domain/src/index.ts';
import { validateEgressUrl } from '../packages/domain/src/egress.ts';

const at = (value: string) => new Date(value);
const ticketCodec = {
  generateToken: () => 'workflow-ticket',
  hashToken: (value: string) => `sha:${value}`,
};

test('discovery preserves source identity and makes unknown required facts reviewable', () => {
  const criteria = [
    { id: 'title', field: 'title' as const, value: 'typescript', strength: 'required' as const },
    { id: 'location', field: 'location' as const, value: 'Sydney', strength: 'required' as const },
    { id: 'remote', field: 'keywords' as const, value: 'remote', strength: 'preferred' as const },
  ];
  const results = criteria.map((criterion) => evaluateCriterion(criterion, {
    title: 'TypeScript engineer',
    location: null,
    description: 'A role with remote flexibility',
  }));

  assert.equal(results[0]?.outcome, 'pass');
  assert.equal(results[1]?.outcome, 'unknown');
  assert.equal(results[2]?.outcome, 'pass');
  assert.equal(decideMatch(criteria, results), 'needs_review');
  assert.equal(decideMatch(criteria, results.map((result) => ({ ...result, outcome: result.criterionId === 'location' ? 'fail' : result.outcome }))), 'reject');
  assert.equal(decideMatch(criteria, results.map((result) => ({ ...result, outcome: 'pass' }))), 'match');

  assert.equal(
    normalizeListingUrl('HTTPS://Jobs.Example:443/Role/ABC?utm_source=x&id=7&gclid=y&id=8#apply'),
    'https://jobs.example/Role/ABC?id=7&id=8#apply',
  );
  assert.notEqual(normalizeListingUrl('https://jobs.example/role?id=7'), normalizeListingUrl('https://jobs.example/role?id=8'));
});

test('discovery scheduling catches up once and advances to a future UTC boundary', () => {
  const decision = decideScheduleTick({
    enabled: true,
    nextDueAt: at('2026-01-01T00:00:00Z'),
    now: at('2026-01-03T13:00:00Z'),
    intervalMs: 6 * 60 * 60 * 1000,
  });
  assert.equal(decision.due, true);
  assert.equal(decision.enqueueCatchUp, true);
  assert.equal(decision.nextDueAt.toISOString(), '2026-01-03T18:00:00.000Z');

  const active = decideScheduleTick({
    enabled: true,
    nextDueAt: decision.nextDueAt,
    now: at('2026-01-03T13:00:00Z'),
    intervalMs: 6 * 60 * 60 * 1000,
    activeRun: true,
  });
  assert.equal(active.enqueueCatchUp, false);
  assert.equal(decideScheduleTick({
    enabled: false,
    nextDueAt: decision.nextDueAt,
    now: at('2026-01-03T13:00:00Z'),
    intervalMs: 6 * 60 * 60 * 1000,
  }).reason, 'disabled');
});

test('preparation is bounded by intervention takeover and cannot grant control early', () => {
  let task = createIntervention({
    id: 'intervention-1',
    targetId: 'application-1',
    requiredAction: 'Complete CAPTCHA and report the result',
    knownContext: { url: 'https://jobs.example/apply', form: 'application' },
    browserGeneration: 4,
    now: at('2026-01-01T00:00:00Z'),
  });
  assert.equal(task.state, 'open');
  assert.throws(() => transitionIntervention(task, { type: 'begin_human_control' }), /not valid from open/);
  task = transitionIntervention(task, { type: 'request_takeover' }, at('2026-01-01T00:00:01Z'));
  task = transitionIntervention(task, { type: 'suspend_automation' }, at('2026-01-01T00:00:02Z'));
  task = transitionIntervention(task, { type: 'begin_human_control' }, at('2026-01-01T00:00:03Z'));
  assert.equal(task.state, 'human_active');
  task = transitionIntervention(task, { type: 'begin_resolution' }, at('2026-01-01T00:00:04Z'));
  task = transitionIntervention(task, { type: 'resolve', resolution: 'submission_unknown', note: 'The final site state was ambiguous.' }, at('2026-01-01T00:00:05Z'));
  assert.equal(task.state, 'resolved');
  assert.equal(task.resolution, 'submission_unknown');
});

test('approval binds the prepared snapshot to canonical bytes and invalidates changed answers', () => {
  const prepared = {
    applicationId: 'application-1',
    preparedRevision: 3,
    destination: 'https://jobs.example/apply/1',
    listingContentHash: 'listing-v1',
    answers: [{ fieldKey: 'full_name', value: 'Alex Example' }],
    attachments: [{ artifactId: 'resume-1', sha256: 'resume-v1' }],
    formSignature: 'form-v1',
  };
  const approvedHash = immutableJsonHash(prepared);
  assert.equal(approvedHash, immutableJsonHash({ ...prepared, answers: [...prepared.answers] }));
  assert.notEqual(approvedHash, immutableJsonHash({ ...prepared, answers: [{ fieldKey: 'full_name', value: 'Changed Example' }] }));
  assert.notEqual(approvedHash, immutableJsonHash({ ...prepared, attachments: [{ artifactId: 'resume-1', sha256: 'resume-v2' }] }));
  assert.equal(serializeImmutableJson(prepared).toString().includes('applicationId'), true);
});

test('submission intent reserves quota before dispatch and uncertainty does not free it', () => {
  let quota: QuotaState = { cap: 1, submitted: 0, reservations: new Map() };
  const reservation = reserveQuota(quota, {
    intentId: 'intent-1',
    policyRef: 'policy-1',
    quotaDate: '2026-01-01',
    timeZone: 'Australia/Sydney',
  });
  assert.equal(reservation.ok, true);
  if (!reservation.ok) return;
  quota = reservation.state;
  assert.equal(quotaUsed(quota), 1);
  assert.equal(reserveQuota(quota, {
    intentId: 'intent-2', policyRef: 'policy-1', quotaDate: '2026-01-01', timeZone: 'Australia/Sydney',
  }).ok, false);

  // A possible delivery maps to submission_unknown; the reservation remains consumed.
  const unknownQuota = consumeQuota(quota, 'intent-1');
  assert.equal(quotaUsed(unknownQuota), 1);
  assert.equal(releaseQuota(unknownQuota, 'intent-1'), unknownQuota);
  assert.equal(quotaUsed(releaseQuota(quota, 'intent-1')), 0);
});

test('cancellation is allowed before intent but not while submission is in flight', () => {
  let task = createIntervention({
    id: 'intervention-2', targetId: 'application-2', requiredAction: 'Resolve required consent', browserGeneration: 1,
    now: at('2026-01-01T00:00:00Z'),
  });
  task = transitionIntervention(task, { type: 'cancel' }, at('2026-01-01T00:00:01Z'));
  assert.equal(task.state, 'cancelled');
  assert.throws(() => transitionIntervention(task, { type: 'begin_resolution' }), /not valid from cancelled/);

  const ledger = new ViewerTicketLedger(ticketCodec);
  const issued = ledger.issue({ sessionId: 'session-1', interventionId: 'intervention-2', browserGeneration: 1, now: at('2026-01-01T00:00:00Z') });
  ledger.revoke(issued.token, at('2026-01-01T00:00:01Z'));
  assert.throws(() => ledger.consume(issued.token, { sessionId: 'session-1', interventionId: 'intervention-2', browserGeneration: 1 }, at('2026-01-01T00:00:02Z')), /revoked/);
});

test('resource indexing preserves extracted evidence and records unsupported, ignored, and missing states', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-resources-'));
  const dbPath = join(dir, 'workflow.sqlite');
  const root = join(dir, 'resources');
  mkdirSync(root);
  try {
    writeFileSync(join(root, 'resume.md'), '# Alex Example\nTypeScript and remote work');
    writeFileSync(join(root, 'profile.json'), '{"email":"alex@example.test"}');
    writeFileSync(join(root, '~draft.md'), 'ignore');
    writeFileSync(join(root, 'unknown.bin'), Buffer.from([1, 2, 3]));
    const db = openDatabase(dbPath);
    migrate(db);
    try {
      assert.deepEqual(indexResourceRoot(db, root), { indexed: 2, unchanged: 0, unsupported: 1, failed: 0, ignored: 0 });
      assert.equal((db.prepare("SELECT extraction_state FROM resource_documents WHERE relative_path='resume.md'").get() as { extraction_state: string }).extraction_state, 'extracted');
      assert.deepEqual(db.prepare("SELECT count(*) AS count FROM resource_documents WHERE relative_path='~draft.md'").get(), { count: 0 });
      assert.equal(indexResourceRoot(db, root).unchanged, 2);
      rmSync(join(root, 'resume.md'));
      indexResourceRoot(db, root);
      assert.equal((db.prepare("SELECT extraction_state FROM resource_documents WHERE relative_path='resume.md'").get() as { extraction_state: string }).extraction_state, 'missing');
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('artifacts are immutable, hash-verifiable, and suitable for export snapshots', () => {
  const root = mkdtempSync(join(tmpdir(), 'workflow-artifacts-'));
  try {
    const payload = serializeImmutableJson({ discoveryStatus: 'partial', opportunities: [{ id: 'op-1' }] });
    const written = atomicWriteArtifact(root, 'exports/run-1/base.json', payload);
    assert.equal(written.sha256, sha256(payload));
    assert.equal(readArtifact(root, written.storageKey).bytes.toString(), payload.toString());
    assert.deepEqual(verifyArtifact(root, written.storageKey, written.sha256), {
      present: true,
      expired: false,
      sha256: written.sha256,
      sizeBytes: payload.byteLength,
    });
    assert.throws(() => atomicWriteArtifact(root, written.storageKey, Buffer.from('different')), /ARTIFACT_IMMUTABLE_CONFLICT/);
    assert.equal(verifyArtifact(root, 'exports/run-1/missing.json', written.sha256).present, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resource/browser egress permits only configured public origins', () => {
  assert.deepEqual(validateEgressUrl('https://jobs.example/apply', ['https://jobs.example']), {
    allowed: true, hostname: 'jobs.example', port: 443,
  });
  const privateAddress = validateEgressUrl('http://127.0.0.1/admin', ['http://127.0.0.1']);
  const wrongOrigin = validateEgressUrl('https://other.example/apply', ['https://jobs.example']);
  const unsupported = validateEgressUrl('file:///tmp/resume', ['file:///tmp']);
  assert.equal(privateAddress.allowed, false);
  assert.equal(wrongOrigin.allowed, false);
  assert.equal(unsupported.allowed, false);
  if (!privateAddress.allowed) assert.equal(privateAddress.code, 'PRIVATE_ADDRESS');
  if (!wrongOrigin.allowed) assert.equal(wrongOrigin.code, 'INVALID_URL');
  if (!unsupported.allowed) assert.equal(unsupported.code, 'UNSUPPORTED_PROTOCOL');
});

test('opportunity view state is revisioned and dismissal is durable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aaa-opportunity-state-'));
  const db = openDatabase(join(dir, 'app.sqlite'));
  try {
    migrate(db);
    const iso = new Date().toISOString();
    db.prepare("INSERT INTO source_configurations (id,revision,name,start_url,allowed_origins_json,enabled,support_status,support_note,created_at,updated_at) VALUES ('source-1',1,'Fixture','https://jobs.example.test','[\"https://jobs.example.test\"]',1,'fixture_verified',NULL,?,?)").run(iso, iso);
    db.prepare("INSERT INTO operations (id,kind,state,progress,error_code,created_at,updated_at) VALUES ('op-1','scan','succeeded',100,NULL,?,?)").run(iso, iso);
    db.prepare("INSERT INTO scan_runs (id,operation_id,state,started_at,finished_at,source_count,listing_count,error_code) VALUES ('run-1','op-1','completed',?,?,1,1,NULL)").run(iso, iso);
    db.prepare("INSERT INTO discovered_listings (id,scan_run_id,source_id,canonical_url,original_url,title,employer,location,first_seen_at,last_seen_at) VALUES ('listing-1','run-1','source-1','https://jobs.example.test/a','https://jobs.example.test/a','A',NULL,NULL,?,?)").run(iso, iso);
    const before = db.prepare('SELECT revision,dismissed FROM discovered_listings WHERE id=?').get('listing-1') as { revision: number; dismissed: number };
    db.prepare('UPDATE discovered_listings SET dismissed=?,revision=? WHERE id=? AND revision=?').run(1, before.revision + 1, 'listing-1', before.revision);
    assert.deepEqual(db.prepare('SELECT revision,dismissed FROM discovered_listings WHERE id=?').get('listing-1'), { revision: 2, dismissed: 1 });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
