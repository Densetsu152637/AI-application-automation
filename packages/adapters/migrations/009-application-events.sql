CREATE TABLE application_events (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application_attempts(id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE submission_intents (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application_attempts(id),
  prepared_revision INTEGER NOT NULL,
  snapshot_hash TEXT NOT NULL,
  authority TEXT NOT NULL CHECK (authority IN ('manual', 'automatic')),
  state TEXT NOT NULL CHECK (state IN ('committed', 'dispatched', 'submitted', 'submission_unknown', 'not_submitted')),
  created_at TEXT NOT NULL,
  dispatched_at TEXT,
  resolved_at TEXT
) STRICT;
CREATE UNIQUE INDEX active_submission_intent_idx ON submission_intents(application_id) WHERE state IN ('committed', 'dispatched', 'submission_unknown', 'submitted');
INSERT INTO schema_migrations VALUES (9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
