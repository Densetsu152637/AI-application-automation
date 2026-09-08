import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
export const schemaVersion = 1;
export function openDatabase(path: string) {
  const db = new Database(path);
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
export function migrate(db: Database.Database) {
  // BEGIN IMMEDIATE serializes migrations across simultaneous web starts.
  db.transaction(() => {
    const current = db.pragma('user_version', { simple: true }) as number;
    if (current > schemaVersion) throw new Error('SCHEMA_INCOMPATIBLE');
    if (current < 1) {
      db.exec(readFileSync(new URL('../migrations/001-foundation.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 1');
    }
  }).immediate();
}
export function assertSchema(db: Database.Database) {
  if (db.pragma('user_version', { simple: true }) !== schemaVersion) throw new Error('SCHEMA_INCOMPATIBLE');
}
