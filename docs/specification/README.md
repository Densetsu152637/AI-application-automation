# Specification index

Version: 1.0. Status: ready for implementation planning. Updated: 2026-09-08.

This package specifies the application; it does not implement it. Examples are
illustrative contracts. There are no runnable services, migrations, generated
schemas, or application tests in this repository yet.

## Reading order

| Chapter | Subject | Requirement prefix |
|---|---|---|
| [01](01-product-and-terminology.md) | Product requirements and terminology | PROD |
| [02](02-architecture.md) | Architecture and dependency boundaries | ARCH |
| [03](03-deployment-and-configuration.md) | Deployment, configuration, access, operations | DEP |
| [04](04-domain-and-persistence.md) | Written domain schemas and persistence | DATA |
| [05](05-discovery-matching-and-identity.md) | Discovery, matching, identity, exports | DISC |
| [06](06-resources-and-profile.md) | Resources, provenance, confirmed facts | RES |
| [07](07-browser-and-model-contracts.md) | Browser actions and model messages | AGENT |
| [08](08-applications-and-recovery.md) | Application states, authorization, recovery | APP |
| [09](09-dashboard-and-api.md) | Dashboard screens and HTTP contracts | API |
| [10](10-acceptance-and-handoff.md) | Acceptance scenarios, traceability, implementation order | QA |

## How to use this package

MUST and MUST NOT identify mandatory behavior. SHOULD identifies the default
that may be changed only by a documented design amendment with replacement
acceptance criteria. MAY identifies an optional capability. Each normative
section has a unique requirement ID; its tables and examples inherit that ID.
Acceptance scenario IDs begin with AT. An acceptance scenario is a specification
for a future test, not a claim that the test currently exists or passes.

Chapter 04 owns persisted field definitions. Chapter 07 owns browser/model wire
contracts. Chapter 08 owns application transitions. Chapter 09 owns HTTP and UI
contracts. Other chapters reference these authorities rather than override them.
An inconsistency must be corrected in the specification before the affected
implementation is considered complete. Schema changes require a specification
version update, migration notes, and corresponding scenario updates.

Examples use reserved example domains and fictional people. Identifiers shown
as UUIDs are illustrative. Enum values, paths, defaults, and error codes are
normative unless expressly marked illustrative.

## Fixed decisions

- One local applicant and one authenticated dashboard user.
- Docker Compose; a Next.js web service and a separate TypeScript worker.
- SQLite operational state and immutable JSON opportunity exports.
- LM Studio outside the containers; no hosted inference fallback.
- One automated browser workflow and one model request at a time.
- Configured source websites; page-structure reasoning, with human intervention.
- Confirmed profile facts; existing resumes unchanged; generated cover letters.
- Manual and scheduled scans; scheduling and automatic submission initially off.
- Newness global across searches; seen, matched, exported, and applied are distinct.
- Localhost gateway publication; public hosting and multiple users deferred.

## Source references

External documents support feasibility, not the application's business rules.
Links were checked during authoring on 2026-09-07. Future implementers must pin
and verify compatible dependencies rather than treating a changing documentation
page as a package lockfile. Sources are cited in the relevant chapters.
