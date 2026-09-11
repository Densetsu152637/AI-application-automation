import { randomUUID } from 'node:crypto';
import { normalizeListingUrl } from '@aaa/domain';
import { atomicWriteArtifact, serializeImmutableJson } from '@aaa/adapters/artifacts';
import { openDatabase } from '@aaa/adapters/database';
import { withSourcePage } from './browser-sessions.ts';

export type Source = { id: string; start_url: string; allowed_origins_json: string };
export type Candidate = { href: string; title: string; employer?: string | null; location?: string | null; structured?: boolean };
export type ScrapeDeps = { withSourcePage?: typeof withSourcePage; shouldStop?: () => boolean };

/** Pure, deliberately conservative candidate filtering shared by browser and tests. */
export function selectCandidates(items: Candidate[], allowedOrigins: readonly string[], limit = 100): Candidate[] {
  const seen = new Set<string>(); const result: Candidate[] = [];
  for (const item of items) {
    if (typeof item.title !== 'string' || !item.title.trim() || /^(home|login|sign in|sign up|privacy|terms|contact|about|next|previous|menu|search|jobs|careers|view all jobs|browse jobs)$/i.test(item.title.trim())) continue;
    let url: URL;
    try { url = new URL(item.href); } catch { continue; }
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) || !allowedOrigins.includes(url.origin)) continue;
    const path = `${url.pathname}${url.search}`.toLowerCase();
    if (!item.structured && !/(^|\/)(jobs?|careers?|positions?|vacancies?)\/[^/?]+/.test(path) && !/[?&](job|jobid|job_id|position|vacancy)=/.test(path) && !/\b(job|career|position|vacancy|role|internship|engineer|developer|manager|designer|analyst)\b/i.test(item.title) && !item.employer) continue;
    let canonical: string;
    try { canonical = normalizeListingUrl(url.toString()); } catch { continue; }
    if (seen.has(canonical)) continue;
    seen.add(canonical); result.push({ ...item, href: url.toString(), title: item.title.replace(/\s+/g, ' ').trim() });
    if (result.length >= limit) break;
  }
  return result;
}

export function parseJobPostings(scripts: string[], base: string): Candidate[] {
  const result: Candidate[] = [];
  const walk = (value: unknown, depth = 0): void => {
    if (depth > 20 || result.length >= 500) return;
    if (Array.isArray(value)) { value.forEach(item => walk(item, depth + 1)); return; }
    if (!value || typeof value !== 'object') return;
    const job = value as Record<string, unknown>;
    if (job['@graph']) walk(job['@graph'], depth + 1);
    if (job.itemListElement) walk(job.itemListElement, depth + 1);
    if (job.item) walk(job.item, depth + 1);
    const types = Array.isArray(job['@type']) ? job['@type'] : [job['@type']];
    if (!types.includes('JobPosting') || typeof job.title !== 'string') return;
    try {
      const href = new URL(typeof job.url === 'string' ? job.url : base, base).href;
      const organization = job.hiringOrganization as Record<string, unknown> | undefined;
      const place = (Array.isArray(job.jobLocation) ? job.jobLocation[0] : job.jobLocation) as { address?: Record<string, unknown> } | undefined;
      result.push({ href, title: job.title, employer: typeof organization?.name === 'string' ? organization.name : null, location: typeof place?.address?.addressLocality === 'string' ? place.address.addressLocality : null, structured: true });
    } catch { /* Ignore a malformed record without discarding valid siblings. */ }
  };
  for (const script of scripts) { try { walk(JSON.parse(script)); } catch {} }
  return result;
}

async function extract(page: import('playwright').Page, allowedOrigins: readonly string[]): Promise<Candidate[]> {
  // Wait for likely job content, rather than the static navigation header on a client-rendered site.
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some(node => /"JobPosting"/.test(node.textContent ?? '')) ||
    Array.from(document.querySelectorAll('a[href]')).some(a => /\/(jobs?|careers?|positions?|vacancies?)\/[^/?]+/i.test((a as HTMLAnchorElement).pathname) || /\b(engineer|developer|analyst|manager|designer|internship)\b/i.test(a.textContent ?? '')),
    undefined, { timeout: 5000 }).catch(() => undefined);
  const anchors = await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => ({ href: (node as HTMLAnchorElement).href, title: (node.textContent ?? '').replace(/\s+/g, ' ').trim() })));
  const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
  return selectCandidates([...parseJobPostings(scripts, page.url()), ...anchors], allowedOrigins);
}

