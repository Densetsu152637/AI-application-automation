# Development foundation

This repository contains the deployment foundation plus working slices of the
dashboard, durable operations, discovery, exports, applications, interventions,
and schedules. The authoritative feature contracts and remaining acceptance
criteria remain in [the specification](specification/README.md).

## Start locally

Use Node 22.14+ (22.x or 24.x), npm 10.9.2, and Docker Compose v2 with Linux containers.

```sh
npm ci
npm run setup
docker compose config --quiet
docker compose up --build -d --wait
```

`setup` creates ignored `.env`, `.secrets/admin.txt`, `.secrets/internal.txt`,
`resources/` and `output/` without replacing existing files. Each credential is
32 cryptographically random bytes encoded as hex. Keep the secret files local.
Compose mounts them read-only; they never enter image build contexts.
On Linux, ensure UID 1000 can read the secret/resource binds and write `output/`.
Named volume directories are initialized with UID 1000 ownership by the images.

Visit http://localhost:3000 for the authenticated dashboard. `/health/live`
returns an empty 204 response and is only a liveness check. The dashboard and
its `/api` routes require the administrator session; health and model diagnostics
still have degraded/unavailable states while services start or are misconfigured.
The Resources panel accepts PDF uploads up to 20 MiB, stores them under the
read-only resource mount, and queues extraction. After indexing, “Ask about me”
queues a bounded local-model question grounded in confirmed facts and extracted
resource segments; image-only PDFs remain unavailable rather than producing
invented facts.

```sh
docker compose logs web worker
docker compose stop
```

Stopping preserves all data. Avoid `down -v` when you want to preserve named volumes.

## Development commands and layout

```sh
npm run dev
npm run typecheck
npm test
npm run build
```

The web development server binds to 127.0.0.1:3000; stop the Compose gateway first
to release that port. The worker command is intended for the Linux container with
the documented mounts and Xvfb. It checks storage and schema compatibility,
claims queued operations, and runs the implemented resource, discovery/export,
model-diagnostic, and application-transition paths. Browser form automation and
validated browser egress remain bounded work. SIGTERM closes the worker.

| Path | Responsibility |
| --- | --- |
| `apps/web-app` | Next.js UI and authenticated `/api` route handlers |
| `services/worker` | Backend durable operation claimant, discovery/export worker, and lifecycle checks |
| `packages/contracts` | Strict runtime validators and derived JSON schemas |
| `packages/domain` | Pure typed domain rules and injected ports |
| `packages/adapters` | Configuration, SQLite, repositories, resources, artifacts, LLM and scheduling adapters |
| `packages/adapters/migrations` | Ordered explicit SQL migrations |
| `infra` | Images, gateway configuration, Chromium seccomp profile |
| `tests` | Migration and boundary validation checks |

Web startup runs migrations under `BEGIN IMMEDIATE` before serving traffic.
Worker startup follows web health and independently checks the expected schema.
Migrations 001 through 016 create the current foundation, discovery, profile,
application, operation-target, event, intervention, API transport, policy,
run-control, and durable opportunity-state tables. Scheduler tables are
provisioned by the scheduler adapter because they are an API-owned contract.
The domain package must not import framework, database, filesystem or environment APIs.

## Deployment boundaries

Only gateway `127.0.0.1:3000` is published. Web and worker share a local SQLite
volume. The web service mounts the resources folder only to perform authenticated
PDF uploads; the worker mounts the same folder read-only for indexing. Only the
worker mounts browser profiles and diagnostics. The
gateway remains a deliberately thin boundary for localhost publication and the
future protected browser-control WebSocket; it is not another application tier.
It enforces a 20 MiB request limit and bounded proxy timeouts; WebSocket upgrade
headers are present for the future intervention bridge, which remains fail-closed.
Resources are read-only; output is writable by worker and read-only by web.
The worker uses non-root UID 1000, an init process, 1 GiB shared memory and the
version-matched seccomp profile. Startup probes Chromium with the sandbox enabled
and reports browser readiness separately if that probe fails. No sandbox bypass or
privileged mode is supplied.

Xvfb, x11vnc, websockify and noVNC are installed. Only Xvfb starts. Before enabling
the bridge, implement DEP-007 tickets/session revocation, exclusive human ownership,
and disable clipboard and file transfer. Before job-site navigation, implement
AGENT-005 validated egress, including private-network and DNS-rebinding rejection.
The worker uses the implemented validated egress boundary for browser-capable
operations; the browser bridge remains disabled until its DEP-007 ownership
controls are enabled.

Compose runs Unsloth as the internal `inference` service, targeting Qwen3.5-9B
with `MAX_MODEL_LEN`/`LLM_CONTEXT_TOKENS=32768` active context tokens. It exposes
`GET /health`, `GET /v1/models`, and `POST /v1/chat/completions` only on a
dedicated internal inference network shared with the worker (the web service is
not attached to this network). The worker uses the internal
`LLM_BASE_URL` (default `http://inference:8000/v1`); the inference service has no
host port or gateway route. Requests are authenticated with the internal service
credential. Provision the exact target weights into the named model cache before
startup; the runtime uses local files only and reports a degraded model state if
the cache is missing or incompatible. Model readiness is separate from dashboard
availability.

