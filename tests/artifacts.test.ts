import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArtifactStorageError,
  atomicWriteArtifact,
  immutableJsonHash,
  isExpired,
  readArtifact,
  serializeImmutableJson,
  sha256,
  storagePath,
  validateStorageKey,
  verifyArtifact,
} from '../packages/adapters/src/artifacts.ts';

test('storage keys are normalized and confined', () => {
  assert.equal(validateStorageKey('exports/run/base.json'), 'exports/run/base.json');
  for (const key of ['', '../secret', 'exports/../secret', './export.json', '/tmp/export', 'exports\\export.json', 'exports//x']) {
    assert.throws(() => validateStorageKey(key), (error: unknown) => error instanceof ArtifactStorageError && error.code === 'INVALID_STORAGE_KEY');
  }
  assert.throws(() => storagePath('/output', '../outside'), (error: unknown) => error instanceof ArtifactStorageError && error.code === 'INVALID_STORAGE_KEY');
});

test('SHA-256 and atomic publication are deterministic and immutable', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-artifacts-'));
  try {
    const first = atomicWriteArtifact(root, 'exports/run/base.json', 'hello');
    assert.equal(first.sha256, sha256('hello'));
    assert.deepEqual(atomicWriteArtifact(root, 'exports/run/base.json', 'hello'), first);
    assert.throws(() => atomicWriteArtifact(root, 'exports/run/base.json', 'changed'), /ARTIFACT_IMMUTABLE_CONFLICT/);
    assert.equal(readFileSync(join(root, 'exports/run/base.json'), 'utf8'), 'hello');
    assert.equal(readArtifact(root, 'exports/run/base.json').bytes.toString(), 'hello');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('read and verify distinguish missing, expired, and corrupt artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-artifacts-'));
  try {
    const written = atomicWriteArtifact(root, 'diagnostics/x.bin', Buffer.from([1, 2, 3]));
    assert.deepEqual(verifyArtifact(root, written.storageKey, written.sha256), { present: true, expired: false, sha256: written.sha256, sizeBytes: 3 });
    assert.equal(verifyArtifact(root, 'diagnostics/missing.bin', written.sha256).present, false);
    assert.equal(verifyArtifact(root, written.storageKey, written.sha256, { expiresAt: '2020-01-01T00:00:00Z' }).expired, true);
    assert.throws(() => readArtifact(root, written.storageKey, { expiresAt: '2020-01-01T00:00:00Z' }), /ARTIFACT_EXPIRED/);
    atomicWriteArtifact(root, 'diagnostics/y.bin', 'bad');
    assert.throws(() => verifyArtifact(root, 'diagnostics/y.bin', written.sha256), /ARTIFACT_INTEGRITY_ERROR/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('immutable JSON serialization sorts object keys without changing input', () => {
  const value = { opportunities: [{ b: 2, a: 1 }], z: null, omitted: undefined };
  const json = serializeImmutableJson(value).toString();
  assert.equal(json, '{\n  "opportunities": [\n    {\n      "a": 1,\n      "b": 2\n    }\n  ],\n  "z": null\n}\n');
  assert.deepEqual(value, { opportunities: [{ b: 2, a: 1 }], z: null, omitted: undefined });
  assert.equal(immutableJsonHash(value), sha256(json));
  assert.throws(() => serializeImmutableJson({ loop: (() => { const x: Record<string, unknown> = {}; x.self = x; return x; })() }), /cyclic/);
  assert.equal(isExpired('2026-09-10T00:00:00Z', new Date('2026-09-10T00:00:00Z')), true);
});
