# 06 — Resources and applicant facts

[Index](README.md) · [Previous](05-discovery-matching-and-identity.md) · [Next](07-browser-and-model-contracts.md)

## RES-001 — Resource ingestion

The worker MUST index the configured read-only resource root on explicit reindex
and before preparing an application if its last index is older than five minutes.
An initial setup reindex is explicit. Detect additions, removals, and byte changes
by normalized relative path plus content hash; a timestamp change alone is not a
new version. Identical bytes at multiple paths may share storage but remain
separate resource identities.

Supported source formats are UTF-8 .txt, .md, .json, text-based .pdf, and .docx.
Validate extension, media signature where applicable, UTF-8 validity, and size.
Unknown types MUST report unsupported without stopping other files. Read failures
MUST be per-document errors. Indexing MUST not follow symlinks outside the resource
root or accept path traversal. Hidden files and temporary files beginning with
~ or ending in .tmp MUST be ignored and counted as ignored.

## RES-002 — Extraction limits and provenance

Use non-executing parsers; never run document macros, scripts, external links,
embedded objects, or remote templates. Limit source files to twenty MiB, DOCX
expanded content to one hundred MiB, PDF pages to five hundred, extraction time
to thirty seconds per file, and extracted text to one million characters.
Exceeding a limit produces RESOURCE_LIMIT, not a silently truncated confirmed fact.

Preserve source locators as paragraph numbers for text/Markdown/DOCX, JSON pointers
for JSON, and page plus block numbers for PDF. Extracted text segments MUST have
stable IDs scoped to the resource version. An image-only PDF produces
RESOURCE_OCR_UNSUPPORTED; mixed image/text PDFs may extract usable text but MUST
report incomplete extraction and prevent treating missing image text as known.

## RES-003 — Profile keys and values

The confirmed profile MUST support the following key families. Empty optional
answers are omitted facts, not confirmed empty strings.

| Key pattern | Value type and validation |
|---|---|
| identity.full_name, identity.preferred_name | text |
| contact.email | text; valid email syntax |
| contact.phone | text; preserve user formatting, no invented country code |
| contact.address.* | text; street, locality, region, postal_code, country |
| links.website, links.portfolio, links.linkedin | text; HTTP(S) URL |
| employment.<entryId>.* | employer/title/location/description: text; start/end: date; current: boolean |
| education.<entryId>.* | institution/qualification/field: text; start/end: date; completed: boolean |
| skills.<skillId>.name | text; confirmed skill, no proficiency inference |
| availability.start_date | date |
| availability.notice | text |
| availability.weekly_hours | number; unit=hours_per_week; 0..168 |
| preferences.location | text_list |
| preferences.work_mode | text_list; remote/hybrid/on_site |
| compensation.expectation | number; unit=<ISO currency>/<hour/week/month/year> |
| authorization.<country>.work_authorized | boolean |
| authorization.<country>.needs_sponsorship | boolean |
| reusable.<answerId> | text; associated question stored as a separate text fact |
| sensitive.<questionId>.answer | text/boolean/text_list, exact user-confirmed choice |
| sensitive.<questionId>.behavior | text; answer/leave_blank/prefer_not_to_say |
| supporting.<exampleId> | text; user-confirmed narrative example with source evidence |

Entry and answer IDs MUST be stable UUIDs. The recognized address suffixes are
the ones listed above. Country in authorization keys is ISO-3166 alpha-2.
Unrecognized structured fields become proposed reusable facts for user review,
not new executable schema extensions.

## RES-004 — Confirmation and authority

Extraction MUST produce proposed facts. Only an explicit user confirmation command
can make them confirmed. Manually entered facts are confirmed by the save action,
with actor and timestamp recorded instead of a fabricated document citation.
The profile MUST distinguish these provenance types in the UI.

Fact transitions are proposed -> confirmed/rejected; confirmed -> superseded,
stale, or conflicted through a new revision; stale/conflicted -> confirmed/rejected
through explicit review. The stored status enum uses a supersedes reference rather
than a superseded status on immutable past versions. No old version is rewritten.

Confirmed profile facts take precedence over extraction suggestions, but a new
contradiction MUST block the affected answer until reviewed. It MUST not silently
overwrite the profile or be ignored merely because an older value was confirmed.
Irrelevant contradictions must not block every application.

