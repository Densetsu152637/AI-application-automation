import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  ArtifactStorageError,
  readArtifact,
  serializeImmutableJson,
  sha256,
  storagePath,
  validateStorageKey,
} from '@aaa/adapters/artifacts';

export const EXPORT_ROOT_PREFIX = 'exports/';

export interface ExportMetadata {
  storageKey: string;
  fileName: string;
  runId: string;
  kind: 'base' | 'supplemental';
  sequence: number;
  mediaType: 'application/json';
  sizeBytes: number;
  sha256: string;
  available: boolean;
  errorCode?: 'EXPORT_INTEGRITY_ERROR';
}

export interface ExportArtifact {
  metadata: ExportMetadata;
  bytes: Buffer;
}

/** The web container's read-only view of the output/artifact volume. */
export function exportStorageRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.OUTPUT_ROOT ?? env.ARTIFACT_ROOT ?? '/output';
}

function invalidExportKey(message = 'Invalid export key'): never {
  throw new ArtifactStorageError('INVALID_STORAGE_KEY', message);
}

/**
 * Export keys are opaque, root-relative artifact keys. The filename grammar is
 * deliberately narrow so this endpoint cannot become a generic file reader.
 */
export function validateExportKey(storageKey: string): string {
  try {
    validateStorageKey(storageKey);
  } catch {
    invalidExportKey();
  }
  if (!storageKey.startsWith(EXPORT_ROOT_PREFIX)) invalidExportKey();
  const parts = storageKey.split('/');
  if (parts.length !== 3 || !parts[1]) invalidExportKey();
  const fileName = parts[2];
  if (!fileName) invalidExportKey();
  if (fileName === 'base.json' || /^supplemental-[1-9]\d*\.json$/u.test(fileName)) return storageKey;
  invalidExportKey();
}

function parseExportKey(storageKey: string): Pick<ExportMetadata, 'fileName' | 'runId' | 'kind' | 'sequence'> {
  validateExportKey(storageKey);
  const [, runId, fileName] = storageKey.split('/');
  if (!runId || !fileName) invalidExportKey();
  if (fileName === 'base.json') return { fileName, runId, kind: 'base', sequence: 0 };
  const sequence = Number(/^supplemental-(\d+)\.json$/u.exec(fileName)?.[1]);
  if (!Number.isSafeInteger(sequence) || sequence < 1) invalidExportKey();
  return { fileName, runId, kind: 'supplemental', sequence };
}

function metadataFor(root: string, storageKey: string, bytes: Buffer, valid: boolean): ExportMetadata {
  const parsed = parseExportKey(storageKey);
  return {
    storageKey,
    ...parsed,
    mediaType: 'application/json',
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
    available: valid,
    ...(valid ? {} : { errorCode: 'EXPORT_INTEGRITY_ERROR' as const }),
  };
}

function canonicalJson(bytes: Buffer): boolean {
  try {
    return Buffer.compare(bytes, serializeImmutableJson(JSON.parse(bytes.toString('utf8')))) === 0;
  } catch {
    return false;
  }
}

/** Read one export and verify that its bytes are the frozen canonical JSON. */
export function readExportArtifact(root: string, storageKey: string): ExportArtifact {
  const key = validateExportKey(storageKey);
  const artifact = readArtifact(root, key);
  if (!canonicalJson(artifact.bytes)) throw new ArtifactStorageError('ARTIFACT_INTEGRITY_ERROR', 'Export JSON is not canonical');
  return { bytes: artifact.bytes, metadata: metadataFor(root, key, artifact.bytes, true) };
}

function collectKeys(root: string, directory: string, prefix: string, keys: string[]): void {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    // Symlinks are intentionally ignored; the artifact adapter validates keys,
    // but following links would make the listing's root boundary ambiguous.
    if (entry.isSymbolicLink()) continue;
    const key = `${prefix}${entry.name}`;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectKeys(root, path, `${key}/`, keys);
    else if (entry.isFile() && /^base\.json$|^supplemental-[1-9]\d*\.json$/u.test(entry.name)) {
      try { keys.push(validateExportKey(key)); } catch { /* ignore files outside the export grammar */ }
    }
  }
}

/** List export metadata without exposing filesystem paths. */
export function listExportMetadata(root: string): ExportMetadata[] {
  const keys: string[] = [];
  const exportsPath = storagePath(root, 'exports');
  collectKeys(root, exportsPath, `${EXPORT_ROOT_PREFIX}`, keys);
  return keys.sort().map(key => {
    let bytes: Buffer;
    try { bytes = readArtifact(root, key).bytes; }
    catch { return null; }
    return metadataFor(root, key, bytes, canonicalJson(bytes));
  }).filter((item): item is ExportMetadata => item !== null);
}

export function exportContentDisposition(fileName: string): string {
  const safe = basename(fileName);
  if (safe !== fileName || !/^(?:base|supplemental-[1-9]\d*)\.json$/u.test(safe)) invalidExportKey();
  return `attachment; filename="${safe}"`;
}
