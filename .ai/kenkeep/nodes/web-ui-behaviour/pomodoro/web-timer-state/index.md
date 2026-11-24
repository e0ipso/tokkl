# kenkeep Index: web-ui-behaviour / pomodoro / web-timer-state

↑ Parent: [pomodoro](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**acceptTimerState: one validated entry for every web timer state**](map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md) to learn about: Every web timer state passes isTimerState and acceptTimerState: revision check, cache writes, stale.timerChanged and server clock offset. #web #timer #sse
- Open [**Web timer event stream: up and down tracking, polling fallback and backoff**](map-web-timer-event-stream-up-and-down-tracking-polling-fallback-and-backoff.md) to learn about: One EventSource per tab; up only after a well-formed state; 30 s poll while down; jittered reconnect backoff from 5 s up to 60 s. #web #timer #sse
- Open [**PomodoroSessionProvider: a tab-side view of the server's Pomodoro session**](map-pomodorosessionprovider-a-tab-side-view-of-the-server-s-pomodoro-session.md) to learn about: PomodoroSessionProvider shows state.pomodoro, rings and notifies; actions only post to the server; the browser stores no session state. #web #pomodoro #timer

## By topic

### #timer
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**acceptTimerState: one validated entry for every web timer state**](map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md) — Every web timer state passes isTimerState and acceptTimerState: revision check, cache writes, stale.timerChanged and server clock offset.
### #web
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](../../time-and-timers/web-timer-actions/practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.
### #sse
- Open [**Asynchronous ordered timer delivery after commit**](../../../api-and-data/timer-state/timer-event-stream/map-asynchronous-ordered-timer-delivery-after-commit.md) — A timer write enqueues its state on an ordered per-user queue after commit and never waits for stream delivery.
- Open [**Timer event stream protocol, keep-alive and proxy requirements**](../../../api-and-data/timer-state/timer-event-stream/map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md) — GET /api/app/timer/events sends full state on connect and change, a keep-alive event every 25 s, and needs unbuffered proxies.
- Open [**Timer stream backpressure for slow clients**](../../../api-and-data/timer-state/timer-event-stream/map-timer-stream-backpressure-for-slow-clients.md) — A full socket makes a timer stream wait up to 30 s for drain; more than 64 KiB unsent ends the stream.
### #pomodoro
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](../../time-and-timers/web-timer-actions/practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.
- Open [**PomodoroSessionProvider: a tab-side view of the server's Pomodoro session**](map-pomodorosessionprovider-a-tab-side-view-of-the-server-s-pomodoro-session.md) — PomodoroSessionProvider shows state.pomodoro, rings and notifies; actions only post to the server; the browser stores no session state.
- Open [**Send the cached revision with every timer action and adopt the reply**](../../time-and-timers/web-timer-actions/practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply.md) — Timer and Pomodoro actions send the cached revision; replies and 409 bodies go through acceptTimerState; failures are TimerActionError.