The worker is the only application service attached to the dedicated inference
network. The dashboard asks the worker’s authenticated internal health endpoint
for model status, so the web process never connects directly to the model server.
Compose reserves one NVIDIA GPU and exposes memory-limit overrides through
`INFERENCE_MEMORY_LIMIT` and `INFERENCE_MEMORY_RESERVATION`; all four containers
restart unless stopped.

### Why these services remain separate

Do not merge the Next.js web process with the worker: browser automation has a
different egress policy, memory profile, and crash domain, and request handlers
must remain responsive while scans run. Do not merge the worker with inference:
the worker image owns Chromium and browser profiles, while inference owns CUDA,
model memory, and model lifecycle. SQLite is intentionally shared on one host;
adding Redis, a queue, or a network database would add operational cost without
solving a current scaling requirement. nginx is retained only for publication
and the future intervention bridge, not as a business-logic service.

Compose derives the worker-to-inference bearer credential from the existing ignored
internal secret and mounts it read-only into both services. Never place the token
itself in `.env` or an image. Runtime settings versioning, model capacity
verification and authenticated diagnostics remain feature work.

## Version record

Direct npm versions are exact; `package-lock.json` freezes the dependency graph.

| Component | Version |
| --- | --- |
| Node web image | 22.22.0 bookworm-slim |
| nginx | 1.28.0 alpine |
| Next.js | 16.3.4 |
| React / React DOM | 19.2.8 |
| TypeScript | 5.9.3 |
| tsx | 4.23.13 |
| Zod | 4.5.4 |
| better-sqlite3 | 13.0.3 |
| Playwright package / worker image | 1.63.0 / v1.63.0-noble |
| Chromium | 153.0.8010.12, revision 1243 |

The inference image also pins FastAPI 0.115.6, Uvicorn 0.34.0, Torch 2.4.1,
Transformers 4.51.3, and Unsloth 2025.5.7 in
`services/inference/requirements.txt`. Update those versions as one tested CUDA
runtime change; do not use a floating model-serving dependency in production.

Chromium revision comes from the locked `playwright-core/browsers.json`.
Update the npm package, lockfile, worker image, seccomp profile and this record together.
Image tags are versioned; OS package repositories are not snapshot-pinned, so full
bit-for-bit OS rebuild reproducibility remains release work.

The vendored seccomp profile is from
[Playwright v1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json)
(Apache-2.0). Sandbox/image configuration follows the
[Playwright Docker guidance](https://playwright.dev/docs/docker); web setup follows
[Next.js installation guidance](https://nextjs.org/docs/app/getting-started/installation).

## Current implementation status

Implemented and covered by focused tests are the authenticated session, settings,
resource indexing, matching contracts, durable operation claiming, immutable JSON
export listing/download helpers, discovery's bounded source traversal, application
state/approval/submission-uncertainty transitions, intervention/ticket transitions,
and schedule definitions/cursors with one-catch-up semantics.

The worker now runs the persisted schedule ticker, applies validated browser
egress checks, and uses the separate Unsloth inference service for bounded
structured diagnostics and discovery assistance. Form preparation and external
submission remain explicitly review-controlled: preparation stops at
`needs_review`, and ambiguous submission ends at `submission_unknown` pending
user reconciliation. The export metadata/download/retry API is implemented;
full release acceptance coverage remains outstanding. Do not use this implementation against employer forms
or present it as release-ready.

## Implemented HTTP routes

Routes are currently exposed under `/api` (the specification's `/api/v1` is the
target contract namespace). Authenticated groups are:

`/api/auth/login`, `/api/auth/logout`, `/api/health`, `/api/settings`,
`/api/searches`, `/api/sources`, `/api/schedules`, `/api/runs`,
`/api/opportunities`, `/api/operations`, `/api/resources`, `/api/profile`,
`/api/applications`, `/api/interventions`, and `/api/exports`.

Nested routes provide entity reads/updates and the implemented actions for
resource reindexing, application answers/approval/cancellation/submission
reconciliation, intervention takeover/view tickets/resolution, schedule updates,
opportunity dismissal/application linking, fact confirmation/rejection/resolution,
run controls, artifact downloads, and export artifact downloads. See the route handlers under
`apps/web-app/app/api` for the exact method and payload behavior.

## Verification

Verified on 2026-09-08 using Windows with Docker Desktop Linux containers:

- `npm run typecheck`, `npm test`, and `npm run build` passed.
- Both Docker images built with the committed lockfile.
- All four Compose services reached healthy state; worker completed a non-root,
  sandbox-enabled headed Chromium launch under Xvfb.
- Only `127.0.0.1:3000` was published. HTTP checks returned 204 for liveness and
  authenticated dashboard/API checks exercised the implemented route groups.

The gateway has a separate edge network because an internal-only Docker network
does not provide host port publication on the tested Docker version. Application
communication still uses internal frontend/backend networks. Numeric UID 1000 is
explicit throughout; the upstream image's `pwuser` name currently resolves to 1001.
These checks establish local startup and the tested implementation slices only;
they do not establish complete feature acceptance or successful Qwen3.5-9B model
readiness on every GPU/runtime.
