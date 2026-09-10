# 02 — Architecture and dependency boundaries

[Index](README.md) · [Previous](01-product-and-terminology.md) · [Next](03-deployment-and-configuration.md)

## ARCH-001 — Component topology

The implementation MUST use this topology. Arrows indicate permitted application
interactions, not unrestricted network access.

~~~mermaid
flowchart LR
    U[Authenticated local user] --> G[Gateway]
    G --> W[Next.js web and API]
    G --> V[Protected browser view]
    W --> D[(SQLite)]
    K[TypeScript worker] --> D
    K --> L[Internal Unsloth inference service\nQwen3.5 9B / 32 Ki active tokens]
    K --> B[Chromium / Playwright]
    V --> B
    B --> E[Validated browser egress]
    E --> J[Configured job websites]
    R[Read-only resources] --> K
    K --> O[Exports and artifact snapshots]
~~~

Gateway, web, worker, and inference service MUST be separate Compose services.
The inference service MUST run Unsloth with the pinned Qwen3.5 9B target and a
32 Ki active-token attention budget. It MUST expose only an internal
OpenAI-compatible HTTP interface. The worker service
owns the browser-view bridge, virtual display, and browser egress proxy. These
are internal processes, not additional published services. SQLite is a file on
a shared local volume, not a network database service.

## ARCH-002 — Web boundary

Use the Next.js App Router and Node runtime route handlers. The web service MUST
handle authentication, request validation, read queries, configuration edits,
approvals, and durable command creation. It MUST NOT execute scans, background
inference, browser automation, resource parsing, or scheduling inside request
handlers. Personal pages and APIs MUST use private no-store responses.

Next.js supports self-hosting; long-running worker separation is this project's
design decision, independent of rendering features.
[Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

## ARCH-003 — Domain boundary

Shared domain modules MUST contain typed entities, criterion evaluation rules,
identity decisions, submission guards, state transitions, and command validation.
They MUST depend only on TypeScript contracts and injected ports. They MUST NOT
import Next.js, Playwright, HTTP clients, SQLite drivers, filesystem APIs, or
environment variables. Runtime validation schemas belong in a shared contracts
module; application DTOs MUST not expose database rows directly.

## ARCH-004 — Ports and adapters

The following port operations MUST be specified and implemented with typed inputs,
typed results, cancellation, and the common error contract from chapter 09.

| Port | Operations and ownership |
|---|---|
| Repository | Read snapshots; execute transactional domain commands; claim/renew/release work |
| ModelGateway | Execute one named contract with bounded input, configuration snapshot, and deadline |
| BrowserSession | Observe; execute one validated action; checkpoint; suspend/resume human ownership; close |
| ResourceStore | Index; read immutable version; extract bounded text; retain approved artifact |
| ArtifactStore | Stage; atomically publish; read by ID; verify hash; expire diagnostic artifact |
| Clock | UTC time and monotonic active-duration measurement |
| EventSink | Append redacted correlated events within or following the owning transaction |

Adapters MUST translate vendor and driver failures into domain errors. Browser
objects, SQL handles, and vendor completion envelopes MUST not cross the ports.

## ARCH-005 — Durable execution

The worker MUST claim persisted WorkItem records before acting. Web requests
enqueue commands in the same database transaction as their idempotency record.
No in-memory-only queue or cron timer may be the source of truth. The worker
polls available work every second and schedules due scans every thirty seconds.
One active worker instance is supported. Database leases and fencing still MUST
protect against accidental double startup and stale asynchronous completions.

When user input or approval unblocks waiting work, the resolving transaction MUST
return the existing work item to queued with a fresh availableAt, not create a
second independent workflow. Control commands are acknowledged between browser
actions and do not wait for the global browser lease they are asking to release.

## ARCH-006 — Concurrency and ownership

A global browser lease MUST allow one automated workflow at a time. A human-held
session also holds that browser lease. Parsing and export work MAY proceed while
human input is pending if they do not touch that session. The model adapter MUST
serialize inference calls. Work items use a sixty-second lease, renewed every
ten seconds; every state mutation checks its current fencing generation.

Long model calls MUST not suppress lease heartbeats. Loss of lease MUST abort
pending external operations and prevent further actions. Cancellation during a
possible final submission follows APP-006, not ordinary cancellation.

## ARCH-007 — Revision snapshots

Runs MUST snapshot search and source revisions. Applications MUST snapshot
assessment, policy, profile, relevant resource versions, and prepared form
revision. Domain services MUST revalidate submission authority immediately before
intent creation, including current policy disablement and changed facts. A
snapshot explains previous decisions; it does not preserve revoked authority.

## ARCH-008 — Local data boundaries

Only the worker's model adapter may send prompts to the internal Unsloth inference
service. Job-site browser requests MUST not reach the inference service or other
local infrastructure. Only application-required answers and approved attachments may
leave through job-site forms. Model requests MUST not contain browser cookies,
administrator secrets, or unrelated complete resource libraries. No third-party
analytics or remote error-reporting service is part of v1.

## ARCH-009 — Implementation layout and dependencies

Use a workspace with logical packages for web, worker, contracts, domain, and
adapters. Implement runtime contracts with Zod and emit model JSON schemas from
the same definitions; SQLite access uses a synchronous SQLite driver behind the
repository port and explicit migrations. The domain remains driver-independent.
Use Playwright Chromium and direct HTTP JSON requests to the internal inference
service. The Unsloth service is an intentional microservice boundary; Redis,
additional orchestration, vector databases, and an agent framework are not required.

The first implementation change MUST record exact compatible dependency versions
and a lockfile. This specification intentionally does not freeze changing package
versions before implementation, but the implementation MUST freeze its resolved
versions and the corresponding Chromium revision.

## ARCH-010 — Fault containment

An unavailable model MUST degrade model-dependent tasks without making the
dashboard unavailable. One source failure MUST not discard other results. A
browser crash MUST invalidate observations and unconfirmed form state. An export
failure MUST not undo committed discoveries. A database migration failure MUST
prevent both services from performing domain writes until corrected. Logging
failure MUST not hide a submission-state persistence failure: if submission
intent cannot be committed, the final action MUST not occur.
