CREATE TABLE source_configurations (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  name TEXT NOT NULL,
  start_url TEXT NOT NULL,
  allowed_origins_json TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  support_status TEXT NOT NULL CHECK (support_status IN ('unverified', 'fixture_verified', 'user_verified', 'known_restriction')),
  support_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX source_configurations_enabled_idx ON source_configurations(enabled);
INSERT INTO schema_migrations VALUES (4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
