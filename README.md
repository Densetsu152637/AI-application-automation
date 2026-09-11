# AI application automation

A local Next.js application for job discovery, applicant resources, and reviewed
application workflows. Next.js owns the API, scheduler, operation queue and
Playwright browsers in one long-running Node.js process. The GPU inference service
remains separate and loads its model on demand.

```sh
npm ci
npm run setup
docker compose build
```

When GPU memory is available, start the deployment with `docker compose up -d --wait`.
Open http://localhost:3000. Compose contains only `web` and `inference`; web binds
port 3000 to loopback. Run one web instance against the data/profile volumes.
Existing database, resource and output volumes are retained; startup migrates the
schema automatically. Admin login is removed. Same-origin mutation checks remain;
`APP_ORIGIN` must match the URL used to open the dashboard. The internal secret now
protects inference only. Old admin secret files are no longer used.

To scrape while signed in to a website:

1. Add a source on the dashboard. Set its start URL to the job results page you want
   scanned, and enable it.
2. If sign-in redirects to another website, add that website's origin under
   **Allowed website and login origins**, then save.
3. Choose **Sign in / manage browser**, then **Open browser**. Click the website
   image to focus a field; use **Send text**, Tab and Enter to complete sign-in,
   including any manual verification the website requires.
4. Choose **Save session and release to agent**, then queue a discovery scan.
   The agent reuses that source's profile, local storage and saved cookies,
   including session cookies. To log out, reopen the source browser, log out on
   the website, and save/release again.

Browser profiles are isolated per source and persist in the `browser-profiles`
volume. An open user session prevents automation from using that source; scans
report `BROWSER_SESSION_BUSY` until it is released. Idle user sessions save and
close after 15 minutes. Source settings cannot change while its browser is open.
Credentials are entered directly into the website and are not sent to inference.

Discovery waits for rendered job content, prefers structured `JobPosting` data,
and falls back to filtered job links. It deduplicates URLs before applying the
100-listing limit per source, refreshes listing metadata, and reports failed HTTP,
login-required and empty/unsupported pages. It scans the configured page; automatic
pagination and site-specific form/submission automation are not implemented.
Some websites may refuse automated browsers even after manual sign-in. Pause and
cancel take effect at source boundaries; resume rechecks sources within the same
run and deduplicates persisted results. Interrupted active jobs are marked failed
on server restart, so they can be retried explicitly.

CPU-only verification (no containers or inference required):

```sh
npm run typecheck
npm test
npm run build
node scripts/smoke-web.mjs
node scripts/dashboard-qa.mjs
docker compose config --quiet
docker compose build web
```

On Windows PowerShell with script execution disabled, use `npm.cmd`. Native
Next.js development also needs Playwright Chromium (`npx playwright install chromium`)
and the native Chrome channel for dashboard QA (`channel: 'chrome'`; Chrome must be installed)
and writable absolute `DB_PATH`, `PROFILE_ROOT`, `RESOURCE_ROOT`, `OUTPUT_ROOT` and
`DIAGNOSTIC_ROOT` environment paths. Set `INTERNAL_SECRET_FILE` to the generated
internal secret and `LLM_BASE_URL` to the inference endpoint before running `npm run dev`.

The older specification chapters describe a separate worker and admin login;
these operational instructions supersede that deployment model. Legacy session
tables and auth endpoints remain for database/API compatibility but do not gate
local access.
