# AI application automation

A locally hosted TypeScript application foundation for software that discovers jobs,
matches them using a dedicated Unsloth inference service, exports new opportunities, and optionally prepares
and submits applications from confirmed applicant resources.

**Status: development scaffold. Feature implementation and release gates remain open.**

The repository now contains an npm TypeScript workspace, Next.js App Router,
a durable worker, shared Zod contracts, SQLite migration infrastructure, and Docker
Compose with a localhost nginx gateway. See the [development guide](docs/development.md)
for setup, commands, pinned versions, and deliberately bounded features.

```sh
npm ci
npm run setup
docker compose up --build -d --wait
```

Open http://localhost:3000. On Windows PowerShell with script execution disabled,
use `npm.cmd` in place of `npm`. Docker Desktop must run Linux containers.

Start with the [specification index](docs/specification/README.md). It links ten
chapters covering requirements, architecture, written data schemas, browser and
model contracts, recovery, dashboard APIs, and acceptance scenarios.

The intended deployment uses Docker Compose, Next.js, a separate TypeScript
worker, Chromium/Playwright, SQLite, and a separate internal Unsloth inference
service targeting Qwen3.5 9B with 32 Ki active attention tokens. The inference
service is the sole model-serving boundary; it is not exposed through the public
gateway.
Implementation agents should follow the dependency order and release gates in
[chapter 10](docs/specification/10-acceptance-and-handoff.md).
