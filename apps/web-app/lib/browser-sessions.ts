import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { validateResolvedEgressUrl } from '@aaa/domain';

export type BrowserSource = { id: string; start_url: string; allowed_origins_json: string };
type Session = { context?: BrowserContext; page?: Page; statePath?: string; owner: 'user' | 'agent'; busy: boolean; touched: number; timer?: NodeJS.Timeout; closing?: Promise<void> };
const key = Symbol.for('aaa.browser.sessions');
const globalSessions = globalThis as typeof globalThis & { [key]?: Map<string, Session> };
const sessions = globalSessions[key] ??= new Map<string, Session>();
const idleMs = 15 * 60_000;
let shuttingDown = false;
export function beginBrowserShutdown() { shuttingDown = true; }
export function resumeBrowserSessions() { shuttingDown = false; }

async function saveAndClose(session: Session) {
  if (session.closing) return session.closing;
  session.closing = (async () => {
  try {
    if (session.context && session.statePath) {
      // Explicitly retain session cookies too; Chromium may discard those on a normal restart.
      const state = await session.context.storageState();
      await writeFile(`${session.statePath}.tmp`, JSON.stringify({ cookies: state.cookies }), { mode: 0o600 });
      await rename(`${session.statePath}.tmp`, session.statePath);
    }
  } finally { await session.context?.close(); }
  })();
  return session.closing;
}

export function browserSessionStatus(id: string) {
  const session = sessions.get(id);
  return { active: !!session, owner: session?.owner ?? null, ready: !!session?.page, busy: session?.busy ?? false };
}

function touch(id: string, session: Session) {
  session.touched = Date.now();
  if (session.timer) clearTimeout(session.timer);
  if (session.owner === 'user') {
    session.timer = setTimeout(() => {
      if (session.busy) touch(id, session);
      else void closeSession(id).catch(() => {});
    }, idleMs);
    session.timer.unref();
  }
}

async function createSession(source: BrowserSource, owner: Session['owner']): Promise<Session> {
  if (shuttingDown) throw new Error('BROWSER_SHUTTING_DOWN');
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(source.id)) throw new Error('INVALID_SOURCE_ID');
  if (sessions.has(source.id)) throw new Error('BROWSER_SESSION_BUSY');
  const session: Session = { owner, busy: true, touched: Date.now() };
  sessions.set(source.id, session); // Reserve before launching: Chromium profiles cannot be opened twice.
  try {
    const root = process.env.PROFILE_ROOT ?? '/browser-profiles';
    await mkdir(root, { recursive: true, mode: 0o700 });
    const origins = JSON.parse(source.allowed_origins_json) as string[];
    if (!(await validateResolvedEgressUrl(source.start_url, origins)).allowed) throw new Error('SOURCE_URL_BLOCKED');
    const context = await chromium.launchPersistentContext(join(/* turbopackIgnore: true */ root, source.id), {
      headless: true, chromiumSandbox: true, viewport: { width: 1280, height: 800 },
      serviceWorkers: 'block', acceptDownloads: false,
    });
    session.context = context;
    session.statePath = join(/* turbopackIgnore: true */ root, `${source.id}.cookies.json`);
    try {
      const saved = JSON.parse(await readFile(/* turbopackIgnore: true */ session.statePath, 'utf8')) as { cookies: Parameters<BrowserContext['addCookies']>[0] };
      await context.addCookies(saved.cookies);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('BROWSER_SESSION_STATE_INVALID');
    }
    context.setDefaultTimeout(10_000);
    await context.route('**/*', async route => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        // CDN/API resources may be cross-origin; document navigations stay on the source allowlist.
        const allowed = request.isNavigationRequest() ? origins : [url.origin];
        const decision = await validateResolvedEgressUrl(url.toString(), allowed);
        if (!decision.allowed || url.username || url.password) return await route.abort('blockedbyclient');
        await route.continue();
      } catch { await route.abort('blockedbyclient').catch(() => {}); }
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    session.page = context.pages()[0] ?? await context.newPage();
    // Popups (including SSO) become the visible page, in the same persistent profile.
    context.on('page', page => { session.page = page; });
    context.on('close', () => {
      if (session.timer) clearTimeout(session.timer);
      if (sessions.get(source.id) === session) sessions.delete(source.id);
    });
    session.busy = false;
    touch(source.id, session);
    return session;
  } catch (error) {
    await session.context?.close().catch(() => {});
    sessions.delete(source.id);
    throw error;
  }
}

export async function openUserSession(source: BrowserSource) {
  if (shuttingDown) throw new Error('BROWSER_SHUTTING_DOWN');
  const existing = sessions.get(source.id);
  if (existing) {
    if (existing.owner !== 'user' || existing.busy || !existing.page) throw new Error('BROWSER_SESSION_BUSY');
    touch(source.id, existing);
    return;
  }
  const session = await createSession(source, 'user');
  session.busy = true;
  try { await session.page!.goto(source.start_url, { waitUntil: 'domcontentloaded', timeout: 30_000 }); }
  catch { /* Keep the browser available so the user can correct navigation or sign in. */ }
  finally { session.busy = false; touch(source.id, session); }
}

export async function withUserPage<T>(id: string, fn: (page: Page) => Promise<T>, activity = true): Promise<T> {
  if (shuttingDown) throw new Error('BROWSER_SHUTTING_DOWN');
  const session = sessions.get(id);
  if (!session || session.owner !== 'user' || !session.context) throw new Error('BROWSER_SESSION_NOT_OPEN');
  if (session.busy) throw new Error('BROWSER_SESSION_BUSY');
  const pages = session.context.pages().filter(page => !page.isClosed());
  const page = session.page && !session.page.isClosed() ? session.page : pages[pages.length - 1];
  if (!page) throw new Error('BROWSER_SESSION_NOT_OPEN');
  session.page = page; session.busy = true;
  try { return await fn(page); }
  finally { session.busy = false; if (activity) touch(id, session); }
}

export async function closeSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  if (session.busy || session.owner === 'agent') throw new Error('BROWSER_SESSION_BUSY');
  session.busy = true;
  if (session.timer) clearTimeout(session.timer);
  try { await saveAndClose(session); }
  finally { sessions.delete(id); }
}

export async function withSourcePage<T>(source: BrowserSource, fn: (page: Page) => Promise<T>): Promise<T> {
  const session = await createSession(source, 'agent');
  session.busy = true;
  try { return await fn(session.page!); }
  finally { try { await saveAndClose(session); } finally { sessions.delete(source.id); } }
}

export async function closeBrowserSessions() {
  shuttingDown = true;
  await Promise.allSettled([...sessions.values()].map(async session => {
    if (session.timer) clearTimeout(session.timer);
    while (session.busy && !session.closing) await new Promise(resolve => setTimeout(resolve, 10));
    await saveAndClose(session);
  }));
  sessions.clear();
}
