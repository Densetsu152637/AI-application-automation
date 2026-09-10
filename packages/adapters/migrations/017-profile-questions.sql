CREATE TABLE profile_questions (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  question TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
  answer_text TEXT,
  evidence_json TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX profile_questions_created_idx ON profile_questions(created_at DESC);
INSERT INTO schema_migrations VALUES (17, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
