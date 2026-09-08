# Development foundation

This scaffold implements the workspace and deployment skeleton from ARCH-009
and DEP-001 through DEP-008. It does **not** complete implementation gates 1 or 2.
The authoritative feature contracts remain in [the specification](specification/README.md).

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

Visit http://localhost:3000 for the scaffold login placeholder. `/health/live`
returns an empty 204 response. These are liveness checks, not feature readiness.
No personal information is served. Domain APIs return 503 at the gateway,
intervention paths return 403, and internal paths return 404.

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
to release that port. Its placeholder requires no LM Studio or database.
The worker command is intended for the Linux container with the documented mounts
and Xvfb. It checks storage, schema compatibility, and a sandboxed headed Chromium
launch, then idles without scheduling or browser navigation. SIGTERM closes it.

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js UI and future Node API handlers |
| `apps/worker` | Independent lifecycle and future durable work execution |
| `packages/contracts` | Strict runtime validators and derived JSON schemas |
| `packages/domain` | Pure typed domain rules and injected ports |
| `packages/adapters` | Configuration, SQLite, future infrastructure adapters |
| `packages/adapters/migrations` | Ordered explicit SQL migrations |
| `infra` | Images, gateway configuration, Chromium seccomp profile |
| `tests` | Migration and boundary validation checks |

Web startup runs migrations under `BEGIN IMMEDIATE` before serving traffic.
Worker startup follows web health and independently checks the expected schema.
Migration 001 creates only the migration ledger. Add domain tables and transaction
tests in gate 1; do not treat this ledger as the complete persistence model.
The domain package must not import framework, database, filesystem or environment APIs.

## Deployment boundaries

Only gateway `127.0.0.1:3000` is published. Web and worker share a local SQLite
volume; only the worker mounts browser profiles, resources and diagnostics.
Resources are read-only; output is writable by worker and read-only by web.
The worker uses non-root UID 1000, an init process, 1 GiB shared memory and the
version-matched seccomp profile. A failed Chromium sandbox launch fails startup.
No sandbox bypass or privileged mode is supplied.

Xvfb, x11vnc, websockify and noVNC are installed. Only Xvfb starts. Before enabling
the bridge, implement DEP-007 tickets/session revocation, exclusive human ownership,
and disable clipboard and file transfer. Before job-site navigation, implement
AGENT-005 validated egress, including private-network and DNS-rebinding rejection.
The current worker network is infrastructure connectivity, not browser egress enforcement.

Set `LM_BASE_URL` and `LM_MODEL_ID` in `.env` when implementing model diagnostics.
LM Studio stays on the host; container `localhost` refers to the container itself.
`host.docker.internal` uses Docker Desktop host addressing and the supplied Linux
`host-gateway` mapping. Configure the LM listener on an interface reachable from
Docker without exposing it publicly. The scaffold does not contact or download a model.
An empty model ID is accepted for future setup and is not model readiness.

For an optional LM token, add a Compose secret backed by an ignored local file,
mount it only on worker, and set worker `LM_API_KEY_FILE` to its absolute mounted
path. Never place the token itself in `.env` or an image. Runtime settings
versioning, model capacity verification and authenticated diagnostics remain feature work.

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

Chromium revision comes from the locked `playwright-core/browsers.json`.
Update the npm package, lockfile, worker image, seccomp profile and this record together.
Image tags are versioned; OS package repositories are not snapshot-pinned, so full
bit-for-bit OS rebuild reproducibility remains release work.

The vendored seccomp profile is from
[Playwright v1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json)
(Apache-2.0). Sandbox/image configuration follows the
[Playwright Docker guidance](https://playwright.dev/docs/docker); web setup follows
[Next.js installation guidance](https://nextjs.org/docs/app/getting-started/installation).

## Remaining implementation

Follow QA-006 in order: domain records, repository ports, identities, leases,
operations and artifact ledgers; then sessions, setup, authenticated readiness and
protected browser takeover. Scheduling, model calls, resource parsing, discovery,
exports, application preparation/submission, retention and backup are not implemented.
Do not use the foundation against employer forms or present it as release-ready.

## Scaffold verification

Verified on 2026-09-08 using Windows with Docker Desktop Linux containers:

- Type checking, all three foundation tests, and Next.js production build passed.
- Both Docker images built with the committed lockfile.
- All three Compose services reached healthy state; worker completed a non-root,
  sandbox-enabled headed Chromium launch under Xvfb.
- Only `127.0.0.1:3000` was published. HTTP checks returned 204 for liveness,
  200 for the placeholder, 403 for intervention, 404 for internal paths, and 503
  for unimplemented domain APIs.

The gateway has a separate edge network because an internal-only Docker network
does not provide host port publication on the tested Docker version. Application
communication still uses internal frontend/backend networks. Numeric UID 1000 is
explicit throughout; the upstream image's `pwuser` name currently resolves to 1001.
These checks establish scaffold startup only, not feature acceptance or LM readiness.
