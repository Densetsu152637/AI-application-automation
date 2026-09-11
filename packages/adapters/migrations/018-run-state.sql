CREATE TABLE scan_runs_new (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'partial', 'failed', 'paused', 'cancelled')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  source_count INTEGER NOT NULL,
  listing_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  pause_requested INTEGER NOT NULL DEFAULT 0 CHECK (pause_requested IN (0, 1)),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1))
) STRICT;
INSERT INTO scan_runs_new SELECT id, operation_id, state, started_at, finished_at, source_count, listing_count, error_code, revision, pause_requested, cancel_requested FROM scan_runs;
DROP TABLE scan_runs;
ALTER TABLE scan_runs_new RENAME TO scan_runs;
INSERT INTO schema_migrations VALUES (18, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
