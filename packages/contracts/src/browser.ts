import { z } from 'zod';

const text = (max = 10_000) => z.string().min(1).max(max);
const nullableText = (max = 10_000) => z.string().max(max).nullable();
const instant = z.iso.datetime({ offset: true });
const boundedInteger = (min: number, max: number) => z.number().int().min(min).max(max);
const opaqueId = text(200);
const httpUrl = z.url().refine(value => { const protocol = new URL(value).protocol; return protocol === 'http:' || protocol === 'https:'; }, 'only HTTP(S) URLs are allowed');

export const browserEffectSchema = z.enum(['navigation', 'edit', 'continuation', 'submission', 'unknown']);
export type BrowserEffect = z.infer<typeof browserEffectSchema>;

export const browserSegmentSchema = z.strictObject({
  id: opaqueId,
  role: z.enum(['heading', 'body', 'label', 'status', 'link']),
  text: z.string().max(20_000),
});

export const observedOptionSchema = z.strictObject({ value: text(2_000), label: z.string().max(2_000), disabled: z.boolean() });
export const observedConstraintsSchema = z.strictObject({
  minLength: boundedInteger(0, 100_000).nullable(),
  maxLength: boundedInteger(0, 100_000).nullable(),
  pattern: nullableText(2_000),
  min: nullableText(200),
  max: nullableText(200),
  accept: z.array(text(200)).max(50),
  multiple: z.boolean(),
});

export const observedElementSchema = z.strictObject({
  ref: opaqueId,
  frameId: opaqueId,
  role: text(200),
  label: z.string().max(2_000),
  kind: z.enum(['link', 'button', 'text', 'textarea', 'select', 'radio', 'checkbox', 'date', 'file', 'custom']),
  fieldKey: nullableText(500),
  formKey: nullableText(500),
  required: z.boolean().nullable(),
  disabled: z.boolean(),
  visible: z.boolean(),
  currentValue: z.union([z.string().max(10_000), z.boolean(), z.array(z.string().max(2_000)).max(100), z.null()]),
  options: z.array(observedOptionSchema).max(500),
  constraints: observedConstraintsSchema,
  href: z.url().nullable(),
  effect: browserEffectSchema,
}).superRefine((element, ctx) => {
  if (/password/i.test(element.role) && element.currentValue !== null) {
    ctx.addIssue({ code: 'custom', path: ['currentValue'], message: 'password values must be omitted' });
  }
});

