# 01 — Product requirements and terminology

[Index](README.md) · [Next: architecture](02-architecture.md)

## PROD-001 — Outcome and scope

The system MUST let one applicant discover vacancies on configured websites,
assess relevance with local inference, retain seen history, export new matches,
and independently prepare or submit applications. The deliverable described by
The implementation uses TypeScript, Docker Compose, Next.js, a separate worker,
SQLite, and an internal Unsloth inference service targeting Qwen3.5-9B with
32 Ki active attention tokens. The remaining requirements in this package are
the release contract for extending and hardening that implementation.

The initial release MUST NOT include multi-user accounts, public internet
deployment, cloud inference fallback, general web discovery of new job sources,
resume rewriting, OCR, or model-driven screen-coordinate automation. Screenshots
MAY be shown to the human and retained as evidence, but are not model input in v1.

## PROD-002 — Vocabulary

| Term | Meaning |
|---|---|
| Search | Versioned user criteria and associated source configurations |
| Source | A configured entry URL plus allowed navigation origins and browser profile |
| Listing | A particular posting identity on a source website |
| Opportunity | A resolved underlying vacancy associated with one or more listings |
| Observation | A bounded, immutable extraction of one current browser page |
| Assessment | A decision about one listing revision against one search revision |
| Seen | Encountered and recorded, regardless of relevance |
| New | First-discovery eligibility under the global identity rules in chapter 05 |
| Exported | Included in a durable opportunity export, not merely displayed |
| Repost | A new listing identity potentially representing an earlier vacancy |
| Fact | A structured applicant assertion with provenance and confirmation state |
| Prepared application | Versioned answers, attachments, destination, and form signature |
| Submission intent | Durable record authorizing one potentially irreversible final action |
| Intervention | Persisted request for human input or browser control |
| Active time | Worker execution time, excluding human waits and scheduled backoff |

UI labels, data contracts, and tests MUST preserve these distinctions. In
particular, an already-seen opportunity MUST remain manually selectable for
application preparation.

## PROD-003 — Search semantics

Searches MUST distinguish employment arrangement from opportunity category. A
part-time internship is both arrangement=part_time and category=internship.
Each configured criterion MUST carry required or preferred strength. Unknown
source information MUST remain unknown; it MUST NOT be treated as satisfying a
required criterion. At least one title criterion is required for a saved search.
Searches MAY exist disabled without any enabled source.

## PROD-004 — Two-stage result processing

The logical pipeline MUST evaluate relevance first and newness second. Metadata
capture and identity lookup MAY occur before inference for checkpointing and
caching, but MUST NOT substitute seen status for a relevance decision. New
matches MUST be exported with hyperlinks. Rejections, review cases, previously
seen matches, and export failures MUST remain separately visible.

Example: a job rejected yesterday becomes relevant after changing the search.
It appears as a seen match today and can be applied to, but is not a newly
discovered opportunity. An assessment interrupted yesterday is different: its
first-discovery decision remains pending and can still produce a new export.

## PROD-005 — Application authority

Applications MUST be optional and independent of discovery. Default policy is
review_required. A saved automatic policy MUST constitute authority for eligible
future submissions without per-application approval. Neither an enabled schedule
nor a high model score constitutes submission authority. The system MUST explain
which rule or unresolved fact prevents progression.

## PROD-006 — Website coverage

The product MUST describe general browser support as best effort with explicit
unsupported and intervention outcomes. It MUST NOT promise universal coverage,
provide CAPTCHA bypass, or silently add evasion behavior after access blocks.
Source configuration MUST expose a support note: unverified, fixture_verified,
user_verified, or known_restriction. This note does not itself authorize actions.

LinkedIn MUST carry a known_restriction note stating its prohibition on scraping
and automated website activity; it MUST NOT be marketed as a verified native
integration. No built-in LinkedIn-specific implementation is required.
[LinkedIn automation policy](https://www.linkedin.com/help/linkedin/answer/a1340567/automated-activity-on-linkedin?lang=en).

## PROD-007 — Explainability and truthful content

Every relevance decision and generated factual claim MUST reference evidence.
The application MUST distinguish supported facts, preference judgments, unknowns,
and conflicts. It MUST NOT invent qualifications, dates, compensation
expectations, authorization, consent, or demographic responses. A model confidence
number MUST NOT be presented as measured correctness.

## PROD-008 — Success and failure visibility

A scan succeeds when each configured source has a recorded outcome, assessments
are durable, and its base export is written or explicitly awaiting export retry.
Partial discovery and pending review MUST remain visible even when an empty
export is produced. Submission success requires explicit confirmation evidence;
uncertain delivery is submission_unknown, never success or ordinary retryable
failure. Reloading the dashboard MUST not lose these distinctions.

## PROD-009 — Defaults and limits

The following MUST be initial defaults: disabled schedules; six-hour interval
when enabled; review_required submission policy; five automatic submissions per
policy per quota day; ten result pages, one hundred candidates, thirty active
minutes per source; three no-progress observations; one automated browser
workflow; one inference request. A setup screen MUST require a confirmed IANA
timezone, prefilled from the user's browser when valid and UTC otherwise.

## PROD-010 — Specification completion

Implementation agents MUST treat all ten chapters as one contract. The release
MUST satisfy chapter 10's fixture acceptance suite and documented manual exercise.
Passing tests with a fake model MUST NOT be reported as a real-model accuracy
claim. Document any unsupported website behavior and measured evaluation results
alongside the implemented version.
