# 07 — Browser and model contracts

[Index](README.md) · [Previous](06-resources-and-profile.md) · [Next](08-applications-and-recovery.md)

## AGENT-001 — Observation envelope

BrowserObservation MUST be an immutable, runtime-validated object:

| Field | Schema |
|---|---|
| schemaVersion | 1 |
| id | UUID |
| generation | integer>=1; browser/session generation |
| capturedAt | Instant |
| tabId, frameId | Opaque IDs assigned by controller |
| url | URL |
| title | String, may be empty |
| segments | [{id: Text, role: heading/body/label/status/link, text: Text}] |
| elements | ObservedElement[] |
| tabs | [{id: Text, url: URL, title: string}] |
| frames | [{id: Text, parentId: Text or null, url: URL, accessible: boolean}] |
| formErrors | [{fieldKey: Text or null, text: Text}] |
| contentHash | Hash of normalized relevant page state |
| truncated | boolean |
| omittedSegmentCount | integer>=0 |

Observations MUST omit script bodies, styling, cookies, hidden password values,
and unrelated hidden DOM content. Browser-injected element IDs must not be
confused with site-supplied text. A page can contain several forms; element
membership and frame identity MUST be preserved. EvidenceRef uses observation
revision=1 because each observation ID is immutable.
Element references, tab IDs, frame IDs, and segment IDs MUST be unique within their
respective observation arrays. References to absent frames or tabs are invalid.

## AGENT-002 — Elements and form description

ObservedElement MUST contain ref: opaque Text, frameId: Text, role: Text,
label: string, kind: link/button/text/textarea/select/radio/checkbox/date/file/
custom, fieldKey: Text or null, formKey: Text or null, required: boolean or null,
disabled: boolean, visible: boolean, currentValue: string/boolean/string[]/null,
options: [{value:Text,label:string,disabled:boolean}], constraints:
{minLength:integer or null,maxLength:integer or null,pattern:Text or null,
min:Text or null,max:Text or null,accept:Text[],multiple:boolean},
href: URL or null, and effect: navigation/edit/continuation/submission/unknown.

Password values MUST always be null and the automation MUST defer credential
entry to the human browser. fieldKey is derived from frame/form membership and
stable attributes/labels, with an occurrence index for repeated fields.
Duplicate ambiguous labels require disambiguation, not the first matching node.
The controller, not the model, assigns effect conservatively from inspected form
semantics. A model suggestion cannot lower an effect from submission to edit.

## AGENT-003 — Action union

Every BrowserAction MUST include schemaVersion=1, observationId: UUID,
actionId: UUID assigned by the controller, kind from the following closed union,
and reason: Text. Parameters MUST match exactly the selected kind.

| kind | Parameters |
|---|---|
| navigate | url: URL |
| click | elementRef: Text |
| fill | elementRef: Text, value: string |
| select | elementRef: Text, values: Text[] |
| check | elementRef: Text, checked: boolean |
| upload | elementRef: Text, artifactIds: UUID[] |
| scroll | elementRef: Text or null, direction: up/down, pages: integer 1..3 |
| wait | milliseconds: integer 100..5000 |
| switch_tab | tabId: Text |
| back | No additional parameters |
| request_intervention | reasonCode: Text, requestedAction: Text |
| finish | outcome: complete/no_results/unsupported, evidence: EvidenceRef[] |

Example valid action payload, excluding controller-assigned envelope:

~~~json
{"kind":"fill","elementRef":"el-17","value":"Software internship","reason":"Set the job-title search field."}
~~~

Invalid actions include kind=execute_script, a CSS selector instead of a current
elementRef, a local filename in upload, or a navigate URL using file:. Validation
MUST reject these before any browser side effect.

## AGENT-004 — Action execution and effects

Before an action the controller MUST check current lease/fence, human ownership,
observation generation, target existence, target effect, allowed destination, and
application authorization if relevant. Validate the live target fingerprint
immediately before execution. A relevant DOM mutation invalidates the observation;
STALE_OBSERVATION triggers reobservation, not blind replay.

Actions return {actionId, status: succeeded/failed/needs_intervention, beforeId,
afterObservationId: UUID or null, error: ErrorDetail or null}. Click success means
only the click executed. Fill success requires value readback and validation.
Use a thirty-second navigation timeout and ten-second ordinary action timeout.
Never expose arbitrary evaluate(), shell, SQL, unrestricted filesystem, or
coordinate clicking as a model tool.

Controls capable of submission or with unknown effect MUST pass the submission
guard or enter intervention. This includes Enter-to-submit, programmatic
continuation controls, and form actions with ambiguous wording. Discovery mode
may submit recognized search forms but MUST NOT submit an application form.
Draft-saving network activity inherent in a website is possible; it MUST be
explained as application preparation, not falsely described as entirely local.

## AGENT-005 — Browser network boundary

Navigation origins MUST be explicitly authorized for the workflow. Public
subresources may load for rendering, subject to infrastructure blocking.
Cross-origin application destinations require policy allowance or a user origin
confirmation; such confirmation alone does not approve submission.

