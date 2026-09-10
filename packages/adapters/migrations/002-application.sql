CREATE TABLE administrator (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE dashboard_sessions (
  token_hash TEXT PRIMARY KEY,
  administrator_id TEXT NOT NULL REFERENCES administrator(id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE TABLE application_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  llm_base_url TEXT NOT NULL,
  llm_model_id TEXT NOT NULL,
  llm_timeout_seconds INTEGER NOT NULL,
  llm_context_tokens INTEGER NOT NULL,
  llm_output_tokens INTEGER NOT NULL,
  timezone TEXT NOT NULL,
  timezone_confirmed INTEGER NOT NULL CHECK (timezone_confirmed IN (0, 1)),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE searches (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  criteria_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  progress INTEGER NOT NULL CHECK (progress BETWEEN 0 AND 100),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX sessions_expiry_idx ON dashboard_sessions(expires_at);
CREATE INDEX operations_state_idx ON operations(state, updated_at);
INSERT INTO schema_migrations VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
