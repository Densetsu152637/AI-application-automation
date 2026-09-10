# 10 — Acceptance tests and implementation handoff

[Index](README.md) · [Previous](09-dashboard-and-api.md)

## QA-001 — Test isolation

Future automated tests MUST use controlled fixture websites and a deterministic
fake model service. They MUST NOT submit applications to real employers, load real
website credentials, or read a developer's personal resources. Test resource and
browser volumes must be disposable and separate from production volumes.

Fixture websites MUST cover static and JavaScript-rendered results, pagination,
infinite scroll, separate ATS origins, frames, popups, ordinary and custom forms,
draft autosave, uploads, validation errors, confirmation, unknown submission,
login expiry, access blocks, and adversarial text. Every accepted submission
increments an observable fixture receipt counter.

The fake model MUST validate incoming contract/version and return deterministic
schema-valid outputs, with selectable malformed, delayed, contradictory, and
unsupported-evidence responses. It may reference controller-assigned current
element IDs from input, but MUST not require production selectors to be hardcoded.
Unexpected requests fail the test. Tests use a fake clock and fault-injection
points for database commits, file rename, browser action dispatch, and shutdown.

The fixture-only egress allowance MUST name exact test origins and IPs, be absent
from production builds/configuration, and be tested as rejected by production.
This is an intentional test boundary, not an undocumented localhost bypass.

## QA-002 — Acceptance scenarios and traceability

All following scenarios MUST be implemented before the corresponding release
gate is complete. Requirement lists identify normative sections covered by each
scenario. Repeated coverage is intentional. Parameterized contract cases apply
to every record/message in the cited sections, not only the illustrative JSON.

