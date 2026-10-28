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
`TimerStateProvider` (`packages/web/src/api/TimerStateProvider.tsx`) opens one `EventSource` on `/api/app/timer/events` per tab, keyed by `me.id`, through `connectTimerStream` in `timerStream.ts`. Each `timer` event goes through `acceptTimerState` in `timerHooks.ts`, the single entry for every state, whether it came from the stream, a poll or an action reply. It drops a state with a lower revision than the cached one, writes the state, the running entry and the clock offset into the caches, and invalidates the entry, report and trash queries when the revision moved.

`useTimerState` polls `GET /api/app/timer` every 30 s only while the stream is down, and refetches on focus. The stream reports up and down through `TimerStreamingContext`. When the browser gives up after an error status (`readyState` CLOSED), `connectTimerStream` opens a new source after 5 s. An open source that delivers no `timer` or `keep-alive` event for 60 s counts as down and is replaced at once. A stream that went down, or ended, triggers a read of the state, so a 403 there (credential gone) reaches `/me`. The state also carries `server_time`; `serverClock.ts` keeps the offset from the latest state, and `useServerNow` gives countdowns the server's time instead of the device's.

`PomodoroSessionProvider` (`components/PomodoroSessionProvider.tsx`) is a view of `state.pomodoro` plus what only a tab can do. It owns the alarm (`pomodoroSessionAlarm.ts`), the phase-end notification (`notifySessionPhaseEnd`) and the "This pomodoro was too short to save." toast, raised once per new `discarded_pomodoro` (`createDiscardNotices`). `start`, `nextPhase` and `end` only post to the server (`useStartPomodoro`, `useNextPhase`, `useEndPomodoro`); the server applies every session rule. A start sends the form's lengths as `work_minutes` and the other three fields for that session only, never writing preferences. The `/pomodoro` page (`pages/PomodoroPage.tsx`) and `PomodoroSessionBanner` read this provider, so a session started on any device shows in every tab. The rings, countdown and overtime come from `phase.planned_end` and the server-corrected clock.

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
