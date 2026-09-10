import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyRetention } from '../packages/adapters/src/retention.ts';
import { createBackup, restoreBackup } from '../packages/adapters/src/backup.ts';
import { migrate, openDatabase } from '../packages/adapters/src/database.ts';
import { createSession, ensureAdministrator } from '../packages/adapters/src/repositories.ts';

test('retention removes only old bounded logs and preserves protected artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-retention-')); const diagnostics = join(root, 'diagnostics'); const logs = join(root, 'logs');
  try { const old = new Date('2020-01-01T00:00:00Z'); mkdirSync(diagnostics); mkdirSync(logs); const d = join(diagnostics, 'old.png'); const l = join(logs, 'old.json'); const p = join(logs, 'submission.json'); for (const path of [d, l, p]) { writeFileSync(path, 'x'); utimesSync(path, old, old); }
    const result = applyRetention({ diagnosticsRoot: diagnostics, runLogsRoot: logs, diagnosticDays: 7, runLogDays: 30, protectedKeys: ['submission.json'], now: new Date('2026-01-01T00:00:00Z') });
    assert.deepEqual(result.deleted.sort(), ['old.json', 'old.png']); assert.deepEqual(result.skippedProtected, ['submission.json']); assert.equal(readFileSync(p, 'utf8'), 'x');
    assert.throws(() => applyRetention({ diagnosticsRoot: diagnostics, runLogsRoot: logs, diagnosticDays: 0, runLogDays: 30 }), /RETENTION_BOUNDS_INVALID/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('backup verifies volumes and restore revokes sessions and pauses work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-backup-')); const dbPath = join(root, 'live.sqlite'); const restoredPath = join(root, 'restored.sqlite'); const artifacts = join(root, 'artifacts'); const profiles = join(root, 'profiles'); const backup = join(root, 'backup');
  const db = openDatabase(dbPath); migrate(db); ensureAdministrator(db, 'a'.repeat(32)); const session = createSession(db, 'a'.repeat(32)); writeFileSync(join(root, 'ignore'), 'x');
  try { mkdirSync(artifacts); mkdirSync(profiles); writeFileSync(join(artifacts, 'submitted.bin'), 'submitted bytes'); writeFileSync(join(profiles, 'profile.json'), '{}'); let stopped = false; const manifest = await createBackup({ db, destination: backup, artifactRoot: artifacts, profileRoot: profiles, hooks: { stopWork: () => { stopped = true; }, checkpoint: () => undefined, waitForSubmissions: () => undefined } }); assert.equal(manifest.files.length, 2); assert.equal(stopped, true); db.close();
    await restoreBackup({ source: backup, dbPath: restoredPath, artifactRoot: join(root, 'restored-artifacts'), profileRoot: join(root, 'restored-profiles'), hooks: { stopWork: () => undefined } });
    const restored = openDatabase(restoredPath); try { assert.equal((restored.prepare('SELECT revoked_at IS NOT NULL AS revoked FROM dashboard_sessions WHERE token_hash IS NOT NULL').get() as { revoked: number }).revoked, 1); assert.equal((restored.prepare('SELECT paused FROM runtime_control WHERE id=1').get() as { paused: number }).paused, 1); } finally { restored.close(); }
  } finally { try { db.close(); } catch {} rmSync(root, { recursive: true, force: true }); }
  assert.ok(session);
});