export const browserObservationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  generation: z.number().int().min(1),
  capturedAt: instant,
  tabId: opaqueId,
  frameId: opaqueId,
  url: z.url(),
  title: z.string().max(2_000),
  segments: z.array(browserSegmentSchema).max(2_000),
  elements: z.array(observedElementSchema).max(2_000),
  tabs: z.array(z.strictObject({ id: opaqueId, url: z.url(), title: z.string().max(2_000) })).max(100),
  frames: z.array(z.strictObject({ id: opaqueId, parentId: opaqueId.nullable(), url: z.url(), accessible: z.boolean() })).max(100),
  formErrors: z.array(z.strictObject({ fieldKey: nullableText(500), text: text(2_000) })).max(200),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  truncated: z.boolean(),
  omittedSegmentCount: z.number().int().min(0),
}).superRefine((observation, ctx) => {
  const unique = (values: string[], path: string) => { if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', path: [path], message: `${path} must be unique` }); };
  unique(observation.segments.map(item => item.id), 'segments');
  unique(observation.elements.map(item => item.ref), 'elements');
  unique(observation.tabs.map(item => item.id), 'tabs');
  unique(observation.frames.map(item => item.id), 'frames');
  const frameIds = new Set(observation.frames.map(item => item.id));
  if (!frameIds.has(observation.frameId)) ctx.addIssue({ code: 'custom', path: ['frameId'], message: 'current frame is absent' });
  observation.elements.forEach((element, index) => { if (!frameIds.has(element.frameId)) ctx.addIssue({ code: 'custom', path: ['elements', index, 'frameId'], message: 'element frame is absent' }); });
  const tabIds = new Set(observation.tabs.map(item => item.id));
  if (!tabIds.has(observation.tabId)) ctx.addIssue({ code: 'custom', path: ['tabId'], message: 'current tab is absent' });
});
export type BrowserObservation = z.infer<typeof browserObservationSchema>;

const envelope = { schemaVersion: z.literal(1), observationId: z.uuid(), actionId: z.uuid(), reason: text(2_000) };
const actionBase = z.strictObject(envelope);
const action = <T extends z.ZodRawShape>(kind: string, shape: T) => actionBase.extend({ kind: z.literal(kind), ...shape });

export const browserActionSchema = z.discriminatedUnion('kind', [
  action('navigate', { url: httpUrl }),
  action('click', { elementRef: opaqueId }),
  action('fill', { elementRef: opaqueId, value: z.string().max(10_000) }),
  action('select', { elementRef: opaqueId, values: z.array(text(2_000)).max(100) }),
  action('check', { elementRef: opaqueId, checked: z.boolean() }),
  action('upload', { elementRef: opaqueId, artifactIds: z.array(z.uuid()).max(20) }),
  action('scroll', { elementRef: opaqueId.nullable(), direction: z.enum(['up', 'down']), pages: boundedInteger(1, 3) }),
  action('wait', { milliseconds: boundedInteger(100, 5_000) }),
  action('switch_tab', { tabId: opaqueId }),
  action('back', {}),
  action('request_intervention', { reasonCode: text(200), requestedAction: text(2_000) }),
  action('finish', { outcome: z.enum(['complete', 'no_results', 'unsupported']), evidence: z.array(z.strictObject({ sourceKind: z.enum(['listing', 'resource', 'fact', 'observation']), sourceId: z.uuid(), sourceRevision: z.number().int().positive(), segmentId: text(500), quote: z.string().max(20_000) })).max(100) }),
]);
export type BrowserAction = z.infer<typeof browserActionSchema>;

export const browserActionResultSchema = z.strictObject({
  actionId: z.uuid(), status: z.enum(['succeeded', 'failed', 'needs_intervention']), beforeId: z.uuid(), afterObservationId: z.uuid().nullable(),
  error: z.strictObject({ code: text(200), message: text(2_000) }).nullable(),
});

export type BrowserActionValidationContext = {
  observation: BrowserObservation;
  allowedOrigins: readonly string[];
  expectedGeneration: number;
  workflow?: 'discovery' | 'application';
  submissionAuthorized?: boolean;
};

export type BrowserActionValidation = { ok: true; action: BrowserAction } | { ok: false; code: string; message: string };

export function validateBrowserAction(input: unknown, context: BrowserActionValidationContext): BrowserActionValidation {
  const parsed = browserActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_ACTION', message: parsed.error.issues.map(issue => issue.message).join('; ') };
  const value = parsed.data;
  if (context.observation.id !== value.observationId) return { ok: false, code: 'STALE_OBSERVATION', message: 'action references a different observation' };
  if (context.observation.generation !== context.expectedGeneration) return { ok: false, code: 'STALE_OBSERVATION', message: 'observation generation is no longer current' };
  if (value.kind === 'navigate') {
    const url = new URL('url' in value ? value.url : '');
    if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, code: 'INVALID_DESTINATION', message: 'only HTTP(S) navigation is allowed' };
    if (!context.allowedOrigins.some(origin => new URL(origin).origin === url.origin)) return { ok: false, code: 'ORIGIN_NOT_ALLOWED', message: 'navigation origin is not allowed' };
  }
  if (value.kind === 'switch_tab' && !context.observation.tabs.some(tab => tab.id === ('tabId' in value ? value.tabId : ''))) return { ok: false, code: 'TARGET_NOT_FOUND', message: 'tab is absent from the observation' };
  const ref = 'elementRef' in value ? value.elementRef : null;
  if (ref !== null) {
    const target = context.observation.elements.find(element => element.ref === ref);
    if (!target || !target.visible || target.disabled) return { ok: false, code: 'TARGET_INVALID', message: 'target is absent, hidden, or disabled' };
    if (['click', 'fill', 'select', 'check', 'upload'].includes(value.kind) && (target.effect === 'submission' || target.effect === 'unknown') && !context.submissionAuthorized) return { ok: false, code: 'SUBMISSION_GUARD', message: 'target effect requires submission authorization' };
    if (['fill', 'select', 'check', 'upload'].includes(value.kind) && target.effect !== 'edit') return { ok: false, code: 'TARGET_EFFECT_MISMATCH', message: 'action requires an edit target' };
    if (value.kind === 'fill' && !['text', 'textarea', 'date', 'custom'].includes(target.kind)) return { ok: false, code: 'TARGET_KIND_MISMATCH', message: 'fill requires a text-like control' };
    if (value.kind === 'select' && target.kind !== 'select') return { ok: false, code: 'TARGET_KIND_MISMATCH', message: 'select requires a select control' };
    if (value.kind === 'check' && !['checkbox', 'radio'].includes(target.kind)) return { ok: false, code: 'TARGET_KIND_MISMATCH', message: 'check requires a checkbox or radio control' };
    if (value.kind === 'upload' && target.kind !== 'file') return { ok: false, code: 'TARGET_EFFECT_MISMATCH', message: 'upload requires a file control' };
  }
  return { ok: true, action: value };
}
