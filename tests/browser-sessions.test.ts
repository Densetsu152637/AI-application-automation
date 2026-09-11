import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  browserSessionStatus,
  beginBrowserShutdown,
  closeBrowserSessions,
  closeSession,
  openUserSession,
  resumeBrowserSessions,
  withSourcePage,
  withUserPage,
  type BrowserSource,
} from '../apps/web-app/lib/browser-sessions.ts';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const profileRoot = mkdtempSync(join(tmpdir(), 'aaa-browser-test-'));
const previousRoot = process.env.PROFILE_ROOT;
process.env.PROFILE_ROOT = profileRoot;
test.beforeEach(() => { resumeBrowserSessions(); });
test.after(() => {
  if (previousRoot === undefined) delete process.env.PROFILE_ROOT; else process.env.PROFILE_ROOT = previousRoot;
  rmSync(profileRoot, { recursive: true, force: true });
});

const source: BrowserSource = {
  id: 'example-source',
  start_url: 'https://93.184.216.34/',
  allowed_origins_json: '["https://93.184.216.34"]',
};

function fakeContext() {
  const page = {
    isClosed: () => false,
    goto: async () => undefined,
  } as any;
  let closed = false;
  const context = {
    pages: () => [page],
    newPage: async () => page,
    setDefaultTimeout: mock.fn(),
    storageState: mock.fn(async () => ({ cookies: [{ name: 'session', value: 'signed-in', domain: '93.184.216.34', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] })),
    addCookies: mock.fn(async () => undefined),
    route: mock.fn(async () => undefined),
    routeWebSocket: mock.fn(async () => undefined),
    on: mock.fn(),
    close: mock.fn(async () => { closed = true; }),
    get closed() { return closed; },
  } as any;
  return { context, page };
}

test.afterEach(async () => {
  await closeBrowserSessions();
  mock.restoreAll();
});

test('user session persists its profile and blocks agents while open', async () => {
  const fake = fakeContext();
  const launch = mock.method(chromium, 'launchPersistentContext', async (dir: string) => {
    assert.equal(dir, join(profileRoot, source.id));
    return fake.context;
  });

  await openUserSession(source);
  assert.deepEqual(browserSessionStatus(source.id), { active: true, owner: 'user', ready: true, busy: false });
  await assert.rejects(() => withSourcePage(source, async () => undefined), /BROWSER_SESSION_BUSY/);
  assert.equal(await withUserPage(source.id, async page => page), fake.page);
  await closeSession(source.id);
  assert.equal(fake.context.closed, true);
  await withSourcePage(source, async page => assert.equal(page, fake.page));
  assert.equal(launch.mock.calls.length, 2);
  assert.equal(fake.context.addCookies.mock.calls[0].arguments[0][0].value, 'signed-in');
});

test('launch failure releases the reservation for a later attempt', async () => {
  const launch = mock.method(chromium, 'launchPersistentContext', async () => { throw new Error('launch failed'); });
  await assert.rejects(() => openUserSession(source), /launch failed/);
  assert.equal(browserSessionStatus(source.id).active, false);
  await assert.rejects(() => withUserPage(source.id, async () => undefined), /BROWSER_SESSION_NOT_OPEN/);
  assert.equal(launch.mock.calls.length, 1);
});

test('closeBrowserSessions closes active contexts and clears status', async () => {
  const fake = fakeContext();
  mock.method(chromium, 'launchPersistentContext', async () => fake.context);
  await openUserSession(source);
  await closeBrowserSessions();
  assert.equal(fake.context.closed, true);
  assert.equal(browserSessionStatus(source.id).active, false);
});

test('shutdown blocks new browser work until explicitly resumed', async () => {
  const fake = fakeContext();
  mock.method(chromium, 'launchPersistentContext', async () => fake.context);
  await closeBrowserSessions();
  await assert.rejects(() => openUserSession(source), /BROWSER_SHUTTING_DOWN/);
  resumeBrowserSessions();
  await openUserSession(source);
  await closeBrowserSessions();
});

test('shutdown waits for a pending browser launch and closes it once', async () => {
  const fake = fakeContext(); let resolveLaunch!: (value: unknown) => void;
  const pending = new Promise(resolve => { resolveLaunch = resolve; });
  mock.method(chromium, 'launchPersistentContext', async () => await pending as any);
  const opening = openUserSession(source);
  await new Promise(resolve => setImmediate(resolve));
  beginBrowserShutdown();
  const stopping = closeBrowserSessions();
  resolveLaunch(fake.context);
  await Promise.race([stopping, new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timeout')), 1000))]);
  await opening;
  assert.equal(fake.context.storageState.mock.calls.length, 1);
  assert.equal(fake.context.close.mock.calls.length, 1);
});

test('shutdown waits for an active user action before closing once', async () => {
  const fake = fakeContext(); let release!: () => void;
  const deferred = new Promise<void>(resolve => { release = resolve; });
  mock.method(chromium, 'launchPersistentContext', async () => fake.context);
  await openUserSession(source);
  const action = withUserPage(source.id, async () => { await deferred; });
  await new Promise(resolve => setImmediate(resolve));
  beginBrowserShutdown(); const stopping = closeBrowserSessions();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fake.context.close.mock.calls.length, 0);
  release(); await action;
  await Promise.race([stopping, new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timeout')), 1000))]);
  assert.equal(fake.context.storageState.mock.calls.length, 1); assert.equal(fake.context.close.mock.calls.length, 1);
});

test('shutdown waits for an active agent action before closing once', async () => {
  const fake = fakeContext(); let release!: () => void;
  const deferred = new Promise<void>(resolve => { release = resolve; });
  mock.method(chromium, 'launchPersistentContext', async () => fake.context);
  const action = withSourcePage(source, async () => { await deferred; });
  await new Promise(resolve => setImmediate(resolve));
  beginBrowserShutdown(); const stopping = closeBrowserSessions();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fake.context.close.mock.calls.length, 0);
  release(); await action;
  await Promise.race([stopping, new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timeout')), 1000))]);
  assert.equal(fake.context.storageState.mock.calls.length, 1); assert.equal(fake.context.close.mock.calls.length, 1);
});
