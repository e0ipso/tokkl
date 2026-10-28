# kenkeep Index: api-and-data / timer-state

↑ Parent: [api-and-data](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**Timer state service: settlement, revision and the discarded pomodoro**](map-timer-state-service-settlement-revision-and-discarded-pomodoro.md) to learn about: settleTimer numbers a user's running entry, pause chain and Pomodoro session; every write that can change the running entry calls touchTimer. #api #timer #pomodoro #pause
- Open [**Timer event stream: keep-alive, credential rechecks and the stream cap**](map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap.md) to learn about: GET /api/app/timer/events sends the full state on connect and each change, a keep-alive every 25 s, and ends when the credential stops passing. #api #timer #sse #auth

## By topic

### #api
- Open [**Parse incoming timestamps with parseInstant**](../time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
### #timer
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](../../web-ui-behaviour/pomodoro/map-web-timer-state-stream-and-pomodoro-session-views.md) — TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage.
- Open [**Web timer actions: send the seen revision, adopt the reply, fields read-only while paused**](../../web-ui-behaviour/time-and-timers/practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only.md) — Pause, Resume, Stop while paused and session actions post to the server; a 409 carries the current state; the bar edits nothing while paused.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](../../web-ui-behaviour/pomodoro/map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #auth
- Open [**Admin user management API and the last-active-admin rule**](../users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Cookie writes and session-starting routes need the CSRF header**](../password-and-csrf-rules/practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md) — Cookie writes, login, setup, invite accept and password reset need X-Tokkl-CSRF: 1 before any lookup; callers and tests must send it.
- Open [**Password checks go through FailureLimiter.attempt**](../password-and-csrf-rules/practice-password-checks-go-through-failurelimiter-attempt.md) — Password checks charge three counters; 429s send Retry-After; disabled accounts fail like bad passwords; new passwords use readNewPassword.
### #pause
- Open [**Timer state service: settlement, revision and the discarded pomodoro**](map-timer-state-service-settlement-revision-and-discarded-pomodoro.md) — settleTimer numbers a user's running entry, pause chain and Pomodoro session; every write that can change the running entry calls touchTimer.
- Open [**Web timer actions: send the seen revision, adopt the reply, fields read-only while paused**](../../web-ui-behaviour/time-and-timers/practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only.md) — Pause, Resume, Stop while paused and session actions post to the server; a 409 carries the current state; the bar edits nothing while paused.
### #pomodoro
- Open [**Web timer actions: send the seen revision, adopt the reply, fields read-only while paused**](../../web-ui-behaviour/time-and-timers/practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only.md) — Pause, Resume, Stop while paused and session actions post to the server; a 409 carries the current state; the bar edits nothing while paused.
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](../../web-ui-behaviour/pomodoro/map-web-timer-state-stream-and-pomodoro-session-views.md) — TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](../../web-ui-behaviour/pomodoro/map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #sse
- Open [**Timer event stream: keep-alive, credential rechecks and the stream cap**](map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap.md) — GET /api/app/timer/events sends the full state on connect and each change, a keep-alive every 25 s, and ends when the credential stops passing.
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](../../web-ui-behaviour/pomodoro/map-web-timer-state-stream-and-pomodoro-session-views.md) — TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage.
- Open [**Desktop TimerStateClient: stream, poll, settling and revisions**](../../tooling-and-project/kde-companion/plasma-companion/map-desktop-timer-state-client-stream-poll-settling-and-revisions.md) — One TimerStateClient per desktop app reads GET /api/app/timer, follows the event stream, polls only while it is down, and settles unknown write outcomes.