All browser HTTP(S) and WebSocket connections MUST pass through a validating
egress proxy. Resolve hosts at connection time, reject any non-public result, and
connect to an approved resolved address without a second uncontrolled DNS lookup.
Recheck every new connection and redirect. Block loopback, private, link-local,
multicast, unspecified, reserved infrastructure ranges, IPv4-mapped equivalents,
cloud metadata, Docker service names, and the LM host. Disable browser proxy
bypass, QUIC, and direct WebRTC network access. No browser certificate-error bypass.

Playwright request routing MUST additionally enforce workflow origins on
top-level navigation, popup navigation, and form destinations; a URL string check
alone is insufficient for DNS rebinding. Disable service workers in the managed
profile if they prevent request observation. Local fixture access is a separately
built test deployment allowance for exact fixture destinations only; production
configuration MUST reject that test allowance.

## AGENT-006 — Common model request and result

Model requests MUST use the configured local /v1/chat/completions endpoint with
JSON-schema response formatting, stream=false, and temperature=0. This interface
supports structured responses, but the configured model must be checked rather
than assumed capable. [LM Studio structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output).

Internal ModelRequest = {schemaVersion:1, requestId:UUID, contract: enum below,
contractVersion:1, promptVersion:Text, modelConfigHash:Hash, deadline:Instant,
input: typed contract object}. The adapter produces a fixed system instruction,
separately labeled untrusted input, and the generated JSON response schema.

ModelResult = {schemaVersion:1, requestId:UUID, status:ok/needs_review,
output: typed contract object, usage:{inputTokens:integer or null,
outputTokens:integer or null}, modelId:Text}. Transport/parse errors use the common
ErrorDetail and are not fake successful model results. A model cannot set database
IDs, authority, or final workflow state.

## AGENT-007 — Eight task contracts

All fields below MUST be present; null is permitted only where stated. Shared
types refer to chapter 04 and this chapter.

Here, confirmed facts means [{ref:Ref,key:Text,value:FactValue,provenance:
EvidenceRef[],sensitive:boolean}], filtered to currently confirmed versions.
Known-fact summaries use {ref:Ref,key:Text,value:FactValue}. Artifact descriptors
are {artifactId:UUID,kind:resume/cover_letter_text/cover_letter_pdf,mediaType:Text,
sizeBytes:integer,sha256:Hash,displayName:Text}, with no storage path.
Recent action summaries are the last ten {kind:action enum,reason:Text,
status:succeeded/failed/needs_intervention,errorCode:Text or null}.
Form constraints use the constraints object in AGENT-002. Candidate narrative is
{text:Text,claims:Claim[]}; draft mode requires null and verify mode requires it.
Each supporting segment additionally carries sourceRef:{kind:resource/fact,
id:UUID,revision:Revision} so citations cannot be confused across documents.
Arrays are bounded by the context rules in AGENT-009, with at most 200 facts,
100 segments, and 20 artifact descriptors in any one request. Missing writing
instructions are represented by an empty string.

| Contract | Input | Output |
|---|---|---|
| page_action | observation: BrowserObservation; objective: Text; workflow: discovery/application; allowedKinds: enum[]; recentActions: bounded action summaries[] | action: action payload without controller envelope, or null; stopReason: Text or null. Exactly one is non-null |
| job_extraction | observation: BrowserObservation; candidateUrl: URL; sourceRef: Ref | isJob: boolean; job: NormalizedJob or null; sourceJobId: Text or null; applicationUrl: URL or null; employerRequisitionId: Text or null; identityEvidence: EvidenceRef[]; reason: Text |
| relevance | job: NormalizedJob; listingRef: Ref; criteria: Criterion[]; deterministicResults: CriterionResult[] | criteria: CriterionResult[] covering every input criterion exactly once; summary: Text |
| fact_extraction | resourceRef: Ref; segments: Segment[]; knownFactSummaries: bounded confirmed key/value refs[] | proposals: [{key:Text,value:FactValue,evidence:EvidenceRef[]}]; conflicts: [{factRef:Ref,evidence:EvidenceRef[],reason:Text}]; unsupported: Text[] |
| form_mapping | observation: BrowserObservation; factRefsAndValues: confirmed facts[]; approvedArtifacts: artifact descriptors[] | fields: [{fieldKey:Text,elementRef:Text,sourceFactRefs:Ref[],artifactIds:UUID[],answerValue:string/boolean/string[]/null,needsNarrative:boolean,reason:Text}]; missing: [{fieldKey:Text,reason:Text}] |
| narrative_answer | mode: draft/verify; question:Text; constraints: form constraints; facts: confirmed facts[]; supportingSegments: Segment[]; candidate: generated text/claims or null | text:Text; claims:Claim[]; checks:[{claimIndex:integer,outcome:supported/unsupported/uncertain,reason:Text}]; needsInput:Text[] |
| cover_letter | job:NormalizedJob; facts:confirmed facts[]; supportingSegments:Segment[]; instructions:string; maxWords:integer | text:Text; claims:Claim[]; needsInput:Text[] |
| submission_evidence | beforeSummary:Text; afterObservation:BrowserObservation; applicationIdentity:{employer:Text or null,title:Text,applicationUrl:URL}; intentId:UUID | conclusion:submitted/not_submitted/unknown; referenceNumber:Text or null; evidence:EvidenceRef[]; reason:Text |

