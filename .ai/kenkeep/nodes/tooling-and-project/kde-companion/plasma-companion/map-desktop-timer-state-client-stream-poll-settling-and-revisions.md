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
`TimerStateClient` (`desktop/core/src/timerstateclient.h`) holds the account's timer state for the KDE widget, the macOS app and GNOME's `tokkl-timerd`. Each app builds one through the core's `TimerStack` (`desktop/core/src/timerstack.h`; KDE through `KdeTimerState`, QML type `TokklTimerState`), and both `TimerController` and `PomodoroSession` (as a `SessionState`) take it and show what it holds: the running entry, the pause chain and the Pomodoro session. A device keeps only the Pomodoro mode and the sound choices.

When the connection becomes Connected, the client reads `GET /api/app/timer` and opens `GET /api/app/timer/events`. Within a connection generation it ignores a state older than the one held; a new generation (another instance, account or secret, or a sign-out) drops the state, its revision and the stream. When a stream ends the client reads the state again if the stream had delivered, and reconnects after a wait that starts at 1 s and doubles to 60 s, plus up to a quarter more at random (`retryWaitMs()` in `clock.h`, which the unknown-outcome resend of a keyed start uses too). A stream that delivered for 60 s resets the wait. The stream's `retry:` field (ASCII digits, milliseconds) is the shortest wait from then on in that generation (`readRetry()`, `m_retryFloorMs`): the wait is the larger of the backoff and that floor, the floor counts at most 60 s, and the jitter comes on top. A timer event that does not decode to a state, also after good ones, drops the stream (`dropUnreadableStream`): the state is read at once, polled until a stream delivers again, and the next stream opens after the next wait, so keep-alives cannot hold an unreadable stream open. Until a stream delivers, the state is read every 30 s (`pollIntervalMs`). The client is the one place that detects a wake: a tick more than 10 s late, or `resumed()` from the platform (only macOS calls it, from `NSWorkspaceDidWakeNotification`). A wake reads at once, replaces the stream and emits `SessionState::woke()`, which the controller follows with a catalog revision check and the session with a countdown update. One sleep reported both ways counts once: `resumed()` resets the tick gap, and `resumed()` within 10 s of a wake does nothing (`wakeNoticeBeforeTheLateTickCountsOnce`, `sleepGapKeepsTimeAndRefreshes`). A stream that sends more than 1 MiB for one event, counted line by line from the end of the event before as the bytes arrive, is dropped before the event is parsed (`maxEventBytes`, `oversizedEventIsNotParsed`). Ordinary answers have a limit of their own in `NetworkTransport` (`maxResponseBytes`, 16 MiB): a body that announces or sends more is aborted while it arrives and ends as a NetworkError without a body, so a write's outcome is then unknown. The largest real answer, a page of 200 projects, stays far below it.

Actions (`start`, `stop`, `pause`, `resume`, `discard`, `edit`, `startPomodoro`, `nextPhase`, `endPomodoro`) go through the client, which adopts the state they return, or on a 409 the server's current state. Every action but `edit` takes a revision: it sends the one held and is refused without sending while no state is held. `pause` and `startPomodoro` are among them. `edit` names the running entry (`entry_id`) instead. `start` and `startPomodoro` carry an `Idempotency-Key` and, after an unknown outcome, go out once more with the same body and key inside `Connection` (`ApiClient::keyedAction()`). After an unknown outcome (no answer, timeout, 5xx, unreadable body) that remains, the client sends nothing again. It is settling until a read sent after the outcome brings a state; a read already on its way does not count, because the server may have answered it before the action. While settling, a failed read is retried every 30 s, also while the stream delivers. Controllers stay busy while `settling()` is true. A write that was in flight when the workspace was lost calls `settle()` for the same effect.

`serverNow()` is this device's clock corrected by the offset from the `server_time` of the state held (`serverOffsetMs()`). Countdowns and elapsed time use it, so a skewed clock shows the same time as the web app. `tokkl-timerd` publishes the running entry's start corrected by the same offset as `LocalStartTime`. While the instance is unreachable, the client keeps the last state, so a running session keeps counting and ringing from it, and every action that needs the server fails with the connection's message.

<!-- kk:related:start -->
# Related

- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro](../../../api-and-data/timer-state/map-timer-state-service-settlement-revision-and-discarded-pomodoro.md)
- Related: [map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap](../../../api-and-data/timer-state/map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap.md)
- Related: [practice-kde-timer-controller-rules](../practice-kde-timer-controller-rules.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
<!-- kk:related:end -->
