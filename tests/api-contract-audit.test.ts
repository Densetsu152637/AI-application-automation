import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const apiRoot = join(process.cwd(), 'apps', 'web-app', 'app', 'api');
function routeFiles(directory = apiRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === 'route.ts' ? [path] : [];
  });
}
function routePath(file: string): string {
  const path = relative(apiRoot, file).replaceAll('\\', '/').replace(/\/route\.ts$/, '');
  return `/api/${path}`.replace(/\/$/, '');
}
const files = routeFiles();
const sourceByPath = new Map(files.map(file => [routePath(file), readFileSync(file, 'utf8')]));

test('local domain routes have no login requirement and mutations retain origin guards', () => {
  const auth = readFileSync(join(process.cwd(), 'apps', 'web-app', 'lib', 'auth.ts'), 'utf8');
  assert.match(auth, /requireSession\(\): Promise<boolean> \{ return true; \}/);
  for (const path of ['/api/resources', '/api/sources', '/api/profile']) {
    assert.match(sourceByPath.get(path)!, /requireMutationOrigin/);
  }
});

test('intervention mutations enforce revision preconditions', () => {
  const revisionSensitive = ['/api/interventions/[id]/take-control', '/api/interventions/[id]/resolve'];
  const missing = revisionSensitive.filter(path => !sourceByPath.get(path)?.includes('If-Match'));
  assert.deepEqual(missing, [], `revision-sensitive handlers do not enforce If-Match:\n${missing.join('\n')}`);
});

test('sensitive JSON and export responses disable caching', () => {
  const checked = ['/api/exports', '/api/exports/[...key]', '/api/interventions', '/api/interventions/[id]'];
  const missing = checked.filter(path => !sourceByPath.get(path)?.includes('private, no-store'));
  assert.deepEqual(missing, [], `sensitive responses missing no-store policy:\n${missing.join('\n')}`);
});

test('destructive delete handlers are not exposed', () => {
  const deletes = files.filter(file => /export async function DELETE/.test(readFileSync(file, 'utf8'))).map(routePath);
  assert.deepEqual(deletes, [], `domain resources should be disabled or cancelled instead of deleted:\n${deletes.join('\n')}`);
});