export async function discover(db: ReturnType<typeof openDatabase>, operationId: string, deps: ScrapeDeps = {}): Promise<void> {
  const sources = db.prepare("SELECT id,start_url,allowed_origins_json FROM source_configurations WHERE enabled=1 ORDER BY updated_at").all() as Source[];
  const prior = db.prepare("SELECT id,state FROM scan_runs WHERE operation_id=? ORDER BY started_at DESC LIMIT 1").get(operationId) as { id: string; state: string } | undefined;
  const runId = prior?.state === 'paused' || prior?.state === 'running' ? prior.id : randomUUID(); const started = new Date().toISOString();
  if (!prior || runId !== prior.id) db.prepare("INSERT INTO scan_runs (id,operation_id,state,started_at,finished_at,source_count,listing_count,error_code) VALUES (?,?,'running',?,NULL,?,0,NULL)").run(runId, operationId, started, sources.length);
  else db.prepare("UPDATE scan_runs SET state='running',finished_at=NULL,error_code=NULL,revision=revision+1 WHERE id=?").run(runId);
  if (!sources.length) { db.prepare("UPDATE scan_runs SET state='failed',finished_at=?,error_code='VALIDATION_FAILED' WHERE id=?").run(new Date().toISOString(), runId); throw new Error('VALIDATION_FAILED'); }
  let failed = false; let firstError = 'SOURCE_FAILED'; let successfulSources = 0;
  for (const source of sources) {
    if (deps.shouldStop?.()) { db.prepare("UPDATE scan_runs SET state='paused',pause_requested=1,error_code='SERVER_SHUTDOWN',revision=revision+1 WHERE id=?").run(runId); return; }
    const control = db.prepare('SELECT pause_requested,cancel_requested FROM scan_runs WHERE id=?').get(runId) as { pause_requested: number; cancel_requested: number };
    if (control.cancel_requested) { db.prepare("UPDATE scan_runs SET state='cancelled',finished_at=?,revision=revision+1 WHERE id=?").run(new Date().toISOString(), runId); return; }
    if (control.pause_requested) { db.prepare("UPDATE scan_runs SET state='paused',revision=revision+1 WHERE id=?").run(runId); return; }
    try {
      const origins = (JSON.parse(source.allowed_origins_json) as string[]).map(value => new URL(value).origin);
      await (deps.withSourcePage ?? withSourcePage)(source, async page => {
        const response = await page.goto(source.start_url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (!response || response.status() >= 400) throw new Error('SOURCE_HTTP_ERROR');
        if (await page.locator('input[type="password"]:visible').count()) throw new Error('SOURCE_LOGIN_REQUIRED');
        const now = new Date().toISOString();
        const candidates = await extract(page, origins);
        if (await page.locator('input[type="password"]:visible').count()) throw new Error('SOURCE_LOGIN_REQUIRED');
        if (!candidates.length) throw new Error('SOURCE_NO_LISTINGS');
        for (const candidate of candidates) {
          const canonical = normalizeListingUrl(candidate.href);
          db.prepare("INSERT INTO discovered_listings (id,scan_run_id,source_id,canonical_url,original_url,title,employer,location,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,canonical_url) DO UPDATE SET last_seen_at=excluded.last_seen_at,scan_run_id=excluded.scan_run_id,title=excluded.title,employer=excluded.employer,location=excluded.location").run(randomUUID(), runId, source.id, canonical, candidate.href, candidate.title, candidate.employer ?? null, candidate.location ?? null, now, now);
        }
      });
      successfulSources++;
    } catch (error) { failed = true; if (firstError === 'SOURCE_FAILED' && error instanceof Error && /^(SOURCE_[A-Z_]+|BROWSER_SESSION_BUSY)$/.test(error.message)) firstError = error.message; }
    db.prepare('UPDATE scan_runs SET listing_count=(SELECT COUNT(*) FROM discovered_listings WHERE scan_run_id=?),revision=revision+1 WHERE id=?').run(runId, runId);
    const after = db.prepare('SELECT pause_requested,cancel_requested FROM scan_runs WHERE id=?').get(runId) as { pause_requested: number; cancel_requested: number };
    if (after.cancel_requested) { db.prepare("UPDATE scan_runs SET state='cancelled',finished_at=?,revision=revision+1 WHERE id=?").run(new Date().toISOString(), runId); return; }
    if (after.pause_requested) { db.prepare("UPDATE scan_runs SET state='paused',revision=revision+1 WHERE id=?").run(runId); return; }
    if (deps.shouldStop?.()) { db.prepare("UPDATE scan_runs SET state='paused',pause_requested=1,error_code='SERVER_SHUTDOWN',revision=revision+1 WHERE id=?").run(runId); return; }
  }
  const count = (db.prepare('SELECT COUNT(*) AS n FROM discovered_listings WHERE scan_run_id=?').get(runId) as { n: number }).n;
  const state = successfulSources === 0 ? 'failed' : failed ? 'partial' : count ? 'completed' : 'failed'; const finished = new Date().toISOString();
  db.prepare('UPDATE scan_runs SET state=?,finished_at=?,listing_count=?,error_code=?,revision=revision+1 WHERE id=?').run(state, finished, count, state === 'completed' ? null : firstError, runId);
  const root = process.env.OUTPUT_ROOT ?? '/output';
  const listings = db.prepare('SELECT id,source_id,canonical_url,title,employer,location,first_seen_at,last_seen_at FROM discovered_listings WHERE scan_run_id=? ORDER BY first_seen_at').all(runId);
  try { atomicWriteArtifact(root, `exports/${runId}/base.json`, serializeImmutableJson({ schemaVersion: 1, runId, discoveryStatus: state, opportunities: listings })); }
  catch (error) { db.prepare("UPDATE scan_runs SET state='failed',finished_at=?,error_code='EXPORT_FAILED' WHERE id=?").run(new Date().toISOString(), runId); throw error; }
  if (state === 'failed') throw new Error(firstError);
}
