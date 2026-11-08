---
type: practice
title: Creates take an Idempotency-Key, recorded in the create's own transaction
description: >-
  v9 entry and catalog creates, timer and Pomodoro start and entry split run
  once per user and key for 24 hours; a different request with the key is 422.
tags:
  - api
  - database
  - concurrency
kk_schema_version: 3
kk_id: practice-creates-take-an-idempotency-key
kk_derived_from: []
kk_relates_to:
  - map-timer-state-service-settlement-revision-and-discarded-pomodoro
  - practice-live-entry-indexes-back-project-and-task-totals
kk_depends_on: []
kk_confidence: high
---
A client that lost a create's reply sends the same request again with the same `Idempotency-Key` header and gets the original result instead of a second record. The creates that take it: `POST /api/v9/workspaces/{wid}/time_entries`, `/clients`, `/projects`, `/projects/{pid}/tasks` and `/tags`, `POST /api/app/timer/start`, `POST /api/app/pomodoro` and `POST /api/app/time_entries/{id}/split`. `GET /api/app/status` announces `idempotency-keys`.

`lib/idempotency.ts` reads the header (1 to 255 visible ASCII characters, else 400) and fingerprints the request: method, path with query, and the JSON body with its keys sorted. Routes pass the claim from `readIdempotencyClaim(req)` to the service (`EntryOperations.create`/`split`, `CatalogOperations.create*`) or set `idempotency` on the timer start commands. `idempotent()` in `domain/idempotency.ts` does the rest inside the create's transaction:

- The key is stored as `sha256(userId + key)` in `idempotency_keys` (migration 7), with the fingerprint, the created record's id (`result_id`) and `created_at`. A failed create records nothing.
- Same key and fingerprint within `IDEMPOTENCY_RETENTION_MS` (24 h): no create; the operation's `replay` reads the record back by id as it is now (both split halves; the current timer state for starts, answered before the revision check). A record deleted since gets the read's 404.
- Same key, other fingerprint: 422 (`unprocessable` in `lib/errors.ts`, the only 422 kind).
- Each keyed create first deletes up to 100 expired keys of any user, with `FOR UPDATE SKIP LOCKED` on server engines, so cleanup never waits. There is no periodic job.

Concurrency: two requests with one key may both miss the record, but the second's insert collides on the primary key once the first commits. The repository turns that unique violation into `StorageConflict('serialization')`, so the transaction runner rolls back the second create and runs it again; the rerun finds the record and replays. Keep the record insert in the same transaction as the create, after it, and keep the primary key the hash: a unique secondary key would bring back InnoDB gap locks.

To add a create: wrap its transaction body in `idempotent(ctx, userId, claim, { create, reference, replay })`, pass `readIdempotencyClaim(req)` from its route, and add it to the `CREATES` table in `test/idempotency.test.ts`.
