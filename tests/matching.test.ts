import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assessMatch,
  InvalidRelevanceResultError,
  type RelevanceResultAdapterInput,
} from '../packages/domain/src/matching.ts';

const criteria = [
  { id: 'title', field: 'title' as const, value: 'typescript', strength: 'required' as const },
  { id: 'location', field: 'location' as const, value: 'Sydney', strength: 'required' as const },
];
const job = { title: 'TypeScript engineer', location: null };

test('model resolves unknown criteria while code computes the final match', async () => {
  let input: RelevanceResultAdapterInput | undefined;
  const result = await assessMatch(criteria, job, async (received) => {
    input = received;
    return { criteria: received.criteria.map((criterion) => ({
      criterionId: criterion.id,
      outcome: criterion.id === 'location' ? 'pass' : received.deterministicResults.find((item) => item.criterionId === criterion.id)!.outcome,
      reason: criterion.id === 'location' ? 'The model found an explicit Sydney requirement.' : 'deterministic',
    })), summary: 'Resolved location from listing evidence.' };
  });
  assert.equal(input?.deterministicResults[0]?.outcome, 'pass');
  assert.equal(result.decision, 'match');
  assert.equal(result.modelUsed, true);
});

test('deterministic required failure rejects without asking the model', async () => {
  let called = false;
  const result = await assessMatch(criteria, { title: 'Java engineer', location: null }, async () => {
    called = true;
    return { criteria: [], summary: '' };
  });
  assert.equal(result.decision, 'reject');
  assert.equal(called, false);
});

test('incomplete, duplicate, and invented model coverage are rejected', async () => {
  const invalid = async (criteriaOut: unknown[]) => assessMatch(criteria, job, async () => ({ criteria: criteriaOut as never[], summary: 'bad' }));
  await assert.rejects(() => invalid([{ criterionId: 'title', outcome: 'pass', reason: 'only one' }]), InvalidRelevanceResultError);
  await assert.rejects(() => invalid(criteria.map((c) => ({ criterionId: c.id, outcome: 'unknown', reason: 'x' })).concat({ criterionId: 'title', outcome: 'pass', reason: 'duplicate' })), InvalidRelevanceResultError);
  await assert.rejects(() => invalid(criteria.map((c) => ({ criterionId: c.id, outcome: 'unknown', reason: 'x' })).map((r, i) => i ? { ...r, criterionId: 'invented' } : r)), InvalidRelevanceResultError);
});

test('model cannot provide submission authority through confidence', async () => {
  const result = await assessMatch(criteria, job, async (received) => ({
    criteria: received.criteria.map((criterion) => ({
      criterionId: criterion.id,
      outcome: received.deterministicResults.find((item) => item.criterionId === criterion.id)?.outcome ?? 'unknown',
      reason: 'uncertain',
      confidence: 1,
    } as never)),
    summary: 'High confidence is not an authorization.',
  }));
  assert.equal(result.decision, 'needs_review');
  assert.equal('confidence' in result, false);
});
