import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteArtifact, serializeImmutableJson } from '../packages/adapters/src/artifacts.ts';
import { exportContentDisposition, listExportMetadata, readExportArtifact, validateExportKey } from '../apps/web/lib/exports.ts';

test('export keys are confined to the export filename grammar', async () => {
  assert.equal(validateExportKey('exports/run-1/base.json'), 'exports/run-1/base.json');
  assert.equal(validateExportKey('exports/run-1/supplemental-1.json'), 'exports/run-1/supplemental-1.json');
  for (const key of ['base.json', 'exports/../secret', 'exports/run/base.txt', 'exports/run/supplemental-0.json', 'exports/run/a/extra.json']) {
    assert.throws(() => validateExportKey(key), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_STORAGE_KEY');
  }
  assert.equal(exportContentDisposition('base.json'), 'attachment; filename="base.json"');
  assert.throws(() => exportContentDisposition('../base.json'), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_STORAGE_KEY');
});

test('metadata and downloads only expose canonical immutable JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-export-api-'));
  try {
    const payload = { opportunities: [], schemaVersion: 1, runId: 'run-1' };
    const bytes = serializeImmutableJson(payload);
    const written = atomicWriteArtifact(root, 'exports/run-1/base.json', bytes);
    const listed = listExportMetadata(root);
    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0], { storageKey: 'exports/run-1/base.json', fileName: 'base.json', runId: 'run-1', kind: 'base', sequence: 0, mediaType: 'application/json', sizeBytes: bytes.length, sha256: written.sha256, available: true });
    assert.deepEqual(readExportArtifact(root, written.storageKey).bytes, bytes);
    assert.throws(() => atomicWriteArtifact(root, written.storageKey, '{"changed":true}'), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ARTIFACT_IMMUTABLE_CONFLICT');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid JSON is listed as unavailable and cannot be downloaded', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-export-api-'));
  try {
    atomicWriteArtifact(root, 'exports/run-1/base.json', '{"b":1,"a":2}\n');
    assert.equal(listExportMetadata(root)[0]?.available, false);
    assert.throws(() => readExportArtifact(root, 'exports/run-1/base.json'), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ARTIFACT_INTEGRITY_ERROR');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
