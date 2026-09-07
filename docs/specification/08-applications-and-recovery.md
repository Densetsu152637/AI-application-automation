# 08 — Applications, authorization, and recovery

[Index](README.md) · [Previous](07-browser-and-model-contracts.md) · [Next](09-dashboard-and-api.md)

## APP-001 — Queue eligibility and independence

A user MUST be able to enqueue an already-seen opportunity independently of scans.
Enqueue requires a resolved opportunity, selected search, and no active,
submitted, or submission_unknown attempt blocking the same vacancy. A new or
changed listing MUST receive a current assessment before automatic preparation
continues. Closed vacancies move to closed; uncertainty about closure requests
review instead of treating navigation failure as vacancy closure.

For automatic processing, a new matching opportunity with an enabled applicable
automatic policy MAY be enqueued by its committed discovery event. Export delivery
failure does not lose that event or create another application. Event consumption
and application creation MUST be idempotent. A null or review_required policy
does not enqueue automatic submissions; the dashboard user can enqueue preparation.

## APP-002 — Preparation workflow

Preparation MUST snapshot current search, assessment, profile, policy, and resource
versions, then reopen the listing and application flow. Verify vacancy identity
before entering applicant data. Resolve unknown application origins through
intervention. Inspect every form step, map fields, generate grounded prose, select
approved attachments, validate values, fill, and read back.

Persist prepared answers and attachment snapshots before they are entered into a
website. Record each step's stable field signature, validation messages, and
verified completion. Reinspect on dynamic changes. The signature includes
destination origin/path, relevant job identity, form/field identities, labels,
constraints, options, and declarations; exclude CSRF values and unrelated
timestamps. Changes in relevant semantics invalidate the prepared revision.

Applications have defaults of thirty active minutes, eighty browser actions,
and three no-progress observations per preparation attempt. Reaching a bound
creates needs_input with LIMIT_REACHED, retaining draft data. Human waiting and
scheduled backoff do not count. Repeated retries do not erase the attempt history.

## APP-003 — State transitions

Only the following transitions MUST be permitted. Each transition increments the
mutable row revision and records an event in the same transaction.

| From | Trigger/guard | To |
|---|---|---|
| queued | Worker claim | preparing |
| preparing | Complete validated draft, automatic authority currently eligible | ready |
| preparing | Complete validated draft, user review required | needs_review |
| preparing/ready/needs_review | Missing fact, login, unsupported control, invalidated dependency | needs_input |
| preparing | Uncertain generated content or duplicate relation | needs_review |
| needs_input | User resolves blocker; worker revalidates | preparing |
| needs_review | Valid snapshot-bound approval and no other blockers | ready |
| needs_review | User revises answer or resolves evidence requiring refill | preparing |
| ready | Guard and durable intent transaction succeeds | submitting |
| ready | Automatic authority revoked or quota unavailable | needs_review |
| submitting | Explicit current confirmation | submitted |
| submitting | Possible delivery with absent/ambiguous confirmation | submission_unknown |
| submitting | Explicit proven non-delivery/validation rejection | failed |
| submission_unknown | Verified confirmation or recorded user resolution | submitted or failed |
| queued/preparing/ready/needs_input/needs_review | User cancellation acknowledged before intent | cancelled |
| queued/preparing/ready/needs_input/needs_review | Verified vacancy closure | closed |
| preparing | Nonrecoverable preparation error | failed |

Submitted, cancelled, closed, and failed attempts are terminal records. A permitted
retry creates a new attempt linked to the previous attempt by an audit event.
There is no direct submitted -> queued or submission_unknown -> preparing path.
User input arriving after cancellation does not revive the old attempt.

## APP-004 — Approval and automatic policy guards

Before ready -> submitting, the domain service MUST verify all of:

1. Current vacancy identity and a current match assessment.
2. No unresolved duplicate/repost relationship involving an earlier submission.
3. Complete valid required answers, confirmed relevant facts, and unchanged artifacts.
4. Current destination and form signature match the prepared snapshot.
5. Exclusive opportunity guard and current browser/work fencing generation.
6. No human-owned browser, cancellation request, or unresolved intervention.
7. Either valid current snapshot-bound approval, or an enabled applicable automatic
   policy with eligible search/origin, approved documents, and available quota.

Approval MUST bind to a SHA-256 of a canonical JSON snapshot: application ID,
prepared revision, destination, listing content hash, assessment ID, relevant fact
versions, answer text/values, attachment hashes, form signature, and declarations.
Canonical serialization sorts object keys, preserves array order, and uses UTF-8.
UI-only notes and unrelated profile changes do not affect the snapshot.

A user can approve a valid application explicitly even when automatic quota is
exhausted; this is manual authority and is displayed as such, never silently
substituted by the worker. Unresolved facts or duplicate submission uncertainty
cannot be bypassed by ordinary approval.

## APP-005 — Submission intent and quota

The intent transaction MUST claim the opportunity guard, verify state/revision,
record the immutable SubmissionIntent and authority, reserve an automatic quota
slot if applicable, and enter submitting. No final browser action is allowed
before this commit. Then execute exactly one controller action corresponding to
that intent; the model cannot issue a second final click for it.

