# kenkeep Index: web-ui-behaviour / time-and-timers / web-timer-actions

↑ Parent: [time-and-timers](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) to learn about: After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved. #web #timer
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) to learn about: currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause. #web #timer #pomodoro
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) to learn about: Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict. #web #timer
- Open [**Send the cached revision with every timer action and adopt the reply**](practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply.md) to learn about: Timer and Pomodoro actions send the cached revision; replies and 409 bodies go through acceptTimerState; failures are TimerActionError. #web #timer #pause #pomodoro
- Open [**Send an Idempotency-Key with every create the server keys**](practice-send-an-idempotency-key-with-every-create-the-server-keys.md) to learn about: Keyed creates send an Idempotency-Key, retry once with the same key after a jittered wait, and reuse the key for 23 hours. #web #timer #idempotency
- Open [**Show the pause chain's fields read-only in the timer bar while paused**](practice-show-the-pause-chain-s-fields-read-only-in-the-timer-bar-while-paused.md) to learn about: While paused, the timer bar shows the chain's fields read-only and a frozen clock; pausing is refused during a session. #web #timer #pause

## Components (what exists)
_None yet._

## By topic

### #timer
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**acceptTimerState: one validated entry for every web timer state**](../../pomodoro/web-timer-state/map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md) — Every web timer state passes isTimerState and acceptTimerState: revision check, cache writes, stale.timerChanged and server clock offset.
### #web
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.
### #pause
- Open [**Timer settlement and revision fingerprint**](../../../api-and-data/timer-state/timer-state-service/map-timer-settlement-and-revision-fingerprint.md) — settleTimer keeps the running entry, pause chain and Pomodoro session consistent and bumps the revision when the fingerprint changes.
- Open [**Timer and Pomodoro actions: revision checks and optional revision**](../../../api-and-data/timer-state/timer-state-service/map-timer-and-pomodoro-actions-revision-checks-and-optional-revision.md) — Timer actions build one reply at commit; stale revisions get a 409 StateConflict; OPTIONAL_REVISION_ACTIONS lists the exceptions.
- Open [**Send the cached revision with every timer action and adopt the reply**](practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply.md) — Timer and Pomodoro actions send the cached revision; replies and 409 bodies go through acceptTimerState; failures are TimerActionError.
### #pomodoro
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.
- Open [**PomodoroSessionProvider: a tab-side view of the server's Pomodoro session**](../../pomodoro/web-timer-state/map-pomodorosessionprovider-a-tab-side-view-of-the-server-s-pomodoro-session.md) — PomodoroSessionProvider shows state.pomodoro, rings and notifies; actions only post to the server; the browser stores no session state.
- Open [**Send the cached revision with every timer action and adopt the reply**](practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply.md) — Timer and Pomodoro actions send the cached revision; replies and 409 bodies go through acceptTimerState; failures are TimerActionError.
### #idempotency
- Open [**Send an Idempotency-Key with every create the server keys**](practice-send-an-idempotency-key-with-every-create-the-server-keys.md) — Keyed creates send an Idempotency-Key, retry once with the same key after a jittered wait, and reuse the key for 23 hours.