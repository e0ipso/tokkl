---
type: map
title: 'Web timer state: one stream per tab, server-corrected clock and Pomodoro views'
description: >-
  TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views
  the server's session, rings and notifies; nothing is kept in localStorage.
tags:
  - web
  - pomodoro
  - timer
  - sse
kk_schema_version: 3
kk_id: map-web-timer-state-stream-and-pomodoro-session-views
kk_derived_from: []
kk_relates_to:
  - map-timer-state-service-settlement-revision-and-discarded-pomodoro
  - map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap
  - map-pomodoro-session-model-in-packages-common-pomodorosession
  - map-pomodoro-cycle-functions-in-packages-common
  - map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider
  - practice-end-sessions-through-lib-session
kk_depends_on: []
kk_confidence: high
---
`TimerStateProvider` (`packages/web/src/api/TimerStateProvider.tsx`) opens one `EventSource` on `/api/app/timer/events` per tab, keyed by `me.id`, through `connectTimerStream` in `timerStream.ts`. Each `timer` event goes through `acceptTimerState` in `timerHooks.ts`, the single entry for every state, whether it came from the stream, a poll or an action reply. Every state is first checked whole by `timerStateReply` (`api/replies.ts`, built from the `decode.ts` helpers): revision (a safe integer), server time (an RFC 3339 instant), and the running entry, pause chain, session and discarded pomodoro each null or of their full shape, their ids whole numbers and their times instants. A malformed HTTP reply, from the poll or an action, fails that request with `timer.unreadableState` and leaves the caches alone; a stream event that is not JSON or not a whole state counts the stream as down (below); a 409 whose body is not a whole state stays a plain `ApiError` rather than a conflict. `acceptTimerState` drops a state with a lower revision than the cached one, writes the state and the clock offset into the caches, and, when the revision moved, invalidates `stale.timerChanged` from `api/keys.ts`: the entry lists, reports, trash, project and task totals and tags. `stale.entries`, which every entry write from the tab uses, is the same list plus the timer state, so a change from the stream and one from this tab refresh the same derived data. Only active queries refetch at once; the rest refetch when next observed.

The running entry has no query of its own. `useCurrentEntry` (`timerHooks.ts`) selects `running_entry` from the timer query, so the revision check guards it too and a slow reply can never put back an entry a newer state replaced. The web app never calls `GET /api/v9/me/time_entries/current`. Catalog writes that change what the running entry shows (`stale.clients`, `stale.projects`, `stale.tags` and the others in `api/keys.ts`) refresh `keys.timer`. The timer query has `staleTime: 1000`, so a focus less than a second after a pushed state reads nothing; e2e focus checks wait that second out.

`useTimerState` polls `GET /api/app/timer` every 30 s only while the stream is down, and refetches on focus. The stream reports up and down through `TimerStreamingContext`. The stream counts as up only from the first well-formed state a connection delivers (the server sends one right after the headers), not when it opens. It counts as down when it errs, when a `timer` event does not decode, or when it stays silent for 60 s. When the browser gives up after an error status (`readyState` CLOSED), and after an event that does not decode, `connectTimerStream` closes the source and opens a new one after `retryDelay`: a random wait between 5 s and a ceiling that starts at 10 s and doubles with each failure in a row, capped at 60 s. A well-formed state resets the count. The 5 s floor matches the `Retry-After: 5` the server sends when its stream cap is full; `EventSource` exposes neither the status nor the headers of a refused connection, so the client cannot read the header itself. Replacing `EventSource` with a fetch reader would break the e2e helpers that wrap `window.EventSource` (`watchTimerTraffic`). `timerStream.test.ts` checks the schedule with an injected `random`. A silent source is replaced at once. Keep-alives restart the 60 s wait only on a connection that has already delivered a state, so one that only sends keep-alives does not pass for working. `api/timerStream.test.ts` drives this state machine with a fake `EventSource`. A stream that went down, or ended, triggers a read of the state, so a 403 there (credential gone) reaches `/me`. The state also carries `server_time`; `serverClock.ts` keeps the offset from the latest state, and `useServerNow` gives countdowns the server's time instead of the device's.

`PomodoroSessionProvider` (`components/PomodoroSessionProvider.tsx`) is a view of `state.pomodoro` plus what only a tab can do. It owns the alarm (`pomodoroSessionAlarm.ts`), the phase-end notification (`notifySessionPhaseEnd`) and the "This pomodoro was too short to save." toast, raised once per new `discarded_pomodoro` (`createDiscardNotices`). `start`, `nextPhase` and `end` only post to the server (`useStartPomodoro`, `useNextPhase`, `useEndPomodoro`); the server applies every session rule. A start sends the form's lengths as `work_minutes` and the other three fields for that session only, never writing preferences, and the cached revision, so a start against a timer that moved on gets a 409 whose state is adopted. The `/pomodoro` page (`pages/PomodoroPage.tsx`, with its parts in `pages/pomodoro/`) and `PomodoroSessionBanner` read this provider, so a session started on any device shows in every tab. The rings, countdown and overtime come from `phase.planned_end` and the server-corrected clock.

The browser keeps nothing about sessions or pauses: no `localStorage` keys, no Web Lock for saves, no retry queue. The only Web Lock left is the per-account audio lock in the alarm. Signing out clears the Query cache and leaves the session running on the server (see `practice-end-sessions-through-lib-session`). Actions need a connection; with none, an action fails at once with the offline message, while an active session keeps counting and ringing from the last state held.

<!-- kk:related:start -->
# Related

- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro](../../api-and-data/timer-state/map-timer-state-service-settlement-revision-and-discarded-pomodoro.md)
- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap](../../api-and-data/timer-state/map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap.md)
- Related: [map-pomodoro-session-model-in-packages-common-pomodorosession](map-pomodoro-session-model-in-packages-common-pomodorosession.md)
- Related: [map-pomodoro-cycle-functions-in-packages-common](map-pomodoro-cycle-functions-in-packages-common.md)
- Related: [map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md)
- Related: [practice-end-sessions-through-lib-session](../interaction-and-state/practice-end-sessions-through-lib-session.md)
<!-- kk:related:end -->
