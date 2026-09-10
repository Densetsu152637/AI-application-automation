ALTER TABLE scan_runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE scan_runs ADD COLUMN pause_requested INTEGER NOT NULL DEFAULT 0 CHECK (pause_requested IN (0, 1));
ALTER TABLE scan_runs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1));
INSERT INTO schema_migrations VALUES (15, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
