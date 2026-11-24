# kenkeep Index: api-and-data / time-handling / stopped-entry-resolution

↑ Parent: [time-handling](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Timer stop snapping and duration limits**](practice-timer-stop-snapping-and-duration-limits.md) to learn about: Timer stops can trash zero spans, preserve switching boundaries and clamp the maximum duration. #server #timer #time
- Open [**Entry resolution at DST imports and reports**](practice-entry-resolution-at-dst-imports-and-reports.md) to learn about: DST changes, report rounding and exact imports have distinct resolution behavior and shared fixture coverage. #server #time #import
- Open [**Stopped entry grid validation**](practice-stopped-entry-grid-validation.md) to learn about: Stopped live entries use snapSpan and the instance grid; typed zero spans fail while unchanged spans remain editable. #server #time #entries

## Components (what exists)
_None yet._

## By topic

### #server
- Open [**Recheck credentials inside the guarded account transaction**](../../password-and-csrf-rules/password-attempt-limits/practice-recheck-credentials-inside-the-guarded-account-transaction.md) — Auth and PUT /me recheck the account and credential under the guarded transaction, so revocations during scrypt refuse stale credentials.
- Open [**Validate new passwords with parseNewPassword**](../../password-and-csrf-rules/password-attempt-limits/practice-validate-new-passwords-with-parsenewpassword.md) — New passwords are 8-1024 characters and go through parseNewPassword; current passwords are not capped on login or rotation.
- Open [**Verify passwords only through FailureLimiter.attempt**](../../password-and-csrf-rules/password-attempt-limits/practice-verify-passwords-only-through-failurelimiter-attempt.md) — Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly.
### #time
- Open [**Parse incoming timestamps with parseInstant**](../practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Timer stop snapping and duration limits**](practice-timer-stop-snapping-and-duration-limits.md) — Timer stops can trash zero spans, preserve switching boundaries and clamp the maximum duration.
- Open [**Stopped entry grid validation**](practice-stopped-entry-grid-validation.md) — Stopped live entries use snapSpan and the instance grid; typed zero spans fail while unchanged spans remain editable.
### #entries
- Open [**Web previews and the entry editor show the snapped duration**](../../../web-ui-behaviour/time-and-timers/practice-web-previews-and-editor-show-snapped-durations.md) — Previews use snappedSeconds and snappedInstant with the /me resolution; toasts and chained starts use the server-returned entry.
- Open [**Stopped entry grid validation**](practice-stopped-entry-grid-validation.md) — Stopped live entries use snapSpan and the instance grid; typed zero spans fail while unchanged spans remain editable.
### #import
- Open [**Entry resolution at DST imports and reports**](practice-entry-resolution-at-dst-imports-and-reports.md) — DST changes, report rounding and exact imports have distinct resolution behavior and shared fixture coverage.
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](../../toggl-compat-and-import/practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
- Open [**Toggl CSV import: choose team-export users by opaque key**](../../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
### #timer
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**acceptTimerState: one validated entry for every web timer state**](../../../web-ui-behaviour/pomodoro/web-timer-state/map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md) — Every web timer state passes isTimerState and acceptTimerState: revision check, cache writes, stale.timerChanged and server clock offset.