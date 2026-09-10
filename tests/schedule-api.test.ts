import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../packages/adapters/src/database.ts';
import { ensureSchedulerSchema, setScheduleCursor, tickSchedules } from '../packages/adapters/src/scheduler.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'aaa-schedule-api-'));
  const db = openDatabase(join(dir, 'schedule.sqlite'));
  db.exec('CREATE TABLE searches (id TEXT PRIMARY KEY); CREATE TABLE operations (id TEXT PRIMARY KEY, kind TEXT, state TEXT, progress INTEGER, error_code TEXT, created_at TEXT, updated_at TEXT, target_id TEXT);');
  ensureSchedulerSchema(db);
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const at = (value: string) => new Date(value);

test('worker hook persists schedule definitions, enqueues one due scan, and is idempotent', () => {
  const { db, cleanup } = fixture();
  try {
    db.prepare('INSERT INTO searches VALUES (?)').run('search-1');
    db.prepare('INSERT INTO schedule_definitions VALUES (?,?,?,?)').run('search-1', 1, 60 * 60 * 1000, at('2026-01-01T00:00:00Z').toISOString());
    setScheduleCursor(db, { searchId: 'search-1', nextDueAt: at('2026-01-01T00:00:00Z') });
    const first = tickSchedules(db, at('2026-01-02T00:00:00Z'));
    assert.equal(first.length, 1);
    assert.equal(first[0]?.result.reason, 'catch_up');
    assert.match(String(first[0]?.operationId), /^[0-9a-f-]{36}$/);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM operations WHERE kind='scan'").get() as { count: number }).count, 1);
    const retry = tickSchedules(db, at('2026-01-02T00:01:00Z'));
    assert.equal(retry[0]?.result.enqueued, false);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM operations WHERE kind='scan'").get() as { count: number }).count, 1);
  } finally { cleanup(); }
});

test('disabled definitions remain persisted and do not enqueue work', () => {
  const { db, cleanup } = fixture();
  try {
    db.prepare('INSERT INTO schedule_definitions VALUES (?,?,?,?)').run('search-2', 0, 30 * 60 * 1000, at('2026-01-01T00:00:00Z').toISOString());
    const ticks = tickSchedules(db, at('2026-01-02T00:00:00Z'));
    assert.equal(ticks[0]?.result.reason, 'disabled');
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM operations WHERE kind='scan'").get() as { count: number }).count, 0);
  } finally { cleanup(); }
});

test('scheduler contract exposes API-owned definition and cursor tables without migrations', () => {
  const { db, cleanup } = fixture();
  try {
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('schedule_definitions','schedule_cursors') ORDER BY name").all().length, 2);
  } finally { cleanup(); }
});
