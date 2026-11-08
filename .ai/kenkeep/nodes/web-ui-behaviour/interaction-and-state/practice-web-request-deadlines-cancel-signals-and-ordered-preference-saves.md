---
type: practice
title: 'Web requests: deadlines, cancel signals and ordered preference saves'
description: >-
  Every request has a read, write or transfer deadline; GET queries forward
  TanStack's signal; preference saves share one scope and undo only their own fields.
tags:
  - web
  - tanstack-query
  - network
kk_schema_version: 3
kk_id: practice-web-request-deadlines-cancel-signals-and-ordered-preference-saves
kk_derived_from:
  - packages/web/src/api/client.ts
  - packages/web/src/api/preferenceSaves.ts
kk_relates_to:
  - practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only
  - practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard
kk_depends_on: []
kk_confidence: high
---
- Every request in `packages/web/src/api/client.ts` runs under a deadline that covers the reply body too (`withDeadline`, built on `AbortSignal.timeout` and `AbortSignal.any`). `DEADLINE_MS` holds three kinds: `read` 20 s, `write` 30 s, `transfer` 5 min. `requestKind` picks one from the method and body: a GET is a read, a `RawBody` (CSV or JSON import) a transfer, anything else a write. A caller can name the kind; the report queries in `api/reports.ts` are POSTs and pass `kind: 'read'`. `download` (exports, CSV reports) always uses the transfer deadline. Running out of time fails with `RequestTimeoutError` and the `api.timedOut` message.
- GET query functions forward TanStack's `signal` (`queryFn: ({ signal }) => api.get(path, { signal, … })`), so a read that a refetch replaces or that no view observes any more is aborted. A cancel keeps its `AbortError`, so TanStack still treats the query as cancelled, not failed. Do not forward the signal to a POST, report queries included: an aborted POST looks like a write whose outcome is unknown, and the e2e guard fails on it.
- A timer write that times out is treated as one that got no reply: `explainTimerActionError` turns `RequestTimeoutError` into the `offline` `TimerActionError`, so after a Start, Continue or Stop the timer counts as unknown and the next start reads `GET /api/app/timer` first (see `practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only`).
- Preference saves (`savePreferencesOptions` in `api/account.ts`) share the mutation scope `preferences`, so TanStack sends them one at a time in the order made; a queued one is `isPaused` until the one before it settles. `createPreferenceSaves` (`api/preferenceSaves.ts`, one per QueryClient) keeps the cache at the latest server reply with the changes of the saves still waiting on top. A failed save drops only its own changes, so it can neither undo an earlier save that succeeded nor wipe a later change. Do not go back to snapshotting the whole object in `onMutate` and restoring it in `onError`. `api/account.test.ts` covers the interleavings.

<!-- Verified against the current code on 2026-11-08. -->
