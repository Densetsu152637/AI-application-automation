CREATE TABLE interventions (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'takeover_requested', 'suspended', 'human_active', 'resolving', 'resolved', 'cancelled', 'expired')),
  required_action TEXT NOT NULL,
  known_context_json TEXT NOT NULL,
  browser_generation INTEGER NOT NULL CHECK (browser_generation >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('completed', 'not_submitted', 'submission_unknown', 'dismissed')),
  resolution_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX interventions_state_updated_idx ON interventions(state, updated_at DESC, id);
CREATE INDEX interventions_target_updated_idx ON interventions(target_id, updated_at DESC, id);
CREATE TABLE intervention_viewer_tickets (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  intervention_id TEXT NOT NULL REFERENCES interventions(id),
  browser_generation INTEGER NOT NULL CHECK (browser_generation >= 0),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT
) STRICT;
CREATE INDEX intervention_tickets_binding_idx ON intervention_viewer_tickets(session_id, intervention_id, browser_generation, expires_at);
INSERT INTO schema_migrations VALUES (10, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