| Scenario | Given / when | Required observable result | Requirements |
|---|---|---|---|
| AT-001 | Inspect release scope and first-run UI | Current implementation and remaining release work are distinguished; UI exposes one applicant and agreed scope, without cloud/OCR/vision promises | PROD-001, PROD-010, QA-006 |
| AT-002 | Discover a part-time internship with required matching filters | Separate category/arrangement pass, terminology distinguishes listing/opportunity/assessment/application | PROD-002, PROD-003, DATA-002 |
| AT-003 | First scan has matches, rejects, seen matches, and review cases | Matching precedes novelty eligibility; counts and exports preserve distinctions | PROD-004, PROD-008 |
| AT-004 | Start with default settings, then enable automatic policy | Defaults match specification; saved valid authority permits eligible submissions, schedule alone does not | PROD-005, PROD-009 |
| AT-005 | Configure an unverified source and LinkedIn source; encounter a block | Support limitations and known restriction shown; no stealth or CAPTCHA bypass retry | PROD-006, DISC-012 |
| AT-006 | Model asserts a skill unsupported by evidence | Unsupported claim blocks use; confidence is not shown as measured correctness | PROD-007, RES-007 |
| AT-007 | Inspect package imports and service boundaries; close an active HTTP request | Domain has no adapter imports; worker continues; public topology and typed ports match contracts | ARCH-001, ARCH-002, ARCH-003, ARCH-004, ARCH-009 |
| AT-008 | Restart worker with queued work; start a second worker; expire a lease | Work survives; one owner acts; stale fence cannot mutate or dispatch; model calls serialize | ARCH-005, ARCH-006, DATA-004 |
| AT-009 | Edit source/search/profile/policy while work is queued | Runs retain snapshots; revoked current authority still prevents future final action | ARCH-007, DATA-003 |
| AT-010 | Model offline, one source fails, and output writer fails independently | Dashboard available; unrelated results persist; failure does not become success | ARCH-010, PROD-008 |
| AT-011 | Inspect Compose exposure, mounts, user, sandbox, and browser versions | Only localhost gateway published; read-only resources; no Docker socket; sandbox launches under non-root; browser versions match | DEP-001, DEP-002, DEP-003 |
| AT-012 | Seed settings, change runtime settings, restart; enter invalid values | Stored settings win after initialization; all ranges checked; no secret returned; unconfigured model does not block setup | DEP-004, API-008 |
| AT-013 | Exercise inference-service DNS and unreachable endpoint | Compose DNS works; unreachable/auth/missing-model/capacity cases are distinct diagnostics; no model download | DEP-005, DEP-010 |
| AT-014 | Login, fail login repeatedly, expire/rotate/logout session, submit cross-origin mutation | Limits enforced; hashes only in storage; cookie attributes correct; origin rejected; session invalidated | DEP-006, API-001 |
| AT-015 | Request/replay/expire a viewer ticket; disconnect while human owns browser | Only one valid upgrade; agent suspended before control; revocation disconnects; task persists | DEP-007, API-007 |
| AT-016 | Start with failed migration, unwritable DB/output, then missing model | Fatal write barriers for schema/storage; degraded model setup remains usable; accurate health | DEP-008, ARCH-010 |
| AT-017 | Age logs/artifacts, run retention, backup and restore | Referenced submission artifacts remain; logs redact secrets; consistent backup restores paused with sessions invalid | DEP-009, DATA-012 |
| AT-018 | Validate every record with missing fields, nulls, bad enums, extra keys, bad IDs and ranges | Runtime contracts reject invalid examples and accept valid nullable/false/empty distinctions | DATA-001, DATA-002, DATA-003, DATA-004, DATA-005, DATA-006, DATA-007, DATA-008, DATA-009, DATA-010, DATA-012 |
| AT-019 | Two transactions claim the same identity/work/application; DB stays busy | Required uniqueness and fencing hold; bounded busy error; no partial command | DATA-011, ARCH-006 |
| AT-020 | Duplicate scan start, paused active scan, disabled schedule, downtime catch-up, DST boundary | No overlapping search run; one catch-up; interval stable; disable does not cancel active run | DISC-001, DATA-004 |
| AT-021 | Static pagination and JavaScript infinite-scroll fixtures include duplicate cards and popup details | Deterministic frontier completes; unique candidates/pages counted; duplicate cards do not consume candidate budget twice | DISC-002 |
| AT-022 | One source hits each limit, another finishes, a third needs login | Partial/source reasons and durable results preserved; human waits excluded; correct terminal or paused state | DISC-003 |
| AT-023 | Job page contains related jobs, missing employer, ambiguous dates, and dynamic chrome | Correct job extracted with evidence; unknown values null; stable content hash; no fabricated timestamp | DISC-004 |
| AT-024 | Required range is contained, disjoint, overlapping, missing, or incomparable currency/period | Pass/fail/unknown follows specified rules; preferred outcomes never bypass a required failure | DISC-005, DATA-006 |
| AT-025 | Change listing/search/model/prompt versions; manually resolve a review | Cache invalidation correct; immutable prior assessment retained; no newness from edited search | DISC-006 |
| AT-026 | Test tracking keys, repeated query values, fragment job IDs, redirects to login, path case | Tracking aliases merge; job identities preserved; generic redirect not accepted as canonical job | DISC-007 |
| AT-027 | Cross-source copies share a job-specific ATS URL, generic portal, or unscoped requisition | Only verified identities merge; uncertain relations persist; survivor deterministic | DISC-008, DATA-005 |
| AT-028 | First assessment crashes, later search encounters it, first-lineage assessment resolves | Novelty reservation survives; later search cannot steal it; one initial membership | DISC-009 |
| AT-029 | First rejection later matches an edited search; new repost resembles an applied job | Seen match is not new; repost can export with relation, but application is blocked pending resolution | DISC-009, DISC-008, PROD-004 |
| AT-030 | Crash before export write, during temp write, after rename, and after database completion | Same bytes/ID recover; no duplicate novelty; wrong existing hash is integrity error | DISC-010, DATA-010 |
| AT-031 | Base has zero matches or pending review, later review matches, command is replayed | Valid empty base; one immutable supplement; repeated resolution does not repeat job | DISC-011 |
| AT-032 | Index every supported type plus malformed UTF-8, unsupported file, traversal/symlink escape, hidden temp file | Correct per-file state; no root escape; other files continue; unchanged hashes do not create versions | RES-001, DATA-007 |
| AT-033 | Parse scanned/mixed PDF, oversized PDF, DOCX expansion bomb, parser timeout | Explicit unsupported/incomplete/limit result; no execution or fabricated facts | RES-002 |
| AT-034 | Extract profile keys including false sponsorship, histories, and user-entered facts | Typed values valid; proposals require confirmation; manual provenance distinguished | RES-003, RES-004, DATA-007 |
| AT-035 | Change/delete a supporting document or resume after preparation; keep unrelated fact unchanged | Relevant approval invalidated; conflicts/stale facts surfaced; unrelated changes do not invalidate; submitted snapshot retained | RES-005, RES-010 |
| AT-036 | Default resume allowed, one alternative allowed, multiple alternatives, wrong upload format | Deterministic allowed choice; ambiguity/unsupported format requires input; uploaded bytes equal selected snapshot | RES-006 |
| AT-037 | Generate narrative and cover letter with supported and unsupported claims, regenerate after approval | Verification blocks unsupported claim; PDF/text preserved without internal IDs; regeneration invalidates approval | RES-007, RES-010 |
| AT-038 | Optional sensitive field, required sensitive field, absent work authorization, declaration | No inferred answers; approved preference maps only to matching option; intervention for unresolved requirements | RES-008 |
| AT-039 | Long resources exceed context and include upload-all-files instructions | Relevant bounded evidence only; no silent lost facts or arbitrary upload; resource root protected | RES-009, ARCH-008, AGENT-011 |
| AT-040 | Observe frames, repeated labels, passwords, dynamic form changes | Scoped stable references; password omitted; ambiguity/staleness forces reobservation | AGENT-001, AGENT-002 |
| AT-041 | Exercise every allowed action plus script/selector/path/coordinate actions | Valid union dispatches; invalid actions have zero side effects; readback verifies edits | AGENT-003, AGENT-004 |
| AT-042 | Ambiguous next/submit/Enter controls and recognized search form | Application-affecting final/unknown actions guarded; search query submission permitted | AGENT-004 |
| AT-043 | Navigate/redirect/popup/subresource/WS to private IPv4/IPv6, mapped addresses, DNS rebinding, inference host | Browser requests blocked at egress; only the worker adapter can reach inference; fixture allowance absent in production | AGENT-005, ARCH-008, QA-001 |
| AT-044 | Send each of eight model contracts with valid, missing, extra, and wrong evidence fields | Closed schemas and domain validation work; model does not choose authority or final state | AGENT-006, AGENT-007 |
| AT-045 | Combine invalid JSON, repair success/failure, timeouts, and network retries | Two repairs max, two transport retries max, five total HTTP attempts; task pauses with inspectable error | AGENT-008 |
| AT-046 | Required context exceeds budget; tokenizer absent; observation truncated | Conservative accounting; chunking preserves refs; required omission blocks decision | AGENT-009 |
| AT-047 | Model changes or fails enum/nested/null/action probe | Dependent automation disabled until diagnostics pass; cache invalidated; UI usable | AGENT-010 |
| AT-048 | Browser restarts or login expires with saved prepared answers | New generation, invalid old tickets/refs, verified refill, explicit intervention | AGENT-012, APP-009 |
| AT-049 | Enqueue seen opportunity; replay automatic discovery event; vacancy is closed | Independent preparation allowed; only one attempt; verified closure distinguished from network error | APP-001 |
| AT-050 | Multi-step forms include accessible custom controls, uploads, autosave, errors, limits | Exact answers checkpointed, validated and read back; limits preserve draft; no false claim of all-local preparation | APP-002, AGENT-004 |
| AT-051 | Exercise every permitted and forbidden application state edge | Only APP-003 edges accepted; revisions/events atomic; terminal attempts not revived | APP-003, DATA-008 |
| AT-052 | Approve old/current snapshot, revoke policy, alter relevant fact, exhaust quota | Guards reject stale/blocked automatic intent; valid explicit approval is manual authority | APP-004, APP-011 |
| AT-053 | Double-click submission; cross midnight/DST; revise cap; crash after intent | One dispatch per intent; quota reservation persists; policy edit does not reset usage | APP-005 |
| AT-054 | Fixture returns explicit receipt, generic thanks, missing confirmation, or late response | Only tied evidence confirms; unknown remains blocked; receipt counter not incremented by recovery | APP-006, APP-011 |
| AT-055 | Cancel before/after intent; restart before/after dispatch; request retry | Pre-intent stops; possible delivery becomes unknown; retry only after established non-delivery | APP-007, APP-006 |
| AT-056 | Human takes control and submits, does not submit, or disconnects ambiguously | Automation suspended; human-originated outcome reconciled; unknown never blindly replayed | APP-008 |
| AT-057 | Merge opportunities with active, submitted, or unknown attempts | Guards reconcile transactionally; younger pre-intent attempt cancelled; history never erased | APP-010 |
| AT-058 | Inspect prepared, approved, submitted, and unknown history | Exact artifact/answer revisions and authority visible only when authenticated; aggregate totals distinct | APP-012, DATA-009 |
| AT-059 | Exercise command replay, stale If-Match, pagination/filter cursor mismatch, async operation | Documented status/envelopes and revisions; no duplicate jobs; 202 not displayed as success | API-002, API-012 |
| AT-060 | CRUD searches/sources/policies and execute runs/opportunity resolutions | Exact writable fields/defaults; source revision pinning and immediate disable respected | API-003, API-004 |
| AT-061 | Confirm/reject facts, select artifacts, edit answers, approve/retry/resolve applications | Contracts and preconditions enforced; no filesystem path uploads or bypass of fact confirmation | API-005, API-006 |
| AT-062 | Resolve intervention, download/retry export, inspect settings/health/errors | Exact routes and error catalogue; no secret response; same export identity preserved | API-007, API-008, API-009 |
| AT-063 | Visit every screen in empty/loading/error/partial states; close UI during work | Required accessible controls and explanations; worker independent; no false success banner | API-010, API-011 |
| AT-064 | Validate this documentation package and future generated contracts | Links resolve, IDs unique/covered, examples parse, no unresolved schema placeholders; implementation drift detected | QA-002, QA-005, DATA-012 |
| AT-065 | Evaluate fixed labeled corpus with fake model and a configured real model separately | Reproducible counts/metrics with versions; fixture correctness not mislabeled model accuracy | QA-003, PROD-010 |
| AT-066 | Run local manual demonstration and staged release gates | Docker/model/browser intervention/export/submission demonstrated only against fixture site; results and limitations recorded | QA-004, QA-006 |

