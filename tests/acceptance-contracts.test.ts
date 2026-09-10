import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = resolve(join(fileURLToPath(import.meta.url), '..', '..'));

const requiredRoutes = [
  'auth/login/route.ts',
  'auth/logout/route.ts',
  'auth/session/route.ts',
  'health/route.ts',
  'settings/route.ts',
  'settings/model-test/route.ts',
  'searches/route.ts',
  'searches/[id]/route.ts',
  'searches/[id]/validate/route.ts',
  'searches/[id]/runs/route.ts',
  'sources/route.ts',
  'sources/[id]/route.ts',
  'sources/[id]/support-status/route.ts',
  'resources/route.ts',
  'resources/[id]/route.ts',
  'resources/reindex/route.ts',
  'runs/route.ts',
  'runs/[id]/route.ts',
  'runs/[id]/pause/route.ts',
  'runs/[id]/resume/route.ts',
  'runs/[id]/cancel/route.ts',
  'runs/[id]/events/route.ts',
  'opportunities/route.ts',
  'opportunities/[id]/route.ts',
  'opportunities/[id]/dismiss/route.ts',
  'opportunities/[id]/applications/route.ts',
  'operations/route.ts',
  'operations/[id]/route.ts',
  'profile/route.ts',
  'profile/facts/route.ts',
  'profile/questions/route.ts',
  'profile/questions/[id]/route.ts',
  'profile/facts/[id]/route.ts',
  'facts/[id]/confirm/route.ts',
  'facts/[id]/reject/route.ts',
  'facts/[id]/resolve/route.ts',
  'artifacts/[id]/download/route.ts',
  'applications/route.ts',
  'applications/[id]/route.ts',
  'applications/[id]/answers/route.ts',
  'applications/[id]/approve/route.ts',
  'applications/[id]/cancel/route.ts',
  'applications/[id]/submit/route.ts',
  'applications/[id]/resolve-submission/route.ts',
  'exports/route.ts',
  'exports/[...key]/route.ts',
  'exports/[id]/route.ts',
  'exports/[id]/download/route.ts',
  'exports/[id]/retry/route.ts',
  'interventions/route.ts',
  'interventions/[id]/route.ts',
  'interventions/[id]/take-control/route.ts',
  'interventions/[id]/view-ticket/route.ts',
  'interventions/[id]/resolve/route.ts',
  'schedules/route.ts',
  'schedules/[id]/route.ts',
];

test('required API route handlers are present', () => {
  const apiRoot = join(repositoryRoot, 'apps', 'web-app', 'app', 'api');
  const missing = requiredRoutes.filter(route => !statExists(join(apiRoot, route)));
  assert.deepEqual(missing, [], `missing route handlers: ${missing.join(', ')}`);
});

test('opportunity API slice uses the authenticated envelope and mutation safeguards', () => {
  const apiRoot = join(repositoryRoot, 'apps', 'web-app', 'app', 'api');
  const list = readFileSync(join(apiRoot, 'opportunities', 'route.ts'), 'utf8');
  const detail = readFileSync(join(apiRoot, 'opportunities', '[id]', 'route.ts'), 'utf8');
  const applications = readFileSync(join(apiRoot, 'opportunities', '[id]', 'applications', 'route.ts'), 'utf8');
  const dismiss = readFileSync(join(apiRoot, 'opportunities', '[id]', 'dismiss', 'route.ts'), 'utf8');
  for (const source of [detail, applications, dismiss]) {
    assert.match(source, /requireSession/);
    assert.match(source, /apiOk|apiError/);
    assert.match(source, /apiError/);
  }
  assert.match(dismiss, /requireMutationOrigin/);
  assert.match(dismiss, /if-match/);
  assert.match(list, /apiList/); assert.match(list, /requestId/); assert.doesNotMatch(list, /NextResponse\.json/);
  assert.match(list, /application_state/);
  assert.match(dismiss, /idempotencyKey/); assert.match(dismiss, /saveIdempotency/);
});

test('export lifecycle routes enforce authentication, envelopes, and retry safeguards', () => {
  const root = join(repositoryRoot, 'apps', 'web-app', 'app', 'api', 'exports', '[id]');
  const detail = readFileSync(join(root, 'route.ts'), 'utf8');
  const download = readFileSync(join(root, 'download', 'route.ts'), 'utf8');
  const retry = readFileSync(join(root, 'retry', 'route.ts'), 'utf8');
  const lifecycle = readFileSync(join(root, 'lifecycle.ts'), 'utf8');
  for (const source of [detail, download, retry]) {
    assert.match(source, /requireSession/);
    assert.match(source, /apiOk|apiError/);
  }
  assert.match(`${retry}\n${lifecycle}`, /requireMutationOrigin/);
  assert.match(retry, /ifMatch|If-Match|if-match/);
  assert.match(lifecycle, /kind.*'export'/i);
  assert.doesNotMatch(lifecycle, /kind.*'scan'/i);
});

