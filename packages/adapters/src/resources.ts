import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import type Database from 'better-sqlite3';

const supported = new Map([['.txt', 'text/plain'], ['.md', 'text/markdown'], ['.json', 'application/json'], ['.pdf', 'application/pdf']]);
export type ResourceIndexResult = { indexed: number; unchanged: number; unsupported: number; failed: number; ignored: number };
export type ResourceContextSegment = { resourceId: string; revision: number; relativePath: string; segmentId: string; locator: string; text: string };
function files(root: string, current = root): string[] {
  return readdirSync(current, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('~') || entry.name.endsWith('.tmp') || entry.name.startsWith('.')) return [];
    const path = resolve(current, entry.name); if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return files(root, path); return [path];
  });
}
function textSegments(text: string) { return text.split(/\r?\n/).map((line, index) => ({ id: `p${index + 1}`, locator: `paragraph:${index + 1}`, text: line })).filter(segment => segment.text.trim()); }
export function selectResourceSegments(db: Database.Database, query: string, maxChars = 16_000): ResourceContextSegment[] {
  const terms = [...new Set(query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length >= 3))];
  const candidates: Array<ResourceContextSegment & { score: number; order: number }> = [];
  const rows = db.prepare("SELECT id,revision,relative_path,segments_json FROM resource_documents WHERE extraction_state='extracted' ORDER BY relative_path").all() as Array<{ id: string; revision: number; relative_path: string; segments_json: string }>;
  let order = 0;
  for (const row of rows) {
    const segments = JSON.parse(row.segments_json) as Array<{ id: string; locator: string; text: string }>;
    for (const segment of segments) {
      const lower = segment.text.toLocaleLowerCase(); const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
      candidates.push({ resourceId: row.id, revision: row.revision, relativePath: row.relative_path, segmentId: segment.id, locator: segment.locator, text: segment.text, score, order: order++ });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  const selected: ResourceContextSegment[] = []; let used = 0;
  for (const candidate of candidates) { if (!candidate.text.trim() || (selected.length > 0 && used + candidate.text.length > maxChars)) continue; selected.push({ resourceId: candidate.resourceId, revision: candidate.revision, relativePath: candidate.relativePath, segmentId: candidate.segmentId, locator: candidate.locator, text: candidate.text }); used += candidate.text.length; }
  return selected;
}
function pdfText(bytes: Buffer): string {
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('RESOURCE_INVALID_PDF');
  const chunks: Buffer[] = [];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const source = bytes.toString('latin1'); let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(source))) {
    const raw = Buffer.from(match[1]!, 'latin1');
    const start = Math.max(0, source.lastIndexOf('<<', match.index)); const dictionary = source.slice(start, match.index);
    if (/\/FlateDecode\b/.test(dictionary)) {
      try { chunks.push(inflateSync(raw)); } catch { continue; }
    } else chunks.push(raw);
  }
  const content = Buffer.concat(chunks).toString('latin1'); const lines: string[] = [];
  // PDF text-show operators use literal or hexadecimal strings followed by Tj/TJ.
  const tokenPattern = /\((?:\\[\\()nrtbf]|\\[0-7]{1,3}|[^()\\])*\)|<[0-9A-Fa-f\s]+>(?=\s*T[Jj])/g;
  let token: RegExpExecArray | null;
  while ((token = tokenPattern.exec(content))) {
    const value = token[0];
    if (value.startsWith('(')) lines.push(value.slice(1, -1).replace(/\\([\\()])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8))));
    else lines.push(Buffer.from(value.slice(1, -1).replace(/\s/g, ''), 'hex').toString('latin1'));
  }
  const text = lines.join('').replace(/[\u0000\r]+/g, '').replace(/\s*\n\s*/g, '\n').trim();
  if (!text) throw new Error('RESOURCE_OCR_UNSUPPORTED');
  if (text.length > 5_000_000) throw new Error('RESOURCE_TEXT_LIMIT');
  return text;
}
export function indexResourceRoot(db: Database.Database, root: string, maxBytes = 20 * 1024 * 1024): ResourceIndexResult {
  const result: ResourceIndexResult = { indexed: 0, unchanged: 0, unsupported: 0, failed: 0, ignored: 0 }; const seen = new Set<string>();
  for (const path of files(root)) {
    const relativePath = relative(root, path).replaceAll('\\', '/'); seen.add(relativePath); const extension = extname(path).toLowerCase(); const prior = db.prepare('SELECT id,revision,sha256 FROM resource_documents WHERE relative_path=?').get(relativePath) as { id: string; revision: number; sha256: string } | undefined;
    if (!supported.has(extension)) { result.unsupported++; db.prepare("INSERT INTO resource_documents VALUES (?, ?, ?, ?, 0, ?, 'unsupported', NULL, '[]', 'RESOURCE_UNSUPPORTED', ?) ON CONFLICT(relative_path) DO UPDATE SET extraction_state='unsupported',error_code='RESOURCE_UNSUPPORTED',updated_at=excluded.updated_at").run(prior?.id ?? randomUUID(), relativePath, (prior?.revision ?? 0) + 1, 'application/octet-stream', '0'.repeat(64), new Date().toISOString()); continue; }
    try {
      const stat = lstatSync(path); if (stat.size > maxBytes) throw new Error('RESOURCE_LIMIT'); const bytes = readFileSync(path); const sha256 = createHash('sha256').update(bytes).digest('hex'); if (prior?.sha256 === sha256) { result.unchanged++; continue; }
      const raw = extension === '.pdf' ? '' : new TextDecoder('utf-8', { fatal: true }).decode(bytes); const text = extension === '.pdf' ? pdfText(bytes) : extension === '.json' ? JSON.stringify(JSON.parse(raw), null, 2) : raw; const segments = textSegments(text); const id = prior?.id ?? randomUUID();
      db.prepare("INSERT INTO resource_documents VALUES (?, ?, ?, ?, ?, ?, 'extracted', ?, ?, NULL, ?) ON CONFLICT(relative_path) DO UPDATE SET revision=excluded.revision,media_type=excluded.media_type,size_bytes=excluded.size_bytes,sha256=excluded.sha256,extraction_state='extracted',extracted_text=excluded.extracted_text,segments_json=excluded.segments_json,error_code=NULL,updated_at=excluded.updated_at").run(id, relativePath, (prior?.revision ?? 0) + 1, supported.get(extension), bytes.length, sha256, text, JSON.stringify(segments), new Date().toISOString()); result.indexed++;
    } catch (error) { result.failed++; const code = error instanceof Error ? error.message : 'RESOURCE_READ_FAILED'; db.prepare("INSERT INTO resource_documents VALUES (?, ?, ?, ?, 0, ?, 'failed', NULL, '[]', ?, ?) ON CONFLICT(relative_path) DO UPDATE SET extraction_state='failed',error_code=excluded.error_code,updated_at=excluded.updated_at").run(prior?.id ?? randomUUID(), relativePath, (prior?.revision ?? 0) + 1, 'application/octet-stream', '0'.repeat(64), code, new Date().toISOString()); }
  }
  const stale = db.prepare('SELECT relative_path FROM resource_documents').all() as Array<{ relative_path: string }>; for (const row of stale) if (!seen.has(row.relative_path)) db.prepare("UPDATE resource_documents SET extraction_state='missing',error_code='RESOURCE_MISSING',updated_at=? WHERE relative_path=?").run(new Date().toISOString(), row.relative_path);
  return result;
}
