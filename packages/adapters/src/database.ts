import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
export const schemaVersion = 18;
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
    if (current < 2) {
      db.exec(readFileSync(new URL('../migrations/002-application.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 2');
    }
    if (current < 3) {
      db.exec(readFileSync(new URL('../migrations/003-resources.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 3');
    }
    if (current < 4) {
      db.exec(readFileSync(new URL('../migrations/004-sources.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 4');
    }
    if (current < 5) {
      db.exec(readFileSync(new URL('../migrations/005-discovery.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 5');
    }
    if (current < 6) {
      db.exec(readFileSync(new URL('../migrations/006-profile.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 6');
    }
    if (current < 7) {
      db.exec(readFileSync(new URL('../migrations/007-applications.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 7');
    }
    if (current < 8) {
      db.exec(readFileSync(new URL('../migrations/008-operation-target.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 8');
    }
    if (current < 9) {
      db.exec(readFileSync(new URL('../migrations/009-application-events.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 9');
    }
    if (current < 10) {
      db.exec(readFileSync(new URL('../migrations/010-interventions.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 10');
    }
    if (current < 11) {
      db.exec(readFileSync(new URL('../migrations/011-runtime-control.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 11');
    }
    if (current < 12) {
      db.exec(readFileSync(new URL('../migrations/012-api-transport.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 12');
    }
    if (current < 13) {
      db.exec(readFileSync(new URL('../migrations/013-api-transport.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 13');
    }
    if (current < 14) {
      db.exec(readFileSync(new URL('../migrations/014-application-policy.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 14');
    }
    if (current < 15) {
      db.exec(readFileSync(new URL('../migrations/015-run-controls.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 15');
    }
    if (current < 16) {
      db.exec(readFileSync(new URL('../migrations/016-opportunity-state.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 16');
    }
    if (current < 17) {
      db.exec(readFileSync(new URL('../migrations/017-profile-questions.sql', import.meta.url), 'utf8'));
      db.pragma('user_version = 17');
    }
  }).immediate();
  // SQLite table rebuilds require foreign key enforcement disabled outside the transaction.
  if ((db.pragma('user_version', { simple: true }) as number) < 18) {
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        // Recheck under the write lock: another connection may have completed the migration.
        if ((db.pragma('user_version', { simple: true }) as number) >= 18) return;
        db.exec(readFileSync(new URL('../migrations/018-run-state.sql', import.meta.url), 'utf8'));
        if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('SCHEMA_INCOMPATIBLE');
        db.pragma('user_version = 18');
      }).immediate();
    } finally { db.pragma('foreign_keys = ON'); }
  }

}
export function assertSchema(db: Database.Database) {
  if (db.pragma('user_version', { simple: true }) !== schemaVersion) throw new Error('SCHEMA_INCOMPATIBLE');
}
