# Local fixture demonstration

This is the repeatable, fixture-only demonstration for the current development
implementation. It must not be run against employer sites or real credentials.

## Run

From the repository root:

```sh
npm ci
npm run setup
docker compose config --quiet
docker compose up --build -d --wait
```

Confirm that only `127.0.0.1:3000` is published and that the internal `inference`
service has no host port. Open `http://localhost:3000`, log in with the local
administrator secret, and confirm the dashboard remains usable while the model
is `unloaded` or `loading`.

## Exercise the implemented slices

1. Add fictional resources and run resource reindexing; inspect extracted facts
   and confirm only supported facts become profile facts.
2. Create a search with a required title and part-time internship criteria.
3. Queue a discovery scan against the controlled fixture origin and inspect
   match, reject, review, and seen outcomes.
4. Download the immutable export, repeat the scan, and verify no duplicate
   opportunity is exported.
5. Create an application, edit answers, approve the prepared snapshot, and
   verify that a second identical command replays rather than creating a second
   transition. Do not submit to a real site.
6. Use the inference diagnostics action. Verify `/health` reports the targeted
   Qwen3.5-9B configuration and 32,768 active attention tokens. After the
   configured idle interval, verify the model returns to `unloaded` and GPU
   memory is released.
7. Run a backup, restore it into disposable volumes, and verify sessions are
   revoked, work is paused, and exports/history remain present.

Record the date, image and model versions, fixture commit, command output,
pass/fail result for each item, and artifact paths. Current browser form
preparation and external submission are review-controlled development slices;
the repository does not claim universal website compatibility or release
readiness.

## Cleanup

```sh
docker compose stop
```

Use `docker compose down -v` only when disposable fixture volumes may be
deleted.
