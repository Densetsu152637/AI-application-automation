# 03 — Deployment and configuration

[Index](README.md) · [Previous](02-architecture.md) · [Next](04-domain-and-persistence.md)

## DEP-001 — Compose services and publication

Compose MUST run an nginx gateway, Next.js web service, and TypeScript worker.
Only gateway port 3000 is published, bound to 127.0.0.1. The gateway routes normal
traffic to web and protected intervention traffic to the worker bridge. Worker
control, VNC, DevTools, and proxy ports MUST not have host mappings. Do not mount
the Docker socket. The deployment MUST use a local Docker volume for SQLite;
network filesystems are unsupported for WAL operation.

[SQLite WAL documentation](https://sqlite.org/wal.html) explains its shared-memory
and same-host constraints. The application will not support multiple hosts
sharing a SQLite database.

## DEP-002 — Browser runtime

The worker MUST run Chromium under a non-root account with its sandbox enabled,
a compatible seccomp profile, an init process, and one GiB of shared memory.
Use a pinned Playwright-compatible Linux image and an identically versioned
Playwright dependency. The application MUST fail browser readiness if its sandbox
cannot start; silently adding no-sandbox or privileged mode is prohibited.

For intervention, run headed Chromium inside Xvfb and provide x11vnc/websockify
with a noVNC viewer through the gateway. Disable remote clipboard and file
transfer. Treat the worker image as an application-hardened image, not an
unmodified test image. Playwright documents non-root and seccomp considerations
for crawling; its stock image is described primarily for testing/development.
[Playwright Docker guidance](https://playwright.dev/docs/docker).

## DEP-003 — Storage layout

The following container locations MUST have these roles. They are deployment
contracts, not files created by this documentation package.

| Location | Mount/access | Contents |
|---|---|---|
| /data | Local named volume; web/worker read-write | SQLite, migrations, durable state |
| /browser-profiles | Named volume; worker only | Dedicated website login profiles |
| /resources | Host bind; worker read-only | User-supplied documents |
| /output | Host bind; worker read-write, web read-only | Exports and retained artifact snapshots |
| /diagnostics | Worker volume; authenticated mediated reads | Expiring screenshots and failure details |
| /tmp | Ephemeral bounded storage | Parsing, temporary downloads, browser scratch |
| /run/secrets | Read-only deployment secrets | Admin secret, optional LM token |

The web service MUST serve artifacts by database ID and verified path, never
arbitrary user-supplied paths. Original resources MUST not be edited or deleted
through the dashboard. Web access to diagnostics is mediated by the worker's
authenticated internal endpoint; the gateway MUST not expose that endpoint.
The web service may call worker GET /internal/artifacts/{id} only after user
authorization, using the separate internal bearer secret. The worker validates
the secret and artifact ID and returns verified bytes or the common redacted
error. No generic file-read or arbitrary proxy endpoint is permitted. The browser
egress rules prevent job pages from reaching this internal service.

## DEP-004 — Configuration schema

Deployment values MUST be validated at startup. Secret file values MUST never be
returned by settings APIs. Runtime-editable settings live as versioned records
in SQLite; environment values below seed them only when no record exists.

| Setting | Type/default | Rule |
|---|---|---|
| APP_ORIGIN | URL; http://localhost:3000 | Exact origin for requests and cookies; localhost publication by default |
| ADMIN_SECRET_FILE | Absolute secret path; required | At least 32 random bytes encoded as text; no compiled default |
| INTERNAL_SECRET_FILE | Absolute secret path; required | Separate 32-byte random service credential shared by web and worker |
| LM_BASE_URL | URL; http://host.docker.internal:1234/v1 | HTTP(S), no userinfo/query/fragment; configured trusted infrastructure |
| LM_MODEL_ID | Nonempty string; setup required | Must appear in model diagnostics; never choose an arbitrary fallback |
| LM_API_KEY_FILE | Absolute secret path or unset | Optional authorization token |
| LM_TIMEOUT_SECONDS | Integer; 120 | 10..600, per request |
| LM_CONTEXT_TOKENS | Integer; 8192 | At least 4096; no greater than verified model capacity |
| LM_OUTPUT_TOKENS | Integer; 2048 | At least 256 and at most half the context budget |
| APP_TIMEZONE | IANA string; UTC until setup confirmation | Browser suggestion must be confirmed |
| DB_BUSY_TIMEOUT_MS | Integer; 5000 | Fixed v1 operational default |
| DIAGNOSTIC_RETENTION_DAYS | Integer; 7 | 1..90 |
| RUN_LOG_RETENTION_DAYS | Integer; 30 | 1..365 |
| RESOURCE_MAX_BYTES | Integer; 20971520 | Twenty MiB per source document |

Browser/inference concurrency is fixed at one in v1. Scan limits, schedules,
source origins, and submission caps are search/policy fields, not global secrets.

## DEP-005 — LM Studio connectivity

LM Studio MUST remain outside the application containers. Docker Desktop users
use host.docker.internal; Linux Compose MUST supply the host-gateway mapping.
The setup guide MUST distinguish container localhost from host localhost and
explain that the LM listener must be reachable on the selected interface without
requiring public exposure. Users may configure another private-network host.
[Docker host networking guidance](https://docs.docker.com/desktop/features/networking/).

Connectivity diagnostics MUST separately report DNS/TCP failure, authentication
failure, missing model, timeout, and invalid structured response. The application
MUST NOT download or change a user's model automatically.

## DEP-006 — Authentication and sessions

The web service MUST verify the deployment secret using a timing-safe digest
comparison and issue a cryptographically random 32-byte session token. Store
only its SHA-256 hash in SQLite. Sessions expire after twelve hours or explicit
logout; rotation of the administrator secret invalidates all existing sessions.
Use an HttpOnly, SameSite=Strict, Path=/ cookie, Secure when APP_ORIGIN is HTTPS.
Plain HTTP is supported only for the default local deployment.

All application APIs, pages containing personal data, downloads, and intervention
connections MUST authenticate. Only login and a content-free liveness endpoint
are anonymous. Login MUST enforce five failures per five-minute window per
source address, with a global fifty-failure ceiling for that window. Mutations
MUST reject absent/mismatched Origin. GET MUST not mutate domain state. API tokens
and public account registration are outside v1.

## DEP-007 — Human-control channel

Opening a browser view MUST create a one-time opaque ticket, stored hashed,
bound to the dashboard session, intervention ID, and browser generation. It
expires after sixty seconds if unused. Gateway authorization MUST consume it
only on the WebSocket upgrade, validate Origin, and reject replay. Do not log
ticket-bearing URLs. The bridge MUST close the connection on logout, session
expiry, browser generation change, or an absolute thirty-minute connection limit.
It MUST revalidate the session at least every thirty seconds.

The worker MUST acknowledge suspension before interactive control is enabled.
Human and agent action streams MUST never own the browser simultaneously. A
disconnected viewer leaves the task paused. A human session may be closed after
fifteen idle minutes; the task persists and a new session can be opened later.

## DEP-008 — Startup and readiness

Web startup MUST acquire the migration lock, apply ordered migrations, and release
it before worker writes are enabled. The worker MUST wait for the expected schema
version. Both services verify storage access; worker also verifies Chromium and
model diagnostics. Missing model configuration degrades worker readiness but
MUST allow setup and history access. Failed schema/storage checks are fatal for
domain writes. Health details MUST be available only to the authenticated user.

## DEP-009 — Logs, retention, and backup

Structured events MUST include timestamp, severity, code, correlation ID, and
relevant entity IDs. MUST NOT log secrets, cookies, ticket URLs, full resumes,
form answer values, or full raw prompts by default. Failure diagnostics may
contain screenshots with personal data and MUST require authenticated access.

Delete unreferenced diagnostics after seven days and detailed run logs after
thirty days by default. Retain compact identity history, assessments, application
events, exports, and submitted artifact snapshots until explicit deletion.
Files referenced by submitted or submission_unknown applications MUST not be
removed by routine cleanup. A missing retained file becomes an integrity error.

Backup MUST stop new work, let ordinary work checkpoint, wait for any submitting
attempt to become submitted or submission_unknown, stop writes, and copy the
database consistently using SQLite backup or a stopped database plus its journal
files. Copy artifact/profile volumes with a manifest and hashes. Restore MUST
check schema and artifacts, invalidate dashboard sessions, and begin with work
paused until the user resumes it. A backup is sensitive local data.

## DEP-010 — Example deployment failures

With LM Studio bound only to an unreachable interface, setup MUST show
MODEL_UNAVAILABLE while history remains readable. With an output mount that is
read-only to the worker, scans MUST not claim export success. With a stale worker
image, readiness MUST report schema/browser incompatibility. A published VNC or
DevTools port is an invalid deployment even if the dashboard login works.

The operator documentation MUST include these failures, fresh setup, model
replacement diagnostics, backup/restore, and safe shutdown. There is no real
deployment command to run until the future application and Compose files exist.
