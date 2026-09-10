import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import type Database from 'better-sqlite3';

const supported = new Map([['.txt', 'text/plain'], ['.md', 'text/markdown'], ['.json', 'application/json']]);
export type ResourceIndexResult = { indexed: number; unchanged: number; unsupported: number; failed: number; ignored: number };
function files(root: string, current = root): string[] {
  return readdirSync(current, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('~') || entry.name.endsWith('.tmp') || entry.name.startsWith('.')) return [];
    const path = resolve(current, entry.name); if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return files(root, path); return [path];
  });
}
function textSegments(text: string) { return text.split(/\r?\n/).map((line, index) => ({ id: `p${index + 1}`, locator: `paragraph:${index + 1}`, text: line })).filter(segment => segment.text.trim()); }
export function indexResourceRoot(db: Database.Database, root: string, maxBytes = 20 * 1024 * 1024): ResourceIndexResult {
  const result: ResourceIndexResult = { indexed: 0, unchanged: 0, unsupported: 0, failed: 0, ignored: 0 }; const seen = new Set<string>();
  for (const path of files(root)) {
    const relativePath = relative(root, path).replaceAll('\\', '/'); seen.add(relativePath); const extension = extname(path).toLowerCase(); const prior = db.prepare('SELECT id,revision,sha256 FROM resource_documents WHERE relative_path=?').get(relativePath) as { id: string; revision: number; sha256: string } | undefined;
    if (!supported.has(extension)) { result.unsupported++; db.prepare("INSERT INTO resource_documents VALUES (?, ?, ?, ?, 0, ?, 'unsupported', NULL, '[]', 'RESOURCE_UNSUPPORTED', ?) ON CONFLICT(relative_path) DO UPDATE SET extraction_state='unsupported',error_code='RESOURCE_UNSUPPORTED',updated_at=excluded.updated_at").run(prior?.id ?? randomUUID(), relativePath, (prior?.revision ?? 0) + 1, 'application/octet-stream', '0'.repeat(64), new Date().toISOString()); continue; }
    try {
      const stat = lstatSync(path); if (stat.size > maxBytes) throw new Error('RESOURCE_LIMIT'); const bytes = readFileSync(path); const sha256 = createHash('sha256').update(bytes).digest('hex'); if (prior?.sha256 === sha256) { result.unchanged++; continue; }
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); const text = extension === '.json' ? JSON.stringify(JSON.parse(raw), null, 2) : raw; const segments = textSegments(text); const id = prior?.id ?? randomUUID();
      db.prepare("INSERT INTO resource_documents VALUES (?, ?, ?, ?, ?, ?, 'extracted', ?, ?, NULL, ?) ON CONFLICT(relative_path) DO UPDATE SET revision=excluded.revision,media_type=excluded.media_type,size_bytes=excluded.size_bytes,sha256=excluded.sha256,extraction_state='extracted',extracted_text=excluded.extracted_text,segments_json=excluded.segments_json,error_code=NULL,updated_at=excluded.updated_at").run(id, relativePath, (prior?.revision ?? 0) + 1, supported.get(extension), bytes.length, sha256, text, JSON.stringify(segments), new Date().toISOString()); result.indexed++;
    } catch (error) { result.failed++; const code = error instanceof Error ? error.message : 'RESOURCE_READ_FAILED'; db.prepare("INSERT INTO resource_documents VALUES (?, ?, ?, ?, 0, ?, 'failed', NULL, '[]', ?, ?) ON CONFLICT(relative_path) DO UPDATE SET extraction_state='failed',error_code=excluded.error_code,updated_at=excluded.updated_at").run(prior?.id ?? randomUUID(), relativePath, (prior?.revision ?? 0) + 1, 'application/octet-stream', '0'.repeat(64), code, new Date().toISOString()); }
  }
  const stale = db.prepare('SELECT relative_path FROM resource_documents').all() as Array<{ relative_path: string }>; for (const row of stale) if (!seen.has(row.relative_path)) db.prepare("UPDATE resource_documents SET extraction_state='missing',error_code='RESOURCE_MISSING',updated_at=? WHERE relative_path=?").run(new Date().toISOString(), row.relative_path);
  return result;
}
