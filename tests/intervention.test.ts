import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIntervention, InterventionDomainError, transitionIntervention, ViewerTicketLedger } from '../packages/domain/src/intervention.ts';

const at = (value: string) => new Date(value);
const codec = { generateToken: () => 'opaque-ticket', hashToken: (value: string) => `hash:${value}` };
const domainCode = (code: InterventionDomainError['code']) => (error: unknown) => error instanceof InterventionDomainError && error.code === code;

test('intervention follows the bounded takeover lifecycle and rejects skips', () => {
  let task = createIntervention({ id: 'i-1', targetId: 'a-1', requiredAction: 'Complete the CAPTCHA', knownContext: { url: 'https://fixture.test/apply' }, browserGeneration: 3, now: at('2026-01-01T00:00:00.000Z') });
  assert.throws(() => transitionIntervention(task, { type: 'begin_human_control' }), domainCode('INVALID_TRANSITION'));
  task = transitionIntervention(task, { type: 'request_takeover' }, at('2026-01-01T00:00:01.000Z'));
  task = transitionIntervention(task, { type: 'suspend_automation' }, at('2026-01-01T00:00:02.000Z'));
  task = transitionIntervention(task, { type: 'begin_human_control' }, at('2026-01-01T00:00:03.000Z'));
  task = transitionIntervention(task, { type: 'begin_resolution' }, at('2026-01-01T00:00:04.000Z'));
  task = transitionIntervention(task, { type: 'resolve', resolution: 'not_submitted', note: 'User left the form open.' }, at('2026-01-01T00:00:05.000Z'));
  assert.equal(task.state, 'resolved');
  assert.equal(task.resolution, 'not_submitted');
  assert.throws(() => transitionIntervention(task, { type: 'expire' }), domainCode('INVALID_TRANSITION'));
});

test('viewer tickets are one-time, bound, and expiry checked', () => {
  const ledger = new ViewerTicketLedger(codec);
  const issued = ledger.issue({ sessionId: 's-1', interventionId: 'i-1', browserGeneration: 2, ttlMs: 1_000, now: at('2026-01-01T00:00:00.000Z') });
  assert.equal(issued.ticket.tokenHash, 'hash:opaque-ticket');
  assert.throws(() => ledger.issue({ sessionId: 's-1', interventionId: 'i-1', browserGeneration: 2, now: at('2026-01-01T00:00:00.100Z') }), domainCode('TICKET_ALREADY_ISSUED'));
  const consumed = ledger.consume(issued.token, { sessionId: 's-1', interventionId: 'i-1', browserGeneration: 2 }, at('2026-01-01T00:00:00.500Z'));
  assert.equal(consumed.consumedAt?.toISOString(), '2026-01-01T00:00:00.500Z');
  assert.throws(() => ledger.consume(issued.token, { sessionId: 's-1', interventionId: 'i-1', browserGeneration: 2 }, at('2026-01-01T00:00:00.600Z')), domainCode('TICKET_REPLAYED'));
  const expired = ledger.issue({ sessionId: 's-2', interventionId: 'i-1', browserGeneration: 2, ttlMs: 100, now: at('2026-01-01T00:00:00.000Z') });
  assert.throws(() => ledger.consume(expired.token, { sessionId: 's-2', interventionId: 'i-1', browserGeneration: 2 }, at('2026-01-01T00:00:00.100Z')), domainCode('TICKET_EXPIRED'));
});

test('viewer tickets reject generation and session mismatches and can be revoked', () => {
  const ledger = new ViewerTicketLedger(codec);
  const first = ledger.issue({ sessionId: 's-1', interventionId: 'i-2', browserGeneration: 4, now: at('2026-01-01T00:00:00.000Z') });
  assert.throws(() => ledger.consume(first.token, { sessionId: 's-1', interventionId: 'i-2', browserGeneration: 5 }, at('2026-01-01T00:00:01.000Z')), domainCode('TICKET_BINDING_MISMATCH'));
  ledger.revoke(first.token, at('2026-01-01T00:00:02.000Z'));
  assert.throws(() => ledger.consume(first.token, { sessionId: 's-1', interventionId: 'i-2', browserGeneration: 4 }, at('2026-01-01T00:00:03.000Z')), domainCode('TICKET_REVOKED'));
});
