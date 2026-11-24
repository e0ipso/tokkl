# kenkeep Index: api-and-data / time-handling

↑ Parent: [api-and-data](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`stopped-entry-resolution/`](stopped-entry-resolution/index.md) for more information on stopped-entry grid validation, timer stop limits, DST and exact import behavior; read before changing entry rounding or fixture times.

## Conventions (how we build)
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) to learn about: Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)). #server #validation #time #api
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](practice-time-zone-names-are-stored-in-canonical-form.md) to learn about: Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'. #api #time #validation

## Components (what exists)
- Open [**No-time manual entries (all_day)**](map-no-time-manual-entries-all-day.md) to learn about: Entries with all_day log a duration on a day: stored from local midnight, never running, re-anchored on a timezone change. #time-entries #api #web #timezones

## By topic

### #api
- Open [**Asynchronous ordered timer delivery after commit**](../timer-state/timer-event-stream/map-asynchronous-ordered-timer-delivery-after-commit.md) — A timer write enqueues its state on an ordered per-user queue after commit and never waits for stream delivery.
- Open [**Timer event stream protocol, keep-alive and proxy requirements**](../timer-state/timer-event-stream/map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md) — GET /api/app/timer/events sends full state on connect and change, a keep-alive event every 25 s, and needs unbuffered proxies.
- Open [**Timer stream backpressure for slow clients**](../timer-state/timer-event-stream/map-timer-stream-backpressure-for-slow-clients.md) — A full socket makes a timer stream wait up to 30 s for drain; more than 64 KiB unsent ends the stream.
### #time
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Timer stop snapping and duration limits**](stopped-entry-resolution/practice-timer-stop-snapping-and-duration-limits.md) — Timer stops can trash zero spans, preserve switching boundaries and clamp the maximum duration.
- Open [**Stopped entry grid validation**](stopped-entry-resolution/practice-stopped-entry-grid-validation.md) — Stopped live entries use snapSpan and the instance grid; typed zero spans fail while unchanged spans remain editable.
### #validation
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
### #server
- Open [**Recheck credentials inside the guarded account transaction**](../password-and-csrf-rules/password-attempt-limits/practice-recheck-credentials-inside-the-guarded-account-transaction.md) — Auth and PUT /me recheck the account and credential under the guarded transaction, so revocations during scrypt refuse stale credentials.
- Open [**Validate new passwords with parseNewPassword**](../password-and-csrf-rules/password-attempt-limits/practice-validate-new-passwords-with-parsenewpassword.md) — New passwords are 8-1024 characters and go through parseNewPassword; current passwords are not capped on login or rotation.
- Open [**Verify passwords only through FailureLimiter.attempt**](../password-and-csrf-rules/password-attempt-limits/practice-verify-passwords-only-through-failurelimiter-attempt.md) — Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly.
### #time-entries
- Open [**No-time manual entries (all_day)**](map-no-time-manual-entries-all-day.md) — Entries with all_day log a duration on a day: stored from local midnight, never running, re-anchored on a timezone change.
### #timezones
- Open [**No-time manual entries (all_day)**](map-no-time-manual-entries-all-day.md) — Entries with all_day log a duration on a day: stored from local midnight, never running, re-anchored on a timezone change.
### #web
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.