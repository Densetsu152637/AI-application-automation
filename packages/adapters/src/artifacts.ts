import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';

/** Errors are deliberately stable: callers can map these to a redacted API error. */
export type ArtifactErrorCode =
  | 'INVALID_STORAGE_KEY'
  | 'ARTIFACT_MISSING'
  | 'ARTIFACT_EXPIRED'
  | 'ARTIFACT_INTEGRITY_ERROR'
  | 'ARTIFACT_IMMUTABLE_CONFLICT';

export class ArtifactStorageError extends Error {
  readonly code: ArtifactErrorCode;

  constructor(code: ArtifactErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ArtifactStorageError';
    this.code = code;
  }
}

const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Validate and return an opaque, root-relative storage key.
 * Backslashes, dot segments, control characters, and platform absolute paths
 * are rejected so a key can never escape the configured storage root.
 */
export function validateStorageKey(storageKey: string): string {
  if (typeof storageKey !== 'string' || storageKey.length === 0 || storageKey.length > 1024) {
    throw new ArtifactStorageError('INVALID_STORAGE_KEY', 'Storage key must be 1..1024 characters');
  }
  if (
    storageKey.includes('\\') ||
    storageKey.includes('\0') ||
    /[\u0000-\u001f\u007f]/u.test(storageKey) ||
    isAbsolute(storageKey) ||
    storageKey.startsWith('/') ||
    storageKey.split('/').some(part => part.length === 0 || part === '.' || part === '..')
  ) {
    throw new ArtifactStorageError('INVALID_STORAGE_KEY', 'Storage key must be a normalized relative path');
  }
  const normalized = normalize(storageKey).replaceAll(sep, '/');
  if (normalized !== storageKey || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new ArtifactStorageError('INVALID_STORAGE_KEY', 'Storage key must be a normalized relative path');
  }
  return storageKey;
}

/** Resolve a validated key and prove the result remains under root. */
export function storagePath(root: string, storageKey: string): string {
  const key = validateStorageKey(storageKey);
  const rootPath = normalize(root);
  const target = normalize(join(rootPath, key));
  const escaped = relative(rootPath, target);
  if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
    throw new ArtifactStorageError('INVALID_STORAGE_KEY', 'Storage key escapes artifact root');
  }
  return target;
}

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface ArtifactWriteResult {
  storageKey: string;
  sha256: string;
  sizeBytes: number;
}

export interface ArtifactReadResult {
  storageKey: string;
  bytes: Buffer;
  sha256: string;
  sizeBytes: number;
}

export interface ArtifactVerification {
  present: boolean;
  expired: boolean;
  sha256: string | null;
  sizeBytes: number | null;
}

function expiryTime(expiresAt: Date | string | null | undefined): number | null {
  if (expiresAt == null) return null;
  const time = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (!Number.isFinite(time)) throw new TypeError('expiresAt must be a valid date');
  return time;
}

export function isExpired(expiresAt: Date | string | null | undefined, now = new Date()): boolean {
  const time = expiryTime(expiresAt);
  return time !== null && now.getTime() >= time;
}

/**
 * Atomically publish an artifact. Existing files are never overwritten. A
 * retry with identical bytes is idempotent; different bytes are a conflict.
 */
export function atomicWriteArtifact(root: string, storageKey: string, content: Uint8Array | string): ArtifactWriteResult {
  const target = storagePath(root, storageKey);
  const bytes = Buffer.from(content);
  const digest = sha256(bytes);
  mkdirSync(dirname(target), { recursive: true });

  if (existsSync(target)) {
    const existing = readFileSync(target);
    if (sha256(existing) !== digest) throw new ArtifactStorageError('ARTIFACT_IMMUTABLE_CONFLICT');
    return { storageKey, sha256: digest, sizeBytes: existing.length };
  }

  const temporary = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    // Same-directory rename is atomic on the supported local filesystem.
    try {
      renameSync(temporary, target);
    } catch (error) {
      if (existsSync(target)) {
        const existing = readFileSync(target);
        if (sha256(existing) === digest) return { storageKey, sha256: digest, sizeBytes: existing.length };
        throw new ArtifactStorageError('ARTIFACT_IMMUTABLE_CONFLICT');
      }
      throw error;
    }
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
  return { storageKey, sha256: digest, sizeBytes: bytes.length };
}

export function readArtifact(root: string, storageKey: string, options: { expiresAt?: Date | string | null; now?: Date } = {}): ArtifactReadResult {
  const path = storagePath(root, storageKey);
  if (isExpired(options.expiresAt, options.now)) throw new ArtifactStorageError('ARTIFACT_EXPIRED');
  if (!existsSync(path)) throw new ArtifactStorageError('ARTIFACT_MISSING');
  const bytes = readFileSync(path);
  return { storageKey, bytes, sha256: sha256(bytes), sizeBytes: bytes.length };
}

export function verifyArtifact(
  root: string,
  storageKey: string,
  expectedSha256: string,
  options: { expiresAt?: Date | string | null; now?: Date } = {},
): ArtifactVerification {
  if (!SHA256.test(expectedSha256)) throw new TypeError('expectedSha256 must be lowercase SHA-256 hex');
  const path = storagePath(root, storageKey);
  if (!existsSync(path)) return { present: false, expired: false, sha256: null, sizeBytes: null };
  const bytes = readFileSync(path);
  const digest = sha256(bytes);
  if (digest !== expectedSha256) throw new ArtifactStorageError('ARTIFACT_INTEGRITY_ERROR');
  return { present: true, expired: isExpired(options.expiresAt, options.now), sha256: digest, sizeBytes: statSync(path).size };
}

function immutableValue(value: unknown, seen: Set<object>): unknown {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('JSON cannot contain non-finite numbers');
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') throw new TypeError('Value is not JSON serializable');
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(item => immutableValue(item, seen));
  if (value && typeof value === 'object') {
    if (seen.has(value)) throw new TypeError('Cannot serialize cyclic JSON');
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = immutableValue((value as Record<string, unknown>)[key], seen);
      if (item !== undefined) result[key] = item;
    }
    seen.delete(value);
    return result;
  }
  return value;
}

/** Deterministic JSON bytes for an export; input objects are never mutated. */
export function serializeImmutableJson(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(immutableValue(value, new Set()), undefined, 2) + '\n', 'utf8');
}

export function immutableJsonHash(value: unknown): string {
  return sha256(serializeImmutableJson(value));
}