test('resources and profile route families use the shared private transport contract', () => {
  const root = join(repositoryRoot, 'apps', 'web-app', 'app', 'api');
  const files = [
    join(root, 'resources', 'route.ts'), join(root, 'resources', 'reindex', 'route.ts'),
    join(root, 'resources', '[id]', 'route.ts'), join(root, 'profile', 'route.ts'),
    join(root, 'profile', 'facts', 'route.ts'), join(root, 'profile', 'facts', '[id]', 'route.ts'),
  ].map(path => readFileSync(path, 'utf8'));
  for (const source of files) {
    assert.match(source, /apiOk|apiList/); assert.match(source, /apiError/);
    assert.match(source, /requestId/); assert.match(source, /requireSession/);
  }
  for (const source of files) assert.doesNotMatch(source, /NextResponse\.json/,
    'route families must use the shared private apiOk/apiError transport helpers');
  for (const source of files.filter(source => /POST|PATCH/.test(source))) assert.match(source, /requireMutationOrigin/);
  for (const source of files.filter(source => source.includes('profile'))) assert.match(source, /if-match|PRECONDITION_REQUIRED/);
  const reindex = readFileSync(join(root, 'resources', 'reindex', 'route.ts'), 'utf8');
  assert.match(reindex, /idempotencyKey/); assert.match(reindex, /saveIdempotency/);
});

test('application action routes enforce the shared mutation transport contract', () => {
  const root = join(repositoryRoot, 'apps', 'web-app', 'app', 'api', 'applications', '[id]');
  const files = ['answers/route.ts', 'approve/route.ts', 'cancel/route.ts', 'retry/route.ts', 'resolve-submission/route.ts', 'submit/route.ts']
    .map(path => readFileSync(join(root, path), 'utf8'));
  for (const source of files) {
    assert.match(source, /apiOk/); assert.match(source, /apiError/);
    assert.match(source, /requestId/); assert.match(source, /requireSession/);
    assert.match(source, /requireMutationOrigin/); assert.match(source, /if-match|If-Match|PRECONDITION_REQUIRED/);
  }
  assert.match(files[0]!, /idempotencyKey/); assert.match(files[0]!, /saveIdempotency/);
  assert.match(files[2]!, /idempotencyKey/); assert.match(files[2]!, /saveIdempotency/);
  assert.match(files[5]!, /idempotencyKey/); assert.match(files[5]!, /saveIdempotency/);
});

test('fact review mutations require persisted idempotency', () => {
  const root = join(repositoryRoot, 'apps', 'web-app', 'app', 'api', 'facts', '[id]');
  for (const action of ['confirm', 'reject', 'resolve']) {
    const source = readFileSync(join(root, action, 'route.ts'), 'utf8');
    assert.match(source, /idempotencyKey/);
    assert.match(source, /findIdempotency/);
    assert.match(source, /saveIdempotency/);
    assert.match(source, /IDEMPOTENCY_CONFLICT/);
  }
});

test('source support-status mutation requires persisted idempotency', () => {
  const source = readFileSync(join(repositoryRoot, 'apps', 'web-app', 'app', 'api', 'sources', '[id]', 'support-status', 'route.ts'), 'utf8');
  assert.match(source, /idempotencyKey/); assert.match(source, /findIdempotency/); assert.match(source, /saveIdempotency/);
});

test('source update mutation requires persisted idempotency', () => {
  const source = readFileSync(join(repositoryRoot, 'apps', 'web-app', 'app', 'api', 'sources', '[id]', 'route.ts'), 'utf8');
  assert.match(source, /idempotencyKey/); assert.match(source, /findIdempotency/); assert.match(source, /saveIdempotency/);
});

test('policy and settings control routes use the shared transport contract', () => {
  const root = join(repositoryRoot, 'apps', 'web-app', 'app', 'api');
  const files = [
    readFileSync(join(root, 'policies', 'route.ts'), 'utf8'),
    readFileSync(join(root, 'policies', '[id]', 'route.ts'), 'utf8'),
    readFileSync(join(root, 'settings', 'route.ts'), 'utf8'),
  ];
  for (const source of files) {
    assert.match(source, /apiOk/); assert.match(source, /apiError/);
    assert.match(source, /requestId/); assert.match(source, /requireSession/);
  }
  for (const source of files.filter(source => /POST|PATCH/.test(source))) {
    assert.match(source, /requireMutationOrigin/);
  }
  assert.match(files[1]!, /if-match/); assert.match(files[2]!, /if-match/);
  const modelTest = readFileSync(join(root, 'settings', 'model-test', 'route.ts'), 'utf8');
  assert.match(modelTest, /idempotencyKey/); assert.match(modelTest, /saveIdempotency/);
});

