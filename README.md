# AI application automation

A specification for a locally hosted TypeScript application that discovers jobs,
matches them using LM Studio, exports new opportunities, and optionally prepares
and submits applications from confirmed applicant resources.

**Status: specification only. No application has been implemented.**

Start with the [specification index](docs/specification/README.md). It links ten
chapters covering requirements, architecture, written data schemas, browser and
model contracts, recovery, dashboard APIs, and acceptance scenarios.

The intended deployment uses Docker Compose, Next.js, a separate TypeScript
worker, Chromium/Playwright, SQLite, and an external local LM Studio server.
Implementation agents should follow the dependency order and release gates in
[chapter 10](docs/specification/10-acceptance-and-handoff.md).
