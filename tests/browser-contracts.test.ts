import assert from 'node:assert/strict';
import test from 'node:test';
import { browserActionSchema, browserObservationSchema, validateBrowserAction, type BrowserObservation } from '../packages/contracts/src/index.ts';

const ids = { observation: '00000000-0000-4000-8000-000000000001', action: '00000000-0000-4000-8000-000000000002' };
const observation = {
  schemaVersion: 1, id: ids.observation, generation: 2, capturedAt: '2026-01-01T00:00:00.000Z', tabId: 'tab-1', frameId: 'frame-1',
  url: 'https://jobs.example/search', title: 'Jobs', segments: [],
  elements: [{ ref: 'el-1', frameId: 'frame-1', role: 'textbox', label: 'Keywords', kind: 'text', fieldKey: 'keywords', formKey: 'search', required: false, disabled: false, visible: true, currentValue: '', options: [], constraints: { minLength: null, maxLength: null, pattern: null, min: null, max: null, accept: [], multiple: false }, href: null, effect: 'edit' }],
  tabs: [{ id: 'tab-1', url: 'https://jobs.example/search', title: 'Jobs' }], frames: [{ id: 'frame-1', parentId: null, url: 'https://jobs.example/search', accessible: true }], formErrors: [], contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', truncated: false, omittedSegmentCount: 0,
} satisfies BrowserObservation;

test('browser observation is closed, scoped, and omits password values', () => {
  assert.equal(browserObservationSchema.safeParse(observation).success, true);
  assert.equal(browserObservationSchema.safeParse({ ...observation, extra: true }).success, false);
  assert.equal(browserObservationSchema.safeParse({ ...observation, elements: [{ ...observation.elements[0], role: 'password', currentValue: 'secret' }] }).success, false);
});

test('browser action union rejects script, selector, path, and coordinate capabilities', () => {
  const base = { schemaVersion: 1, observationId: ids.observation, actionId: ids.action, reason: 'bounded test' };
  assert.equal(browserActionSchema.safeParse({ ...base, kind: 'execute_script', script: 'document.body.innerHTML = "x"' }).success, false);
  assert.equal(browserActionSchema.safeParse({ ...base, kind: 'click', selector: '#submit' }).success, false);
  assert.equal(browserActionSchema.safeParse({ ...base, kind: 'upload', elementRef: 'el-1', path: 'C:\\Users\\me\\resume.pdf' }).success, false);
  assert.equal(browserActionSchema.safeParse({ ...base, kind: 'click', x: 10, y: 20 }).success, false);
  assert.equal(browserActionSchema.safeParse({ ...base, kind: 'navigate', url: 'file:///etc/passwd' }).success, false);
});

test('browser action validation checks current target and effect before dispatch', () => {
  const context = { observation, allowedOrigins: ['https://jobs.example'], expectedGeneration: 2 } as const;
  const valid = validateBrowserAction({ schemaVersion: 1, observationId: ids.observation, actionId: ids.action, kind: 'fill', elementRef: 'el-1', value: 'TypeScript', reason: 'set search' }, context);
  assert.equal(valid.ok, true);
  assert.equal(validateBrowserAction({ schemaVersion: 1, observationId: ids.observation, actionId: ids.action, kind: 'fill', elementRef: 'missing', value: 'x', reason: 'bad target' }, context).ok, false);
  const submission = { ...observation, elements: [{ ...observation.elements[0], effect: 'submission' as const }] };
  const blocked = validateBrowserAction({ schemaVersion: 1, observationId: ids.observation, actionId: ids.action, kind: 'click', elementRef: 'el-1', reason: 'submit' }, { ...context, observation: browserObservationSchema.parse(submission) });
  assert.deepEqual(blocked, { ok: false, code: 'SUBMISSION_GUARD', message: 'target effect requires submission authorization' });
  assert.equal(validateBrowserAction({ schemaVersion: 1, observationId: ids.observation, actionId: ids.action, kind: 'navigate', url: 'https://other.example/', reason: 'outside origin' }, context).ok, false);
});
