CREATE TABLE application_policies (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  mode TEXT NOT NULL CHECK (mode IN ('review_required', 'automatic')),
  eligible_search_ids_json TEXT NOT NULL,
  destination_origins_json TEXT NOT NULL,
  approved_resume_refs_json TEXT NOT NULL,
  allow_generated_cover_letter INTEGER NOT NULL CHECK (allow_generated_cover_letter IN (0, 1)),
  max_submissions_per_day INTEGER NOT NULL CHECK (max_submissions_per_day BETWEEN 1 AND 100),
  timezone TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX application_policies_updated_idx ON application_policies(updated_at DESC, id);
CREATE TABLE quota_reservations (
  intent_id TEXT PRIMARY KEY,
  policy_ref TEXT NOT NULL,
  quota_date TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'consumed', 'released')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;
CREATE INDEX quota_reservations_scope_idx ON quota_reservations(policy_ref, quota_date, state);
INSERT INTO schema_migrations VALUES (12, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
