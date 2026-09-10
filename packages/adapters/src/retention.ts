import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface RetentionOptions { diagnosticsRoot: string; runLogsRoot: string; diagnosticDays: number; runLogDays: number; now?: Date; protectedKeys?: Iterable<string>; }
export interface RetentionResult { deleted: string[]; skippedProtected: string[]; }
function files(root: string): string[] { try { return readdirSync(root, { withFileTypes: true }).flatMap(entry => { const path = join(root, entry.name); return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : []; }); } catch { return []; } }
function removeOlder(root: string, days: number, now: Date, protectedKeys: Set<string>, result: RetentionResult): void { if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('RETENTION_BOUNDS_INVALID'); const cutoff = now.getTime() - days * 86_400_000; for (const path of files(root)) { const key = relative(root, path).replaceAll('\\', '/'); if (protectedKeys.has(key)) { result.skippedProtected.push(key); continue; } if (statSync(path).mtimeMs < cutoff) { unlinkSync(path); result.deleted.push(key); } } }
/** Cleanup is deliberately limited to diagnostic and run-log roots; exports are never traversed. */
export function applyRetention(options: RetentionOptions): RetentionResult { const result = { deleted: [], skippedProtected: [] } as RetentionResult; const now = options.now ?? new Date(); const protectedKeys = new Set(options.protectedKeys ?? []); removeOlder(options.diagnosticsRoot, options.diagnosticDays, now, protectedKeys, result); removeOlder(options.runLogsRoot, options.runLogDays, now, protectedKeys, result); return result; }
