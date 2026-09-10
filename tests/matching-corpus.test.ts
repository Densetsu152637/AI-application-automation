import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MATCHING_CORPUS, MATCHING_CORPUS_VERSION } from './fixtures/matching-corpus.ts';

test('fictional matching corpus is versioned, balanced, and identity-separated', () => {
  assert.equal(MATCHING_CORPUS_VERSION, 'fictional-v1');
  assert.equal(MATCHING_CORPUS.length, 60);
  for (const label of ['match', 'reject', 'needs_review'] as const) {
    assert.equal(MATCHING_CORPUS.filter(item => item.label === label).length, 20);
  }
  assert.equal(new Set(MATCHING_CORPUS.map(item => item.id)).size, 60);
  assert.equal(new Set(MATCHING_CORPUS.map(item => item.identityKey)).size, 60);
  assert.ok(MATCHING_CORPUS.some(item => item.arrangement === null));
  assert.ok(MATCHING_CORPUS.some(item => item.hours === null));
});