test('the versioned API namespace is routed to the implemented handler surface', () => {
  const config = readFileSync(join(repositoryRoot, 'apps', 'web-app', 'next.config.ts'), 'utf8');
  assert.match(config, /source:\s*['"]\/api\/v1\/:path\*['"]/);
  assert.match(config, /destination:\s*['"]\/api\/:path\*['"]/);
});

test('operation creation requires persisted idempotency replay protection', () => {
  const source = readFileSync(join(repositoryRoot, 'apps', 'web-app', 'app', 'api', 'operations', 'route.ts'), 'utf8');
  assert.match(source, /idempotencyKey/); assert.match(source, /findIdempotency/);
  assert.match(source, /saveIdempotency/); assert.match(source, /IDEMPOTENCY_CONFLICT/);
});

test('dashboard polls operation state reactively without reloading the page', () => {
  const source = readFileSync(join(repositoryRoot, 'apps', 'web-app', 'app', 'dashboard', 'view.tsx'), 'utf8');
  assert.match(source, /refreshOperations/);
  assert.match(source, /document\.visibilityState !== 'visible'/);
  assert.match(source, /window\.setInterval\(poll, operationPollFailures >= 3 \? 10_000 : 2_000\)/);
  assert.match(source, /Active operations/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /stale.*last updated/);
});

test('worker health is the authenticated model-status boundary', () => {
  const worker = readFileSync(join(repositoryRoot, 'services', 'worker', 'src', 'main.ts'), 'utf8');
  const health = readFileSync(join(repositoryRoot, 'apps', 'web-app', 'app', 'api', 'health', 'route.ts'), 'utf8');
  assert.match(worker, /\/internal\/health/);
  assert.match(worker, /timingSafeEqual/);
  assert.match(worker, /LLM_BASE_URL.*\/models/);
  assert.match(health, /worker:3001\/internal\/health/);
  assert.match(health, /INTERNAL_SECRET_FILE/);
});

test('migrations are contiguous and ledger versions match filenames', () => {
  const migrationRoot = join(repositoryRoot, 'packages', 'adapters', 'migrations');
  const files = readdirSync(migrationRoot)
    .filter(file => /^\d{3}-.+\.sql$/.test(file))
    .sort();
  assert.ok(files.length > 0, 'at least one migration is required');

  const versions = files.map(file => Number(file.slice(0, 3)));
  assert.deepEqual(versions, versions.map((_, index) => index + 1), 'migration numbering must be contiguous');

  for (const [index, file] of files.entries()) {
    const sql = readFileSync(join(migrationRoot, file), 'utf8');
    const ledgerVersions = [...sql.matchAll(/INSERT\s+INTO\s+schema_migrations\s+VALUES\s*\(\s*(\d+)/gi)]
      .map(match => Number(match[1]));
    assert.deepEqual(ledgerVersions, [index + 1], `${file} must record exactly its own version`);
  }
});

test('deployment and documentation contain no legacy LM configuration', () => {
  const forbidden = new RegExp('(?:^|[^L])(?:L' + 'M_(?:BASE_URL|MODEL_ID|API_KEY_FILE|CONTEXT_TOKENS|OUTPUT_TOKENS)|' + 'L' + 'M Studio)', 'i');
  const scanRoots = ['.env', '.env.example', 'compose.yml', '.github', 'apps', 'packages', 'services', 'infra', 'docs'];
  const violations: string[] = [];

  for (const relativeRoot of scanRoots) {
    const absoluteRoot = join(repositoryRoot, relativeRoot);
    for (const file of filesUnder(absoluteRoot)) {
      if (!/\.(env|example|md|ts|yml|yaml|json)$/.test(file) && !file.endsWith('compose.yml')) continue;
      const contents = readFileSync(file, 'utf8');
      if (forbidden.test(contents)) violations.push(file.slice(repositoryRoot.length + 1));
    }
  }

  assert.deepEqual(violations, [], `legacy LM configuration found in: ${violations.join(', ')}`);
});

function statExists(path: string) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function filesUnder(path: string): string[] {
  if (!statExists(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'tests') return [];
    return filesUnder(join(path, entry.name));
  });
}
