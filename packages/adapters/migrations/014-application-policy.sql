ALTER TABLE application_attempts ADD COLUMN policy_ref TEXT REFERENCES application_policies(id);
ALTER TABLE application_attempts ADD COLUMN search_id TEXT REFERENCES searches(id);
ALTER TABLE application_attempts ADD COLUMN destination_origin TEXT;
INSERT INTO schema_migrations VALUES (14, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
