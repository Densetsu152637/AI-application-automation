ALTER TABLE operations ADD COLUMN target_id TEXT;
INSERT INTO schema_migrations VALUES (8, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
