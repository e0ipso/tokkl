# kenkeep Index: api-and-data / timer-state

↑ Parent: [api-and-data](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`timer-event-stream/`](timer-event-stream/index.md) for more information on the timer Server-Sent Events stream: protocol, keep-alive, credential checks, caps, delivery order and slow clients; read when changing GET /api/app/timer/events, timer publication or a route that ends a credential.
- Load [`timer-state-service/`](timer-state-service/index.md) for more information on the server timer state service: settlement, touchTimer, timer and Pomodoro actions, status capabilities and stop membership checks; read before changing a timer action or any write that touches the running entry.

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**TimerBus: cross-instance timer delivery to SSE streams**](map-timerbus-cross-instance-timer-delivery-to-sse-streams.md) to learn about: TimerBus carries {userId, revision} signals between API processes (PostgreSQL LISTEN/NOTIFY); receivers rebuild timer state from the DB. #api #timer #sse #multi-instance #postgres

## By topic

### #api
- Open [**Asynchronous ordered timer delivery after commit**](timer-event-stream/map-asynchronous-ordered-timer-delivery-after-commit.md) — A timer write enqueues its state on an ordered per-user queue after commit and never waits for stream delivery.
- Open [**Timer event stream protocol, keep-alive and proxy requirements**](timer-event-stream/map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md) — GET /api/app/timer/events sends full state on connect and change, a keep-alive event every 25 s, and needs unbuffered proxies.
- Open [**Timer stream backpressure for slow clients**](timer-event-stream/map-timer-stream-backpressure-for-slow-clients.md) — A full socket makes a timer stream wait up to 30 s for drain; more than 64 KiB unsent ends the stream.
### #multi-instance
- Open [**TimerBus: cross-instance timer delivery to SSE streams**](map-timerbus-cross-instance-timer-delivery-to-sse-streams.md) — TimerBus carries {userId, revision} signals between API processes (PostgreSQL LISTEN/NOTIFY); receivers rebuild timer state from the DB.
### #postgres
- Open [**TimerBus: cross-instance timer delivery to SSE streams**](map-timerbus-cross-instance-timer-delivery-to-sse-streams.md) — TimerBus carries {userId, revision} signals between API processes (PostgreSQL LISTEN/NOTIFY); receivers rebuild timer state from the DB.
### #sse
- Open [**Asynchronous ordered timer delivery after commit**](timer-event-stream/map-asynchronous-ordered-timer-delivery-after-commit.md) — A timer write enqueues its state on an ordered per-user queue after commit and never waits for stream delivery.
- Open [**Timer event stream protocol, keep-alive and proxy requirements**](timer-event-stream/map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md) — GET /api/app/timer/events sends full state on connect and change, a keep-alive event every 25 s, and needs unbuffered proxies.
- Open [**Timer stream backpressure for slow clients**](timer-event-stream/map-timer-stream-backpressure-for-slow-clients.md) — A full socket makes a timer stream wait up to 30 s for drain; more than 64 KiB unsent ends the stream.
### #timer
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**acceptTimerState: one validated entry for every web timer state**](../../web-ui-behaviour/pomodoro/web-timer-state/map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md) — Every web timer state passes isTimerState and acceptTimerState: revision check, cache writes, stale.timerChanged and server clock offset.