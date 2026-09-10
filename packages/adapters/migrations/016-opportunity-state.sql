ALTER TABLE discovered_listings ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE discovered_listings ADD COLUMN dismissed INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0, 1));
INSERT INTO schema_migrations VALUES (16, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
