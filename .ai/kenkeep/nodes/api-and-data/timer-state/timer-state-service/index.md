# kenkeep Index: api-and-data / timer-state / timer-state-service

↑ Parent: [timer-state](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**Timer settlement and revision fingerprint**](map-timer-settlement-and-revision-fingerprint.md) to learn about: settleTimer keeps the running entry, pause chain and Pomodoro session consistent and bumps the revision when the fingerprint changes. #api #timer #pomodoro #pause
- Open [**Timer and Pomodoro actions: revision checks and optional revision**](map-timer-and-pomodoro-actions-revision-checks-and-optional-revision.md) to learn about: Timer actions build one reply at commit; stale revisions get a 409 StateConflict; OPTIONAL_REVISION_ACTIONS lists the exceptions. #api #timer #pomodoro #pause
- Open [**Timer start, stop and edit routes**](map-timer-start-stop-and-edit-routes.md) to learn about: POST /api/app/timer/start, stop and edit take a revision or entry_id precondition and answer the committed TimerState. #api #timer
- Open [**touchTimer, settled reads and catalog timer effects**](map-touchtimer-settled-reads-and-catalog-timer-effects.md) to learn about: Writes that can change a running entry call touchTimer; reads settle in a snapshot; catalog writes use catalog timer effects. #api #timer
- Open [**stopRunningEntry: workspace membership check on every stop**](map-stoprunningentry-workspace-membership-check-on-every-stop.md) to learn about: Every path that stops the running entry goes through stopRunningEntry, which checks workspace membership first. #api #timer
- Open [**Server API capabilities and Pomodoro limits in /api/app/status**](map-server-api-capabilities-and-pomodoro-limits-in-api-app-status.md) to learn about: GET /api/app/status names api_version, capabilities clients probe for, and pomodoro_limits from packages/common. #api #pomodoro

## By topic

### #api
- Open [**Asynchronous ordered timer delivery after commit**](../timer-event-stream/map-asynchronous-ordered-timer-delivery-after-commit.md) — A timer write enqueues its state on an ordered per-user queue after commit and never waits for stream delivery.
- Open [**Timer event stream protocol, keep-alive and proxy requirements**](../timer-event-stream/map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md) — GET /api/app/timer/events sends full state on connect and change, a keep-alive event every 25 s, and needs unbuffered proxies.
- Open [**Timer stream backpressure for slow clients**](../timer-event-stream/map-timer-stream-backpressure-for-slow-clients.md) — A full socket makes a timer stream wait up to 30 s for drain; more than 64 KiB unsent ends the stream.
### #timer
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**acceptTimerState: one validated entry for every web timer state**](../../../web-ui-behaviour/pomodoro/web-timer-state/map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md) — Every web timer state passes isTimerState and acceptTimerState: revision check, cache writes, stale.timerChanged and server clock offset.
### #pomodoro
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.
- Open [**PomodoroSessionProvider: a tab-side view of the server's Pomodoro session**](../../../web-ui-behaviour/pomodoro/web-timer-state/map-pomodorosessionprovider-a-tab-side-view-of-the-server-s-pomodoro-session.md) — PomodoroSessionProvider shows state.pomodoro, rings and notifies; actions only post to the server; the browser stores no session state.
- Open [**Send the cached revision with every timer action and adopt the reply**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply.md) — Timer and Pomodoro actions send the cached revision; replies and 409 bodies go through acceptTimerState; failures are TimerActionError.
### #pause
- Open [**Timer settlement and revision fingerprint**](map-timer-settlement-and-revision-fingerprint.md) — settleTimer keeps the running entry, pause chain and Pomodoro session consistent and bumps the revision when the fingerprint changes.
- Open [**Timer and Pomodoro actions: revision checks and optional revision**](map-timer-and-pomodoro-actions-revision-checks-and-optional-revision.md) — Timer actions build one reply at commit; stale revisions get a 409 StateConflict; OPTIONAL_REVISION_ACTIONS lists the exceptions.
- Open [**Send the cached revision with every timer action and adopt the reply**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply.md) — Timer and Pomodoro actions send the cached revision; replies and 409 bodies go through acceptTimerState; failures are TimerActionError.