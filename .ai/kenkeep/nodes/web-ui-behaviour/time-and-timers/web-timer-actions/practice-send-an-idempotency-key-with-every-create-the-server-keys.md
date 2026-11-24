---
type: practice
title: Send an Idempotency-Key with every create the server keys
description: >-
  Keyed creates send an Idempotency-Key, retry once with the same key after a
  jittered wait, and reuse the key for 23 hours.
tags:
  - web
  - timer
  - idempotency
kk_schema_version: 3
kk_id: practice-send-an-idempotency-key-with-every-create-the-server-keys
kk_derived_from: []
kk_relates_to:
  - practice-creates-take-an-idempotency-key
  - >-
    practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome
kk_depends_on: []
kk_confidence: high
---
Every create the server keys carries an `Idempotency-Key` header: v9 creates of entries, clients, projects, tasks and tags, the entry split, timer start and Pomodoro start. They go through `postCreate` or `sendCreate` in `api/idempotency.ts`; a new create the server keys must too. One key stands for one user intent. A create whose outcome is unknown (`isOutcomeUnknown`) goes out once more with the same body and key after one jittered wait (`retryWaitMs`: 1 s plus up to 250 ms, as the desktop app waits), inside the same `timerWrite` for the timer starts and the typed entry, so only a second unknown outcome marks the timer. Sent at once, the retry usually met the same dropped network. The wait is a plain `setTimeout` with `Math.random` jitter, so tests drive it with `t.mock.timers` and `t.mock.method(Math, 'random', ...)`. The retry is part of the write, which is never cancelled once sent, so it does not stop when the view that sent it goes away. From the first unknown outcome on, the key is kept for that exact request (method, path and JSON body) for 23 hours, under the server's 24, so the same request sent again, during the wait or after the retry failed too, such as Save clicked again on the form the error left open, is answered with the record the lost one made. Each new intent forgets every kept key past its 23 hours, so keys of creates nobody sent again do not pile up for the life of the tab. Any reply, a refusal included, settles the intent, and an identical create after it gets a new key, so adding the same duration twice on purpose stores two entries. Keys are 32 hex characters from `crypto.getRandomValues`; `crypto.randomUUID` needs a secure context, and an instance may be served over plain HTTP. Do not go back to guessing whether a lost create landed by diffing lists. `api/idempotency.test.ts` covers the key reuse. `api/timerHooks.test.ts` covers the Start and Stop requests, the adopted conflict state and the reconciling read.

<!-- kk:related:start -->
# Related

- Related: [practice-creates-take-an-idempotency-key](../../../api-and-data/toggl-compat-and-import/practice-creates-take-an-idempotency-key.md)
- Related: [practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome](practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md)
<!-- kk:related:end -->