Quota is scoped by policy ID and local date in the policy timezone. Count
submitted intents and unresolved reservations; a timeout cannot free quota.
Preserve the original quota date across midnight and DST. Explicitly verified
non-delivery or user resolution of not_submitted can release the reservation.
Policy revision keeps the same policy ID, so changing its cap does not reset usage.

The authority linearization point is intent commit. Cancellation or policy/fact
changes observed before the browser action MUST prevent that action when still
possible. Changes after the action starts cannot undo a remote submission. UI
and API MUST explain this race rather than promise rollback. The intent's
historical answers and authority remain immutable.

## APP-006 — Evidence and uncertainty

Confirmation requires an explicit application receipt, application-specific status,
or an explicit user resolution. A generic thank-you page, HTTP 200, missing form,
or successful click is insufficient unless evidence ties it to this submission.
Store confirmation text, final URL, timestamp, optional receipt number, and a
retained evidence artifact. Model evidence must pass reference checks.

An exception, crash, redirect ambiguity, cancellation after dispatch, or missing
confirmation after a possible final action MUST enter submission_unknown. Do not
retry, enqueue a replacement, or free the opportunity guard automatically. A
restarted worker treats any stale submitting intent as submission_unknown even
if the final click may never have happened.

Automatic resolution may inspect the website's application-specific status without
resubmitting. Otherwise the dashboard requires a user decision of submitted or
not_submitted with a note and available evidence. A user decision remains visibly
user-reported rather than falsely labeled website-confirmed.

## APP-007 — Failures, retry, and cancellation

Transient preparation operations use bounded retries; final submission actions
never use generic retry middleware. Retry is allowed only from a failed attempt
with established non-delivery, a cancelled pre-intent attempt, or a reopened
vacancy, and creates a new attempt. A confirmed submitted opportunity remains
blocked unless identity review proves a genuinely different vacancy.

Cancellation before intent MUST set a durable request, stop further actions at
the next safe boundary, close/release the browser, and preserve the draft history.
Cancellation while submitting is best effort and returns the current state plus
SUBMISSION_IN_FLIGHT; do not report cancelled until non-delivery is established.
Stopping the container does not prove a remote request was not delivered.

## APP-008 — Human input and browser takeover

Missing facts create structured questions referencing the relevant field and
profile key. Unsupported controls, MFA, CAPTCHA, account creation, assessments,
payments, unfamiliar agreements, and unresolved consent create a browser
intervention. Store the required action and known context, excluding secret values.

Human takeover MUST suspend automation before granting control. On return, require
the user to report whether they submitted, did not submit, or are unsure when the
session involved an application form. Submitted/unsure reports trigger evidence
reconciliation before automation resumes. An interrupted human session that could
have submitted is conservatively submission_unknown. No agent final action is
replayed to discover what happened.

Human actions are not all interceptable through remote viewing. Their outcomes
must be recorded as human-originated evidence, not fake pre-recorded agent intents.
Login-only source interventions do not imply an application submission.

## APP-009 — Resume after ordinary interruption

On restart before intent, recover prepared data, create a new browser generation,
reopen the page, verify identity/login/form signature, and refill only after
revalidation. Changes to fields, relevant profile facts, documents, or declarations
invalidate previous approval. Stored DOM element references MUST not be reused.

Existing site drafts may be reused only after comparing their field values to
the prepared snapshot. Differences require refilling or review. A site indicating
already applied triggers evidence reconciliation, not a second application.

## APP-010 — Submission guard and identity merges

The opportunity submission guard MUST be acquired transactionally when an attempt
is created and retained for active, submitted, and unknown attempts. Pre-intent
failed/cancelled attempts may release it. For post-intent failure, release only
after verified non-delivery. The guard retains terminal attempt references for
audit even when a new attempt is permitted.

Before a cross-source merge, check both guards and application histories. If both
have already submitted, preserve both and flag duplicate history. If one is active
and the other submitted/unknown, suspend the active attempt before any further
action. If two pre-intent attempts are active, keep the older and cancel the
newer with an identity-merge reason. Never delete history to satisfy uniqueness.

## APP-011 — Boundary examples

These outcomes MUST hold:

- Known contact fields and approved resume: fill and validate, then await approval
  under the default policy.
- Enabled automatic policy and complete grounded answers: submit without a new
  per-application approval prompt.
- Resume bytes change after approval: needs_input before intent.
- Submit click times out: submission_unknown and no retry.
- Required optional-demographic-style field with no confirmed answer: needs_input.
- User logs out of dashboard while worker scans: scan continues; viewer tickets
  expire and viewer control disconnects.
- Policy is disabled while application is preparing: no automatic final action.

## APP-012 — Application auditing

The review/history representation MUST show selected job/search revision,
criterion outcomes, destination, every answer and source, attachments and hashes,
policy/approval authority, interventions, intent time, and confirmation evidence.
Raw personal answer values belong in authenticated application records, not
general logs. Record state transitions and rejection codes even when no browser
action occurs. Reporting MUST distinguish prepared, submitted, and unknown totals.
