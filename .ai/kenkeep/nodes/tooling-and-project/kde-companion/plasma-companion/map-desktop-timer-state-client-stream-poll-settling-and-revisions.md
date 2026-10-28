---
type: map
title: 'Desktop TimerStateClient: stream, poll, settling and revisions'
description: >-
  One TimerStateClient per desktop app reads GET /api/app/timer, follows the
  event stream, polls only while it is down, and settles unknown write outcomes.
tags:
  - desktop
  - timer
  - sse
  - kde
  - gnome
  - macos
kk_schema_version: 3
kk_id: map-desktop-timer-state-client-stream-poll-settling-and-revisions
kk_derived_from: []
kk_relates_to:
  - map-timer-state-service-settlement-revision-and-discarded-pomodoro
  - map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap
  - practice-kde-timer-controller-rules
  - map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
kk_depends_on: []
kk_confidence: high
---
`TimerStateClient` (`desktop/core/src/timerstateclient.h`) holds the account's timer state for the KDE widget, the macOS app and GNOME's `tokkl-timerd`. Each app builds one on its `Connection` (KDE through `KdeTimerState`, QML type `TokklTimerState`), and both `TimerController` and `PomodoroSession` take it and show what it holds: the running entry, the pause chain and the Pomodoro session. A device keeps only the Pomodoro mode and the sound choices.

When the connection becomes Connected, the client reads `GET /api/app/timer` and opens `GET /api/app/timer/events`. Within a connection generation it ignores a state older than the one held; a new generation (another instance, account or secret, or a sign-out) drops the state, its revision and the stream. When a stream ends the client reads the state again if the stream had delivered, and reconnects after a wait that starts at 1 s and doubles to 60 s. A stream that delivered for 60 s resets the wait. Until a stream delivers, the state is read every 30 s (`pollIntervalMs`). A wake (`resumed()`, or a tick more than 10 s late) reads at once and replaces the stream. A stream that sends more than 1 MiB without an event end is dropped.

Actions (`pause`, `resume`, `discard`, `startPomodoro`, `nextPhase`, `endPomodoro`) go through the client, which adopts the state they return, or on a 409 the server's current state. Those that take a revision send the one held and are refused without sending while no state is held. After an unknown outcome (no answer, timeout, 5xx, unreadable body) the client never sends the action again. It is settling until a read sent after the outcome brings a state; a read already on its way does not count, because the server may have answered it before the action. While settling, a failed read is retried every 30 s, also while the stream delivers. Controllers stay busy while `settling()` is true. A write made elsewhere, such as a v9 start, calls `settle()` for the same effect.

`serverNow()` is this device's clock corrected by the offset from the `server_time` of the state held. Countdowns and elapsed time use it, so a skewed clock shows the same time as the web app. While the instance is unreachable, the client keeps the last state, so a running session keeps counting and ringing from it, and every action that needs the server fails with the connection's message.

<!-- kk:related:start -->
# Related

- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro](../../../api-and-data/timer-state/map-timer-state-service-settlement-revision-and-discarded-pomodoro.md)
- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap](../../../api-and-data/timer-state/map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap.md)
- Related: [practice-kde-timer-controller-rules](../practice-kde-timer-controller-rules.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
<!-- kk:related:end -->
