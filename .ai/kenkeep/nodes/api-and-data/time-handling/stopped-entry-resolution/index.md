# kenkeep Index: api-and-data / time-handling / stopped-entry-resolution

↑ Parent: [time-handling](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Entry resolution at DST imports and reports**](practice-entry-resolution-at-dst-imports-and-reports.md) to learn about: DST changes, report rounding and exact imports have distinct resolution behavior and shared fixture coverage. #server #time #import
- Open [**Stopped entry grid validation**](practice-stopped-entry-grid-validation.md) to learn about: Stopped live entries use snapSpan and the instance grid; typed zero spans fail while unchanged spans remain editable. #server #time #entries
- Open [**Timer stop snapping and duration limits**](practice-timer-stop-snapping-and-duration-limits.md) to learn about: Timer stops can trash zero spans, preserve switching boundaries and clamp the maximum duration. #server #timer #time

## Components (what exists)
_None yet._

## By topic

### #server
- Open [**Admin user management API and the last-active-admin rule**](../../users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Parse incoming timestamps with parseInstant**](../practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Entry resolution at DST imports and reports**](practice-entry-resolution-at-dst-imports-and-reports.md) — DST changes, report rounding and exact imports have distinct resolution behavior and shared fixture coverage.
### #time
- Open [**Parse incoming timestamps with parseInstant**](../practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Stopped entry grid validation**](practice-stopped-entry-grid-validation.md) — Stopped live entries use snapSpan and the instance grid; typed zero spans fail while unchanged spans remain editable.
- Open [**Timer stop snapping and duration limits**](practice-timer-stop-snapping-and-duration-limits.md) — Timer stops can trash zero spans, preserve switching boundaries and clamp the maximum duration.
### #entries
- Open [**Web previews and the entry editor show the snapped duration**](../../../web-ui-behaviour/time-and-timers/practice-web-previews-and-editor-show-snapped-durations.md) — Previews use snappedSeconds and snappedInstant with the /me resolution; toasts and chained starts use the server-returned entry.
- Open [**Stopped entry grid validation**](practice-stopped-entry-grid-validation.md) — Stopped live entries use snapSpan and the instance grid; typed zero spans fail while unchanged spans remain editable.
### #import
- Open [**Entry resolution at DST imports and reports**](practice-entry-resolution-at-dst-imports-and-reports.md) — DST changes, report rounding and exact imports have distinct resolution behavior and shared fixture coverage.
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](../../toggl-compat-and-import/practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
- Open [**Toggl CSV import: choose team-export users by opaque key**](../../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
### #timer
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](../../../web-ui-behaviour/pomodoro/map-web-timer-state-stream-and-pomodoro-session-views.md) — TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage.
- Open [**Web timer actions: send the seen revision, adopt the reply, fields read-only while paused**](../../../web-ui-behaviour/time-and-timers/practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only.md) — Pause, Resume, Stop while paused and session actions post to the server; a 409 carries the current state; the bar edits nothing while paused.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](../../../web-ui-behaviour/pomodoro/map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.