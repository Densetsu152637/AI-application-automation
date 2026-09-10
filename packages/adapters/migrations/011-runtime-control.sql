CREATE TABLE runtime_control (id INTEGER PRIMARY KEY CHECK (id = 1), paused INTEGER NOT NULL CHECK (paused IN (0, 1)), updated_at TEXT NOT NULL) STRICT;
INSERT INTO runtime_control VALUES (1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO schema_migrations VALUES (11, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
