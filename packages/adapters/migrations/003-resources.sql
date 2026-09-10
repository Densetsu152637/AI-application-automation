CREATE TABLE resource_documents (
  id TEXT PRIMARY KEY,
  relative_path TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  extraction_state TEXT NOT NULL CHECK (extraction_state IN ('extracted', 'unsupported', 'failed', 'missing')),
  extracted_text TEXT,
  segments_json TEXT NOT NULL,
  error_code TEXT,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX resource_documents_state_idx ON resource_documents(extraction_state);
INSERT INTO schema_migrations VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
