CREATE TABLE applicant_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  narrative_instructions TEXT,
  default_resume_ref TEXT,
  alternative_resume_refs_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE applicant_facts (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'conflicted', 'stale', 'rejected')),
  provenance_json TEXT NOT NULL,
  sensitive INTEGER NOT NULL CHECK (sensitive IN (0, 1)),
  confirmed_at TEXT,
  confirmed_by TEXT,
  supersedes_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX applicant_facts_key_idx ON applicant_facts(key, status);
INSERT INTO schema_migrations VALUES (6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
