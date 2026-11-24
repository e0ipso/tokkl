---
type: map
title: 'acceptTimerState: one validated entry for every web timer state'
description: >-
  Every web timer state passes isTimerState and acceptTimerState: revision
  check, cache writes, stale.timerChanged and server clock offset.
tags:
  - web
  - timer
  - sse
kk_schema_version: 3
kk_id: map-accepttimerstate-one-validated-entry-for-every-web-timer-state
kk_derived_from: []
kk_relates_to:
  - map-timer-state-service-settlement-revision-and-discarded-pomodoro
  - map-web-timer-event-stream-up-and-down-tracking-polling-fallback-and-backoff
kk_depends_on: []
kk_confidence: high
---
`acceptTimerState` in `packages/web/src/api/timerHooks.ts` is the single entry for every timer state, whether it came from the stream, a poll or an action reply. Every state is first checked whole by `isTimerState` (`api/timerState.ts`): revision (a safe integer), server time (an RFC 3339 instant), and the running entry, pause chain, session and discarded pomodoro each null or of their full shape, their ids whole numbers and their times instants. A malformed HTTP reply, from the poll or an action, fails that request with `timer.unreadableState` and leaves the caches alone; a stream event that is not JSON or not a whole state counts the stream as down (see `map-web-timer-event-stream-up-and-down-tracking-polling-fallback-and-backoff`); a 409 whose body is not a whole state stays a plain `ApiError` rather than a conflict. `acceptTimerState` drops a state with a lower revision than the cached one, writes the state and the clock offset into the caches, and, when the revision moved, invalidates `stale.timerChanged` from `api/keys.ts`: the entry lists, reports, trash, project and task totals and tags. `stale.entries`, which every entry write from the tab uses, is the same list plus the timer state, so a change from the stream and one from this tab refresh the same derived data. Only active queries refetch at once; the rest refetch when next observed.

The running entry has no query of its own. `useCurrentEntry` (`timerHooks.ts`) selects `running_entry` from the timer query, so the revision check guards it too and a slow reply can never put back an entry a newer state replaced. The web app never calls `GET /api/v9/me/time_entries/current`. Catalog writes that change what the running entry shows (`stale.clients`, `stale.projects`, `stale.tags` and the others in `api/keys.ts`) refresh `keys.timer`. The timer query has `staleTime: 1000`, so a focus less than a second after a pushed state reads nothing; e2e focus checks wait that second out.

The state also carries `server_time`; `serverClock.ts` keeps the offset from the latest state, and `useServerNow` gives countdowns the server's time instead of the device's.

<!-- kk:related:start -->
# Related

- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-server-api-capabilities-and-pomodoro-limits-in-api-app-status](../../../api-and-data/timer-state/timer-state-service/map-server-api-capabilities-and-pomodoro-limits-in-api-app-status.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-stoprunningentry-workspace-membership-check-on-every-stop](../../../api-and-data/timer-state/timer-state-service/map-stoprunningentry-workspace-membership-check-on-every-stop.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-and-pomodoro-actions-revision-checks-and-optional-revision](../../../api-and-data/timer-state/timer-state-service/map-timer-and-pomodoro-actions-revision-checks-and-optional-revision.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-settlement-and-revision-fingerprint](../../../api-and-data/timer-state/timer-state-service/map-timer-settlement-and-revision-fingerprint.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-timer-start-stop-and-edit-routes](../../../api-and-data/timer-state/timer-state-service/map-timer-start-stop-and-edit-routes.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro → map-touchtimer-settled-reads-and-catalog-timer-effects](../../../api-and-data/timer-state/timer-state-service/map-touchtimer-settled-reads-and-catalog-timer-effects.md)
- Related: [map-web-timer-event-stream-up-and-down-tracking-polling-fallback-and-backoff](map-web-timer-event-stream-up-and-down-tracking-polling-fallback-and-backoff.md)
<!-- kk:related:end -->