Cover-letter claims MUST pass narrative_answer verify mode before use. Verification
returns unchanged candidate text plus checks; it must not silently rewrite it.
isJob=false requires job=null; isJob=true requires a complete valid NormalizedJob.
Unavailable evidence produces review/input, not empty successful extraction.

The code computes relevance decisions and submission state from validated outputs
and guards. Submission interpretation alone is insufficient if evidence references
do not contain an explicit confirmation tied to the current application.

Contract examples MUST include these positive and negative cases in addition to
field-level validation:

| Message | Valid output case | Invalid output case |
|---|---|---|
| BrowserObservation | Known frame and current references; password currentValue=null | Password value included or duplicated element reference |
| BrowserAction/result | fill on a current text field followed by verified readback | succeeded response with no readback after the site rejected input |
| ModelRequest/result | Matching request ID, contract version, and typed output | Completion for another request or an unknown output property |
| page_action | Click the current next-results element with a reason | Execute arbitrary JavaScript or set final application state |
| job_extraction | isJob=true with title, evidence, and nullable absent employer | isJob=false with a non-null fabricated job |
| relevance | Exactly one result per configured criterion, supported title pass | Missing a required criterion or invented evidence segment |
| fact_extraction | Proposed employment title cited to a resource paragraph | An assertion that the proposal is already user-confirmed |
| form_mapping | Current email field references a confirmed contact fact | Unapproved artifact ID or a nonexistent field |
| narrative_answer | Candidate text with every factual claim supported; verification preserves text | New unsupported numerical achievement or changed text in verify mode |
| cover_letter | Grounded short letter with claim references | Fabricated company experience or a local file path in prose |
| submission_evidence | Explicit receipt tied to the current job | Generic thank-you text asserted as a verified submission |

## AGENT-008 — Validation and retry budgets

The adapter MUST perform JSON parsing, closed-schema validation, reference
resolution, and task-specific domain validation. Validate that cited quotes occur
in supplied versioned segments, criterion IDs are complete and unique, form fields
exist, and artifact IDs were offered. Do not strip unknown fields and proceed.

After invalid output, permit two repair requests containing validation errors and
the same bounded evidence. Then create MODEL_INVALID_OUTPUT and pause the task.
For a transport failure, permit at most two retries after the original request,
with 2/10-second backoff. A logical task has at most five actual HTTP attempts
across repairs and transport retries; exceeding either relevant budget fails it.
Browser transient failures have their independent DISC-012 budget, not recursive
whole-workflow retries. User-requested retry starts a new audited attempt.

## AGENT-009 — Context budgeting

Reserve configured output tokens plus a 512-token safety margin before selecting
input. Use a verified model tokenizer when available; otherwise estimate each
UTF-8 byte as one token conservatively and expose that method in diagnostics.
Always include system instructions, contract shape, required facts, and relevant
current form constraints. Chunk longer resources/listings by stable segments.
Do not cut JSON or evidence references mid-object.

If required context cannot fit, return MODEL_CONTEXT_LIMIT and request intervention
or a user-configured larger model budget. Truncation flags MUST propagate from
observation to task validation. Omitted required evidence cannot pass a criterion.

## AGENT-010 — Capability diagnostic and model changes

Diagnostics MUST list configured model availability and execute fixed structured
response probes for an enum, a nested object, a nullable field, and constrained
browser-action output. Parse and validate the results. Model unavailability or
failed schema behavior disables dependent automation while preserving the UI.
Changing model ID, context settings, or endpoint requires diagnostic rerun and
invalidates assessment caches using the old configuration hash.

Native tool-calling and vision support are not required. The controller supplies
tools through validated JSON action contracts, so it MUST not depend on a model's
native tool_call message format.

## AGENT-011 — Injection and information boundaries

Prompts MUST label site/resource text as untrusted data. Such text cannot change
policy, select new local files, grant origins, obtain credentials, or create new
tool types. The controller MUST enforce these rules even if a model follows a
malicious instruction. Hidden or visible instructions to reveal system prompts,
upload all files, or navigate to local services are adversarial fixtures.

Only task-relevant confirmed facts and approved artifacts may be offered to form
mapping. Source pages do not gain access to the resource folder merely because
the model can read indexed evidence. No raw browser credentials enter model input.

## AGENT-012 — Browser session recovery

Persist dedicated website profiles across restarts, but never claim live DOM,
in-memory forms, element references, or active viewer tickets survive. Reopening
increments browser generation, invalidates old observations/tickets, and rechecks
login and form progress. Preserve unsaved answers in the prepared application
record so they may be refilled after verification.

An inaccessible frame, unsupported custom field, expired login, or modal that
cannot be classified MUST produce a named intervention with current page context.
No-progress detection applies to model/browser loops as well as source traversal.
