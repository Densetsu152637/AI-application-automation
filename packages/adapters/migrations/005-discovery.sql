CREATE TABLE scan_runs (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'partial', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  source_count INTEGER NOT NULL,
  listing_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT
) STRICT;
CREATE TABLE discovered_listings (
  id TEXT PRIMARY KEY,
  scan_run_id TEXT NOT NULL REFERENCES scan_runs(id),
  source_id TEXT NOT NULL REFERENCES source_configurations(id),
  canonical_url TEXT NOT NULL,
  original_url TEXT NOT NULL,
  title TEXT NOT NULL,
  employer TEXT,
  location TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(source_id, canonical_url)
) STRICT;
CREATE INDEX discovered_listings_scan_idx ON discovered_listings(scan_run_id);
INSERT INTO schema_migrations VALUES (5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
