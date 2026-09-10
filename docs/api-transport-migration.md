# API transport migration

The shared transport helpers are implemented for authentication, source CRUD,
operations, applications, resources, profile/facts, opportunities, exports, and
the newer run/search/settings action routes. These routes use version-1
success/error envelopes, request IDs, private no-store responses, exact `Origin`
checks for mutations, and SQLite-backed idempotency where creation is replayable.

Application mutation actions now require persisted idempotency keys, including
answer edits, approval, cancellation, retry, submission intent, and unknown-
submission resolution. Policy CRUD and search-run commands also use the shared
transport helpers.
The application now exposes `/api/v1/*` as the versioned compatibility namespace
through a server-side rewrite to the existing handlers. The unversioned `/api/*`
paths remain temporarily available for backwards compatibility; new clients
should use `/api/v1`.
