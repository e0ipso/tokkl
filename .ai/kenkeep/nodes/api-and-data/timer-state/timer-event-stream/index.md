# kenkeep Index: api-and-data / timer-state / timer-event-stream

↑ Parent: [timer-state](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**Asynchronous ordered timer delivery after commit**](map-asynchronous-ordered-timer-delivery-after-commit.md) to learn about: A timer write enqueues its state on an ordered per-user queue after commit and never waits for stream delivery. #api #timer #sse
- Open [**Timer stream credential checks and recheck after credential changes**](map-timer-stream-credential-checks-and-recheck-after-credential-changes.md) to learn about: Each timer stream keeps re-checking the credential that opened it, shared per credential key; credential-ending routes call recheck. #api #timer #sse #auth
- Open [**Timer event stream protocol, keep-alive and proxy requirements**](map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md) to learn about: GET /api/app/timer/events sends full state on connect and change, a keep-alive event every 25 s, and needs unbuffered proxies. #api #timer #sse
- Open [**Timer stream backpressure for slow clients**](map-timer-stream-backpressure-for-slow-clients.md) to learn about: A full socket makes a timer stream wait up to 30 s for drain; more than 64 KiB unsent ends the stream. #api #timer #sse
- Open [**Timer stream admission caps and shared publish**](map-timer-stream-admission-caps-and-shared-publish.md) to learn about: Timer streams cap at 10 per user and 1000 per process; one hub subscription per user; a publish builds state once. #api #timer #sse

## By topic

### #api
- Open [**Asynchronous ordered timer delivery after commit**](map-asynchronous-ordered-timer-delivery-after-commit.md) — A timer write enqueues its state on an ordered per-user queue after commit and never waits for stream delivery.
- Open [**Timer event stream protocol, keep-alive and proxy requirements**](map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md) — GET /api/app/timer/events sends full state on connect and change, a keep-alive event every 25 s, and needs unbuffered proxies.
- Open [**Timer stream backpressure for slow clients**](map-timer-stream-backpressure-for-slow-clients.md) — A full socket makes a timer stream wait up to 30 s for drain; more than 64 KiB unsent ends the stream.
### #sse
- Open [**Asynchronous ordered timer delivery after commit**](map-asynchronous-ordered-timer-delivery-after-commit.md) — A timer write enqueues its state on an ordered per-user queue after commit and never waits for stream delivery.
- Open [**Timer event stream protocol, keep-alive and proxy requirements**](map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md) — GET /api/app/timer/events sends full state on connect and change, a keep-alive event every 25 s, and needs unbuffered proxies.
- Open [**Timer stream backpressure for slow clients**](map-timer-stream-backpressure-for-slow-clients.md) — A full socket makes a timer stream wait up to 30 s for drain; more than 64 KiB unsent ends the stream.
### #timer
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**acceptTimerState: one validated entry for every web timer state**](../../../web-ui-behaviour/pomodoro/web-timer-state/map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md) — Every web timer state passes isTimerState and acceptTimerState: revision check, cache writes, stale.timerChanged and server clock offset.
### #auth
- Open [**Recheck credentials inside the guarded account transaction**](../../password-and-csrf-rules/password-attempt-limits/practice-recheck-credentials-inside-the-guarded-account-transaction.md) — Auth and PUT /me recheck the account and credential under the guarded transaction, so revocations during scrypt refuse stale credentials.
- Open [**Validate new passwords with parseNewPassword**](../../password-and-csrf-rules/password-attempt-limits/practice-validate-new-passwords-with-parsenewpassword.md) — New passwords are 8-1024 characters and go through parseNewPassword; current passwords are not capped on login or rotation.
- Open [**Verify passwords only through FailureLimiter.attempt**](../../password-and-csrf-rules/password-attempt-limits/practice-verify-passwords-only-through-failurelimiter-attempt.md) — Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly.