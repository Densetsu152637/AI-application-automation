# 05 — Discovery, matching, identity, and exports

[Index](README.md) · [Previous](04-domain-and-persistence.md) · [Next](06-resources-and-profile.md)

## DISC-001 — Starting and scheduling runs

Starting a scan MUST atomically snapshot the search/source revisions, create its
run, operation and work item, and claim the search's active-run slot. A disabled
search may be manually run; a source must be enabled to participate. With zero
enabled sources return VALIDATION_FAILED. Overlapping starts return the existing
run for the same idempotency key or ACTIVE_RUN_EXISTS for another command.

Schedules start disabled. Enabling one MUST set nextDueAt=now+interval, not start
an implicit immediate run. After downtime, enqueue at most one catch-up run and
advance nextDueAt to the first future interval boundary. If an active run exists,
skip missed ticks and advance the cursor. Disabling a schedule does not cancel
its active run. Intervals use elapsed UTC time and do not shift with DST.

## DISC-002 — Discovery traversal

For each source the worker MUST open its dedicated browser profile, navigate to
startUrl, inspect available search controls, apply representable criteria, and
collect candidate detail links. Criteria that cannot be expressed in the website's
search remain part of local matching. Failure to find a control is not proof of
zero results.

Visit results in visible site order. Maintain a durable frontier and visited set;
extract each detail page before marking its frontier item complete. Search,
result, and detail pages MUST have distinct checkpoint roles. Follow pagination
and infinite-scroll batches while progress and limits permit. Listing details
opening in a new tab or frame remain within the same source workflow.

A result page count increments for a new results view or a scroll batch that
adds at least one previously unobserved result. A candidate count increments for
a unique listing identity, not a repeated card. Three observations with no new
content, navigation, control-state change, or frontier progress stop with
NO_PROGRESS. An empty-results message is completion evidence; a blank page is not.

## DISC-003 — Limits, source outcomes, and run states

The worker MUST enforce each source's configured page, candidate, and active-time
limits independently. At a limit, retain completed encounters, mark the source
partial with LIMIT_REACHED, and continue other sources. Unknown network/login
conditions must not be recorded as completed. Human waits and Retry-After delays
pause active time; browser/model execution counts toward it.

Run transitions MUST be:

| From | Event | To |
|---|---|---|
| queued | Worker claim | running |
| running | User pause or only remaining source needs intervention | paused |
| paused | Explicit valid resume | running |
| queued/running/paused | Cancel acknowledged | cancelled |
| running | All enabled sources exhausted without errors/limits | completed |
| running | Some progress with failed/limited/unsupported source | partial |
| running | All sources fail before any completed encounter | failed |

An interrupted source MAY be suspended while another source runs after releasing
its browser session. Pending match reviews do not prevent discovery completion;
they are recorded separately. Every terminal run, including failure/cancellation,
MUST finalize a base export (possibly empty) with its actual discoveryStatus.

## DISC-004 — Extraction and evidence

Job extraction MUST distinguish visible job content from navigation, adverts,
related jobs, and page instructions. Preserve stable source IDs and original URLs
when observed. A valid candidate requires a title and a job-specific link; absent
employer or classification values remain null. Candidate extraction failure MUST
be visible in source progress and diagnostic counts, not silently dropped.

Normalize whitespace and Unicode for description hashing, exclude known dynamic
UI chrome, and preserve meaningful requirements. Evidence segments and their
hashes MUST be stable within the extracted revision. Dates are only converted to
absolute UTC when the source supplies sufficient timezone/date context; otherwise
retain the original evidence and use null for the normalized timestamp.

## DISC-005 — Required and preferred matching

The application MUST evaluate known deterministic facts before requesting AI
interpretation. Normalized exact excluded employers and explicit numeric/enumerated
incompatibilities can reject without a model call. Semantic title matching,
responsibilities, and ambiguous statements use the relevance contract.

Title alternatives and location alternatives use any-of semantics. Required skills
use all-of. A hours or salary range wholly inside the desired range passes; a
disjoint range fails; partial overlap is unknown. A missing required bound is
unknown. Salary MUST not be compared across currencies or pay periods using
invented exchange rates or working hours. Such cases require review.

Excluded terms are matched case-insensitively with Unicode word boundaries in job
content. When a phrase appears only as a negation or irrelevant navigation, the
model must explain the context before a semantic exclusion is made.

Final decision MUST be computed by code from all criterion outcomes: any required
fail => reject; otherwise any required unknown/conflict => needs_review;
otherwise match. Preferred outcomes may sort results by pass count then first
seen time, but never override a required outcome. No numeric model confidence
threshold controls submission.

## DISC-006 — Assessment caching and review

An assessment cache key MUST include listing content hash, complete search
revision, matcher version, prompt version, and model configuration hash. Changed
criteria or model behavior MUST invalidate reuse. Cached results still generate
an encounter-specific linkage for run counts and audit.

Review resolution MUST create an immutable replacement assessment and preserve
the previous decision. A user may supply an explicit interpretation with evidence
and a reason, or revise the search. A revised search's matches on previously seen
listings do not create newness. Browser/model failures pending a first assessment
retain the original first-discovery lineage.

## DISC-007 — URL identity

The identity resolver MUST use sourceNamespace+sourceJobId when available, then
URL aliases. URLs normalize lowercase scheme/host and default ports. Preserve
path case, trailing slash, query order, repeated query keys, job-specific query
values, and fragments unless a verified canonical URL explicitly supersedes them.
Remove only case-insensitive utm_* query keys, gclid, and fbclid. Preserve the
original URL separately. Followed redirects add aliases only after verifying
that they point to the same job, not login, search, or generic error pages.

Examples:

- https://jobs.example/role?id=7&utm_source=mail and the same URL without
  utm_source resolve together.
- ?id=7 and ?id=8 MUST remain distinct.
- /app#job/7 and /app#job/8 MUST remain distinct.
- Similar titles and identical employer names alone MUST NOT merge listings.

## DISC-008 — Opportunity association and reposts

Cross-source association MUST require a verified job-specific application URL or
an employer-scoped requisition ID. Generic application portals and requisition IDs
without verified employer scope are insufficient. Employer display-name equality
alone is not verified scope; an observed employer domain or explicit user
confirmation is required. Duplicate relations based only on similarity remain
possible_duplicate or possible_repost.

When an association is confirmed, choose the opportunity with the earliest
first-discovery time as survivor, tie-breaking lexically by UUID. Update current
identity associations transactionally and retain a merged identity redirect;
immutable historical references stay intact as specified in DATA-011. If either has
already been exported, suppress further initial exports; earlier immutable files
remain truthful snapshots of what was known at the time.

If neither identity was exported, preserve the survivor's first-discovery lineage
and novelty state. A new duplicate's matching assessment MUST not promote an
earlier rejected vacancy to new. If either identity has a committed export
membership, treat the survivor as consumed even if file delivery is still pending.

Reposts are new listing identities and may be exported once if matching. Their
relations MUST be included. An unresolved relation to an applied or
submission_unknown opportunity blocks automatic application. A user resolving
distinct must provide a reason; this resolution is auditable.

## DISC-009 — Novelty ledger

The first encounter of an opportunity MUST atomically reserve its first-discovery
lineage before assessment. This reservation remains pending through retries and
needs_review. A decision in another later search cannot steal or consume it.
Listings first discovered in the same originating run can contribute evidence to
that lineage, but only one opportunity membership is emitted.

| Current novelty state | Event | Result |
|---|---|---|
| pending | Original-lineage assessment matches | eligible |
| pending | Original-lineage assessment rejects | ineligible |
| pending | Review/model failure/interruption | pending |
| eligible | Export membership committed | consumed |
| pending/eligible | Merge into already exported opportunity | consumed |
| ineligible/consumed | Later search or description now matches | Unchanged |

An explicitly abandoned unresolved assessment becomes ineligible with a user
reason. Cancelling discovery alone MUST not silently abandon already captured
review cases. A later original-lineage resolution can produce a supplemental
export even when discovery was cancelled. No review resolution may manufacture
a new encounter timestamp.

## DISC-010 — Export transaction and delivery

At scan finalization, one transaction MUST reserve all eligible opportunity
memberships for that run, freeze the ExportDocument, its generation time and
payload hash, and insert the base ExportBatch. The same transaction consumes
their novelty eligibility. Write UTF-8, two-space-indented JSON with a trailing
newline, sorted opportunity members by firstSeenAt then opportunityId.

The writer MUST use exports/<runId>/base.json and
exports/<runId>/supplemental-<sequence>.json as paths relative to the /output mount.
Write a unique temporary file in the same directory,
flush it, atomically rename, and then mark the batch written. If the final file
already exists with the expected byte hash, complete the database state. A
different hash is EXPORT_INTEGRITY_ERROR and MUST NOT be overwritten silently.

The committed payload bytes, not fresh queries against mutable records, are the
source of recovery. Failure before file creation leaves pending/failed export work
for retry. Failure after rename but before marking written is repaired by hash
verification. Read APIs only label an export available when its file is verified.

## DISC-011 — Supplemental exports and edge examples

When first-lineage pending decisions later match, the resolver MUST atomically
create a supplemental batch with the next sequence and baseExportId. Replaying
the same resolution must return the existing assessment/export result. If the
base batch is committed but not written, supplements may be committed but their
writers wait for base delivery. No base file is edited.

Valid behavior: first scan finds two matches and one review; base contains two,
pendingReviewCount=1; later review resolution produces a one-job supplement.
Second scan sees the same three and exports an empty array. Invalid behavior:
second scan repeats the two jobs because their base write initially failed, or
suppresses the third merely because its first model call timed out.

## DISC-012 — Failure classification

Transient navigation timeout or connection reset MUST get at most two retries
after the first attempt, at 2 and 10 seconds unless Retry-After requires longer.
HTTP 429 suspends the source until the permitted retry time. Login, CAPTCHA,
explicit access restrictions, and an unsupported required control create
interventions without automatic bypass retries. Model response repair is governed
separately by AGENT-008 and MUST not multiply these retry budgets.

The run history MUST distinguish no results, no relevant results, only previously
seen results, incomplete discovery, model failure, pending review, and failed
export. A success banner MUST not collapse all empty files into no jobs found.
