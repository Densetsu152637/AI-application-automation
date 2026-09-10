CREATE TABLE api_idempotency_records (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, idempotency_key)
) STRICT;
CREATE INDEX api_idempotency_created_idx ON api_idempotency_records(created_at);
INSERT INTO schema_migrations VALUES (13, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
