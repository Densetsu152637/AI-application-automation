CREATE TABLE application_attempts (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  listing_id TEXT NOT NULL REFERENCES discovered_listings(id),
  state TEXT NOT NULL CHECK (state IN ('queued', 'preparing', 'ready', 'needs_review', 'needs_input', 'submitting', 'submitted', 'submission_unknown', 'failed', 'cancelled', 'closed')),
  answers_json TEXT NOT NULL,
  attachments_json TEXT NOT NULL,
  blockers_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX application_attempts_state_idx ON application_attempts(state, updated_at);
CREATE UNIQUE INDEX application_active_listing_idx ON application_attempts(listing_id) WHERE state IN ('queued', 'preparing', 'ready', 'needs_review', 'needs_input', 'submitting', 'submission_unknown', 'submitted');
INSERT INTO schema_migrations VALUES (7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
