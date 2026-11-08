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
- Every request in `packages/web/src/api/client.ts` runs under a deadline that covers the reply body too (`withDeadline`, built on `AbortSignal.timeout` and `AbortSignal.any`). `DEADLINE_MS` holds three kinds: `read` 20 s, `write` 30 s, `transfer` 5 min. `requestKind` picks one from the method and body: a GET is a read, a `RawBody` (CSV or JSON import) a transfer, anything else a write. A caller can name the kind; the report queries in `api/reports.ts` are POSTs and pass `kind: 'read'`. Running out of time fails with `RequestTimeoutError` and the `api.timedOut` message.
- `download` (the JSON and CSV exports, both GETs, and the CSV report POSTs) runs under a deadline based on progress instead (`withProgressDeadline`, `DOWNLOAD_DEADLINE_MS`): the reply must start within the 5 min transfer deadline, then each piece of the body must arrive within 60 s of the one before. The server streams exports at the pace the client reads, so a fixed total failed large exports on slow links. Exports stay on fetch rather than a browser-followed `a[href]` download, although a GET needs no CSRF header and the cookie would go along. A followed link would lose the toasts users see today for a refusal before the first byte (403 for a lost session, 503 `Download took too long` from a full download lane), and `ExportData` could not tell when the file is done to re-enable its buttons. The cost: the whole file is held in memory as a Blob before it is saved.
- GET query functions forward TanStack's `signal` (`queryFn: ({ signal }) => api.get(path, { signal, … })`), so a read that a refetch replaces or that no view observes any more is aborted. A cancel keeps its `AbortError`, so TanStack still treats the query as cancelled, not failed. Do not forward the signal to a POST, report queries included: an aborted POST looks like a write whose outcome is unknown, and the e2e guard fails on it.
- A timer write that times out is treated as one that got no reply: `explainTimerActionError` turns `RequestTimeoutError` into the `offline` `TimerActionError`. It, a 5xx and a 2xx reply that does not parse or decode leave the outcome unknown, and the next timer write reads the timer state first (`timerWrite`, see `practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only`). `request` throws `UnparsableReplyError` (a `SyntaxError` with the parser's message) for a 2xx body that is not JSON.
- Preference saves (`savePreferencesOptions` in `api/account.ts`) share the mutation scope `preferences`, so TanStack sends them one at a time in the order made; a queued one is `isPaused` until the one before it settles. `createPreferenceSaves` (`api/preferenceSaves.ts`, one per QueryClient) keeps the cache at the latest server reply with the changes of the saves still waiting on top. A failed save drops only its own changes, so it can neither undo an earlier save that succeeded nor wipe a later change. Do not go back to snapshotting the whole object in `onMutate` and restoring it in `onError`. `api/account.test.ts` covers the interleavings.
- Edits of one entry share the mutation scope `entry:<id>` (`entryScope` and `updateEntry` in `api/entries.ts`), so two quick PUTs to the running entry, such as a description saved on blur and a project picked right after, go out in the order made. A scope is fixed per TanStack mutation, so `useUpdateEntry` and `useUpdateRunningEntry` build one mutation per edit (`MutationCache.build`) and return `mutate`/`mutateAsync` only; there is no `isPending`. A queued edit is `isPaused`, so `settleOtherWrites` (`api/timerState.ts`) fails a timer action as offline only for a paused write that is held for the connection (`isHeldForConnection`), and waits for one queued in its scope. `api/entries.test.ts` covers both.

<!-- Verified against the current code on 2026-11-08. -->
