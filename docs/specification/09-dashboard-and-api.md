# 09 — Dashboard and API behavior

[Index](README.md) · [Previous](08-applications-and-recovery.md) · [Next](10-acceptance-and-handoff.md)

## API-001 — Transport, authentication, and envelopes

The current implementation exposes these handlers under `/api`, including
`/api/searches`, `/api/sources`, `/api/schedules`, `/api/runs`,
`/api/opportunities`, `/api/operations`, `/api/resources`, `/api/profile`,
`/api/applications`, `/api/interventions`, `/api/exports`, `/api/settings`, and
`/api/health`; nested entity/action routes are listed below. The `/api/v1`
prefix in this contract is the intended versioned namespace for the completed
API, so clients should treat the current unversioned prefix as provisional.

All domain endpoints MUST live under /api/v1, use JSON UTF-8, require the
DEP-006 session, and return Cache-Control: private, no-store. Successful JSON
responses have {schemaVersion:1,data:T,requestId:UUID}; list data is
{items:T[],nextCursor:string or null}. Binary artifacts use their validated media
type and Content-Disposition: attachment with a sanitized filename.

Errors MUST be {schemaVersion:1,error:ErrorDetail,requestId:UUID}.
ErrorDetail = {code:Text,message:Text,retryable:boolean,entityId:UUID or null,
details:[{field:string or null,reason:Text}]}. Details MUST not contain secrets,
raw prompts, or resource contents. Unknown JSON fields and malformed IDs produce
400; semantic validation produces 422; unauthenticated 401; origin/access failure
403; missing entity 404; revision/state conflict 409; login rate limit 429;
temporary storage/service unavailability 503. Unexpected errors return a redacted
500 response with a request ID.

Anonymous endpoints are POST /auth/login with {secret:Text} and GET /health/live
with content-free liveness. POST /auth/logout clears the session and viewer
tickets. GET /auth/session returns {authenticated:true,expiresAt:Instant}. All
auth routes still use origin validation for mutations; login alone is exempt
from domain idempotency requirements.

## API-002 — Concurrency, commands, and pagination

Every domain POST MUST require an Idempotency-Key of 16..128 printable ASCII
characters; logout and view-ticket issuance are also exempt. Scope keys by
principal, method, and canonical route. Reusing the key with the same body returns
the original status/body; a different body returns IDEMPOTENCY_CONFLICT.
Persist the response in the command transaction. Retain keys at least thirty days
after completion and indefinitely while their operation is unfinished.

PATCH and revision-sensitive action POSTs MUST require If-Match containing the
quoted current integer revision. Missing preconditions return 428; stale ones
return 409 REVISION_CONFLICT and current revision only. Successful entity reads
and writes return an ETag. Immutable resources do not require edit preconditions.

Long work returns 202 with data={operationId:UUID,target:{kind:Text,id:UUID}}.
Poll GET /operations/{id} for Operation. A 202 response is acceptance, not success.
Sync creations return 201; sync edits/actions return 200. Commands on illegal
states return 409 without enqueueing work.

Lists use limit (default 50, maximum 100) and opaque cursor. Sort immutable results
by createdAt descending then id; opportunities by firstSeenAt descending then id.
Cursor binds the final sort tuple and filter hash. Invalid or filter-mismatched
cursors return 400. Polling reads MUST not mutate seen/exported status.

## API-003 — Search and source endpoints

Writable fields are exactly the chapter 04 configuration fields; IDs, timestamps,
and revisions are assigned by the server. PATCH is partial replacement of named
fields; arrays replace whole arrays, not implicit merges. No DELETE endpoint is
part of v1; disabling preserves references.

| Method and route | Input | Output/behavior |
|---|---|---|
| GET /searches | enabled optional boolean | SearchDefinition list |
| POST /searches | name, criteria, sourceRefs; optional enabled=false, limits=defaults, schedule=defaults, applicationPolicyRef=null | 201 SearchDefinition |
| GET /searches/{id} | revision optional integer | SearchDefinition snapshot |
| PATCH /searches/{id} | Editable SearchDefinition fields, If-Match | New immutable revision and current pointer |
| POST /searches/{id}/validate | Empty object, If-Match | {valid:boolean,issues:ErrorDetail[]} without navigating |
| POST /searches/{id}/runs | Empty object | 202 scan operation |
| GET /sources | enabled optional boolean | SourceConfiguration list |
| POST /sources | name, startUrl, allowedOrigins; optional browserProfileId=new dedicated profile, enabled=true | 201 SourceConfiguration; support note assigned by system |
| GET /sources/{id} | revision optional integer | SourceConfiguration |
| PATCH /sources/{id} | name, startUrl, allowedOrigins, browserProfileId, enabled | New source revision |
| POST /sources/{id}/support-status | {status:user_verified/unverified,note:Text}, If-Match | New revision; cannot remove a system known_restriction note |
| GET /policies | No filters | ApplicationPolicy list |
| POST /policies | name; remaining policy fields with defaults from DATA-003 | 201 ApplicationPolicy |
| PATCH /policies/{id} | Editable policy fields, If-Match | New policy revision |

Updating a source MUST not silently change pinned search references. The UI offers
an explicit search update to the new source revision. Starting a run uses the
search's pinned source revisions; source disablement at its current header is an
immediate stop on future navigation despite historical snapshot enabled=true.

## API-004 — Run and opportunity endpoints

| Method and route | Input | Output/behavior |
|---|---|---|
| GET /runs | searchId, state optional | ScanRun list |
| GET /runs/{id} | None | ScanRun and related operation/export IDs |
| POST /runs/{id}/pause | {}, If-Match | 202 persisted pause request |
| POST /runs/{id}/resume | {}, If-Match | 202 resume; blockers must be resolved |
| POST /runs/{id}/cancel | {}, If-Match | 202 cancellation request |
| GET /runs/{id}/events | cursor, limit | Redacted AuditEvent list |
| GET /opportunities | searchId, decision, noveltyState, applicationState, query optional | OpportunitySummary list |
| GET /opportunities/{id} | None | Opportunity, listings, assessment history, relations, application summaries |
| POST /opportunities/{id}/dismiss | {dismissed:boolean}, If-Match | 200 updated view state; not deletion |
| POST /opportunities/{id}/applications | {searchId:UUID} | 202 preparation operation and application target |
| POST /relations/{id}/resolve | {resolution:confirmed_duplicate/distinct/possible_repost,reason:Text}, If-Match | 200 relation and surviving opportunityId |
| POST /assessments/{id}/resolve | {criteria:CriterionResult[],summary:Text} | 200 replacement assessment and optional exportBatchId |

OpportunitySummary = {id,revision,title,employer,location,listingUrl,firstSeenAt,
noveltyState,latestDecision:match/reject/needs_review/null,possibleRepost:boolean,
applicationState:application enum or null,dismissed:boolean}. Job fields are from
the primary listing and are nullable only as defined in DATA-002.

Query is a case-insensitive text search across title and employer, not an implicit
new model request. The UI MUST distinguish unseen-by-user display badges, if
added later, from the specified global seen ledger. No such display badge changes
novelty eligibility.

## API-005 — Resource and profile endpoints

| Method and route | Input | Output/behavior |
|---|---|---|
| GET /resources | extractionState optional | ResourceDocument summary list without full extracted text |
| GET /resources/{id} | revision optional | Metadata, segments, fact proposals, integrity status |
| POST /resources/reindex | {} | 202 operation |
| GET /profile | revision optional | ApplicantProfile plus referenced facts |
| PATCH /profile | defaultResumeRef, alternativeResumeRefs, narrativeInstructions; If-Match | New profile revision |
| POST /profile/facts | {key,value,sensitive:boolean} | 201 manually confirmed ApplicantFact and new profile revision |
| POST /facts/{id}/confirm | {value:FactValue,reason:Text}, If-Match | New confirmed fact/profile revisions |
| POST /facts/{id}/reject | {reason:Text}, If-Match | New rejected fact/profile revisions |
| POST /facts/{id}/resolve | {value:FactValue,evidence:EvidenceRef[],reason:Text}, If-Match | New confirmed fact/profile revisions |
| GET /artifacts/{id}/download | None | Authenticated verified artifact bytes |

Resource parsing and snapshot creation belong to the worker. Resume selection
requires an existing verified resource artifact; reindex creates resource snapshots
and exposes selectable artifact IDs. The API MUST NOT accept a host filename as
an artifact ID or expose a write/delete endpoint for original files.

## API-006 — Application endpoints

| Method and route | Input | Output/behavior |
|---|---|---|
| GET /applications | state, opportunityId optional | ApplicationAttempt summaries |
| GET /applications/{id} | None | Attempt, prepared answers, attachments, blockers, authority, evidence, history |
| PATCH /applications/{id}/answers | {answers:[{fieldKey,value,sourceFactRefs}]}, If-Match | New prepared revision; review edits require validation/refill |
| POST /applications/{id}/approve | {preparedRevision:Revision,snapshotHash:Hash}, If-Match | 200 ready state or 409 blocker |
| POST /applications/{id}/cancel | {}, If-Match | 202 cancellation; in-flight submission reports conflict/current state |
| POST /applications/{id}/retry | {}, If-Match | 202 new attempt only when APP-007 permits |
| POST /applications/{id}/resolve-submission | {conclusion:submitted/not_submitted,note:Text,evidenceArtifactIds:UUID[]}, If-Match | 200 terminal state with user-reported evidence |

Manual answer edits MUST explicitly identify factual sources or save/confirm the
needed applicant fact first. Approval cannot silently convert arbitrary prose into
confirmed profile facts. An approved application is executed asynchronously by the
worker; the response MUST not claim it has already submitted.

## API-007 — Intervention and export endpoints

| Method and route | Input | Output/behavior |
|---|---|---|
| GET /interventions | state, targetId optional | InterventionTask list |
| GET /interventions/{id} | None | Task, current context, browser availability |
| POST /interventions/{id}/take-control | {}, If-Match | 202 suspension/open-browser operation |
| POST /interventions/{id}/view-ticket | {} | 201 {ticket:Text,expiresAt:Instant,viewerPath:Text}; only after suspension acknowledgement |
| POST /interventions/{id}/resolve | {kind:resolution enum,note:Text}, If-Match | 200 task; actual workflow resume is separate |
| GET /exports | runId, state optional | ExportBatch metadata list, no embedded full payload |
| GET /exports/{id} | None | Metadata and download availability |
| GET /exports/{id}/download | None | Verified immutable JSON document |
| POST /exports/{id}/retry | {}, If-Match | 202 writer operation for same payload, never a new discovery batch |

Resolution supplied_input is valid only after linked profile/input changes exist.
Reopening a browser uses a new generation and ticket. Viewer access is served
through /browser/{interventionId}; its WebSocket upgrade uses DEP-007 checks.
A resolved task does not automatically approve or submit an application.

## API-008 — Settings and diagnostics

GET /settings MUST return {revision,llm:{baseUrl,modelId,timeoutSeconds,contextTokens,
outputTokens,hasApiKey},timezone,retention:{diagnosticDays,runLogDays}}. Secret values
and secret file paths are omitted. PATCH /settings uses If-Match and only these
non-secret editable fields. Base URL changes require a new model diagnostic and
cannot grant browser access to local addresses.

POST /settings/model-test with {} returns 202. GET /health returns component
states for database, worker heartbeat, output storage, browser, and model, each
as {state:ready/degraded/unavailable,checkedAt:Instant,message:Text or null}.
GET /operations/{id} returns durable progress/result or a redacted failure.
Only /health/live is anonymous and contains no configuration or versions.

## API-009 — Error-code catalogue

The following codes MUST be stable public codes, with the described behavior.
Field details distinguish subcases without inventing ad hoc code strings.

| Codes | Handling |
|---|---|
| VALIDATION_FAILED, REVISION_CONFLICT, IDEMPOTENCY_CONFLICT, ACTIVE_RUN_EXISTS | Correct request or refresh current state |
| UNAUTHENTICATED, FORBIDDEN_ORIGIN, ACCESS_DENIED, RATE_LIMITED, NOT_FOUND | Authenticate, correct origin, or respect access/rate limit |
| STORAGE_BUSY, STORAGE_UNAVAILABLE, SCHEMA_INCOMPATIBLE, INTERNAL_ERROR | Retry only when response retryable=true |
| MODEL_UNAVAILABLE, MODEL_AUTH_FAILED, MODEL_NOT_FOUND, MODEL_TIMEOUT, MODEL_INVALID_OUTPUT, MODEL_CONTEXT_LIMIT | Model diagnostic/configuration or bounded retry |
| NAVIGATION_TIMEOUT, STALE_OBSERVATION, NO_PROGRESS, LIMIT_REACHED | Reobserve or partial/intervention outcome |
| LOGIN_REQUIRED, CAPTCHA_REQUIRED, SOURCE_RESTRICTED, UNSUPPORTED_CONTROL, ORIGIN_NOT_ALLOWED | Human/source intervention |
| RESOURCE_UNSUPPORTED, RESOURCE_OCR_UNSUPPORTED, RESOURCE_LIMIT, RESOURCE_INVALID, RESOURCE_MISSING | Correct source document or choose another |
| FACT_MISSING, FACT_CONFLICT, FACT_STALE, ANSWER_UNSUPPORTED, FORM_INVALID | Resolve affected answer or evidence |
| DUPLICATE_APPLICATION, DUPLICATE_UNRESOLVED, QUOTA_EXHAUSTED, APPROVAL_STALE, POLICY_DISABLED | Resolve state or explicit valid manual authority |
| SUBMISSION_IN_FLIGHT, SUBMISSION_UNKNOWN, VACANCY_CLOSED | Preserve outcome and follow application transitions |
| EXPORT_WRITE_FAILED, EXPORT_INTEGRITY_ERROR, ARTIFACT_MISSING, ARTIFACT_INTEGRITY_ERROR | Retry same write or repair storage; never regenerate submitted content |

## API-010 — Screen behavior

The dashboard MUST implement these views. All views must have explicit loading,
empty, failed, and partial states where applicable, keyboard-operable controls,
labels, and actionable errors.

| Screen | Required interaction and state |
|---|---|
| Setup | Login, confirm timezone, configure/test the Unsloth inference service, show resource mount status; incomplete setup blocks dependent actions only |
| Searches | Edit criteria strengths, separate arrangement/category, sources, limits, schedule, and policy; revision conflict preserves unsaved edits |
| Opportunities | Filter new/seen/repost, inspect evidence, dismiss, resolve relations, enqueue; empty labels reflect DISC-012 distinctions |
| Resources/profile | Reindex, inspect source segments, confirm/reject/conflict-resolve facts, choose resumes; unsupported files remain visible |
| Application queue | State and blocker counts; inspect exact answers/artifacts; approve current snapshot; unknown state has reconciliation action |
| Interventions | Reason, structured question, browser control, explicit release/resume; disconnection leaves task paused |
| History/exports | Per-source progress, partial reasons, frozen export downloads, pending/failed writes, retry without duplicate batch |
| Settings/diagnostics | Model availability, health, retention, timezone; never reveal secrets |

Automatic policy enablement MUST clearly describe eligible searches, exact
destinations, documents, and cap. Approval buttons MUST display that submission
is a real external action. These are product controls, not repeated blanket
confirmation prompts after saved automatic authority.

## API-011 — Polling and durable UI state

Poll active run/application/operation data every two seconds while visible.
Back off to ten seconds after three consecutive transport errors and show stale
data with its last update time. Resume the normal interval after success. Idle
lists refresh on navigation and explicit refresh. UI closure does not stop work.

Render state from persisted API responses, not optimistic final-submission
assumptions. Button double-clicks MUST reuse one idempotency key until the response
is known. A stale approval UI MUST refresh the snapshot on conflict rather than
silently approving new answers. The intervention WebSocket is separate from polling.

## API-012 — Examples and negative cases

Illustrative accepted scan-command response:

~~~json
{
  "schemaVersion": 1,
  "data": {
    "operationId": "40000000-0000-4000-8000-000000000001",
    "target": {"kind": "scan", "id": "20000000-0000-4000-8000-000000000001"}
  },
  "requestId": "50000000-0000-4000-8000-000000000001"
}
~~~

Illustrative conflict:

~~~json
{
  "schemaVersion": 1,
  "error": {
    "code": "APPROVAL_STALE",
    "message": "The prepared application changed. Review its current answers.",
    "retryable": false,
    "entityId": "60000000-0000-4000-8000-000000000001",
    "details": []
  },
  "requestId": "50000000-0000-4000-8000-000000000002"
}
~~~

The API MUST reject: automatic policy with an empty destination allowlist; missing
If-Match on profile edits; reused command key with a different search body; approval
for an old prepared revision; artifact download with a relative filesystem path;
anonymous viewer upgrade; state mutation via GET. Examples are not executable
server code. The route handlers named in the implementation note above currently
exist, but their response envelopes and coverage are not yet fully conformant to
every normative requirement in this chapter.