## QA-003 — Matching and generation evaluation

Maintain a versioned fictional labeled corpus of at least sixty vacancies: twenty
expected matches, twenty rejects, and twenty needs_review cases. Include equivalent
titles, part-time internships, missing hours, currency/period ambiguity, contradictory
requirements, seniority differences, excluded terms in context, and duplicates.
Keep identity evaluation separate from relevance labels.

For a configured real model, MUST report a three-class confusion matrix, match
precision (correct predicted matches / all predicted matches), match recall
(correct predicted matches / labeled matches), review rate, invalid-output rate,
median and p95 latency, sample count, model ID/config hash, prompt/matcher versions,
and corpus version. Zero denominators are N/A, never fabricated zero or 100%.

Deterministic fixture rules and supported/unsupported answer cases MUST pass
completely. Real-model numbers are measured release evidence, not guaranteed
accuracy claims. If required-constraint false positives or unsupported factual
claims occur, that configuration MUST fail the automatic-mode release acceptance
gate until corrected and reevaluated. This is a recorded evaluation gate, not a
new runtime report-import feature. A finite corpus passing does not imply universal
website or semantic correctness; record the tested scope.

## QA-004 — Manual local demonstration

The implementation handoff MUST include a repeatable demonstration using fictional
resources and a controlled fixture site:

1. Start the local Compose deployment and confirm only localhost gateway exposure.
2. Log in, confirm timezone, start the Unsloth inference service with the targeted
   Qwen3.5 9B / 32 Ki configuration, and pass model diagnostics.
3. Reindex resources, inspect provenance, confirm facts, and choose a resume.
4. Create a search with required title and part-time internship criteria.
5. Run discovery; inspect match/reject/review/seen outcomes and the immutable export.
6. Run again; verify no duplicate opportunity export.
7. Resolve a pending first-lineage assessment; inspect the supplemental export.
8. Prepare an application; use the browser view for fixture login or custom input.
9. Review exact answers/attachments, approve, and confirm one fixture receipt.
10. Enable a narrowly configured automatic policy and demonstrate a second eligible
    fixture application without per-application approval.
11. Inject a missing-confirmation outcome; verify unknown state blocks retry.
12. Restart, back up, and restore; verify history/artifacts survive and work resumes
    only after explicit restore acknowledgement.

The demonstration report MUST identify environment, versions, pass/fail outcomes,
artifact locations, and unsupported behavior. It MUST not use real employer forms.

## QA-005 — Documentation and contract consistency

Before handing off this specification, MUST check all local Markdown links, unique
requirement definitions, requirement references, acceptance coverage, and JSON
example syntax. No application tests are claimed by these checks.

During implementation, every written schema MUST have a corresponding runtime
validator and representative valid/invalid fixtures. Public DTOs and model schemas
must derive from shared contract definitions. Changing an enum, field, transition,
default, or error code requires updating its authoritative chapter and affected
tests in the same change. A requirement cannot be removed merely to make a failing
implementation appear complete.

## QA-006 — Implementation order and completion gates

Remaining implementation and release hardening MUST proceed through these gates,
preserving a usable increment at each stage. No gate authorizes real employer
submissions in tests.

| Gate | Deliverable | Exit evidence |
|---|---|---|
| 1: contracts and persistence | Workspace, typed schemas, SQLite migrations, identities, leases, operations, artifact/export ledger | Contract cases, transaction/fencing tests, upgrade and export recovery fixtures |
| 2: deployment and dashboard foundation | Compose, gateway, sessions, health, setup, worker lifecycle, protected browser | Local isolation/auth/readiness and browser takeover scenarios |
| 3: discovery and export | Source traversal, matching, caching, novelty, base/supplemental exports, schedules | All discovery/identity/export fixtures and labeled matching report |
| 4: resources and preparation | Parsers, confirmed profile, provenance, drafts, grounded prose/PDF, form mapping | Resource adversarial cases and complete fixture preparation without final submission |
| 5: review and submission recovery | Snapshot approval, opportunity guard, intent, evidence, unknown-state reconciliation | State-edge, double-submit, crash, cancellation, and human takeover fixtures |
| 6: configurable automation and release | Policies/quotas, diagnostics/retention/backup, completed dashboard, operator guide | All AT scenarios, local manual report, documented limitations and reproducible pinned build |

Application implementation is complete only when all mandatory scenarios pass,
the manual exercise is recorded, and no mandatory behavior remains a stub. This
documentation task is complete when all ten chapters exist and its documentation
checks pass; it does not require that every release-gate behavior already be
complete.