## RES-005 — Document and profile changes

On changed bytes, create a new document version, re-extract, and mark facts whose
only evidence comes from the old version stale. A user may reconfirm the value
as a manual assertion or against the new evidence. Facts with independent current
confirmed support need review only if the changed document contradicts them.

For every unfinished application, recompute dependencies on changed facts,
documents, defaults, and answer preferences. A changed dependency MUST invalidate
its prepared revision and approval. Changes to unrelated facts MUST not cause
unnecessary invalidation. Submitted and submission_unknown attempts retain their
historical snapshots and do not acquire regenerated documents.

If a selected original resume is removed, future preparation MUST request a new
selection. An already submitted retained copy remains available. An approved
retained resume may be reused only while its profile/policy selection remains
current; disappearance of its source MUST be flagged for confirmation first.

## RES-006 — Resource and attachment selection

The user MUST select a default resume before application preparation requiring
one. Alternatives MUST have explicit names and approved artifact references.
Automatic policy selects one allowed resume deterministically: use the default
if approved; otherwise use the sole approved alternative; if multiple alternatives
remain, create needs_input. The model MUST not pick an unapproved resume path.

Resume bytes MUST be copied unchanged into immutable artifacts before upload.
Verify hashes immediately before upload and persist the uploaded artifact
reference. Unsupported site file formats or smaller size limits require user
input; the agent MUST not silently rewrite or compress the resume. Cover-letter
rendering is separate and does not authorize resume changes.

## RES-007 — Narrative answers and cover letters

Narrative generation MUST receive only relevant confirmed facts, approved
supporting examples, the question/job context, and user writing instructions.
It MUST return text plus claim-to-evidence mappings. Deterministic validation
checks references, length, required facts, and forbidden unsupported numeric/date
assertions. A separate verification pass using the same narrative contract in
verify mode checks entailment of each factual claim. Uncertain or unsupported
claims produce needs_review, not an invented replacement fact.

Non-factual connective wording does not need a citation, but application-specific
claims of experience, achievement, skill, availability, or eligibility do.
Model verification is fallible; evaluation requirements in chapter 10 apply.
Evidence annotations remain in the audit/review representation and MUST NOT
appear as internal IDs in submitted prose.

Cover letters MUST be stored as UTF-8 text and a PDF generated from a fixed local
template with escaped text, bundled fonts, and no external assets. Default length
is at most 400 words, further constrained by the site's field/file limits.
Preserve the exact approved text and PDF hash. A regeneration creates a new
artifact and invalidates any approval using the old text.

## RES-008 — Sensitive answers and declarations

Optional demographic, disability, veteran, and similar sensitive questions MUST
remain unanswered unless a confirmed answer behavior exists for that question.
Prefer-not-to-say requires a matching site option; it is not permission to choose
an approximate demographic answer. Required sensitive fields without a supplied
response create needs_input.

Work authorization and sponsorship MUST come from country-specific confirmed
facts. Do not infer them from location, nationality, education, or employment.
Consent, legal declarations, unfamiliar agreements, and signature requirements
are application interventions unless already covered by a specific user-approved
answer and the current wording matches that approval.

## RES-009 — Context selection and access

The worker MUST select relevant facts and text segments by explicit field mapping
and lexical matching, then apply the model context budget. A vector database is
not part of v1. Omitted evidence MUST be reported to the model as unavailable;
truncated prompts MUST not masquerade as the full profile.

Parsing and generation MUST operate on retained version snapshots, not a source
file that can change halfway through inference. Source and artifact access MUST
validate realpaths, prevent traversal, and verify hashes. Resource contents are
untrusted data and cannot authorize actions, change submission policy, or reveal
other files.

## RES-010 — Worked cases

These cases MUST be represented in acceptance fixtures:

- Resume says 2022 start date; confirmed profile says 2023: proposed conflict,
  blocked affected work-history answer, unchanged confirmed value.
- No sponsorship information: required form field produces needs_input.
- PDF contains only scanned images: unsupported, no fabricated extracted facts.
- User confirms a project example: generated answer cites that example and only
  its supported facts; the final answer excludes internal citations.
- Resume changed after approval: approval invalidated before submission.
- Document contains instructions to upload every file: treat as document text,
  reject the instruction, and retain the original upload allowlist.
