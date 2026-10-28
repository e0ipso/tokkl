# kenkeep Index: web-ui-behaviour / time-and-timers

↑ Parent: [web-ui-behaviour](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) to learn about: Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work. #web #time #dst #calendar #common
- Open [**Web previews and the entry editor show the snapped duration**](practice-web-previews-and-editor-show-snapped-durations.md) to learn about: Previews use snappedSeconds and snappedInstant with the /me resolution; toasts and chained starts use the server-returned entry. #web #time #timer #entries
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) to learn about: parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now. #web #time #parsing
- Open [**Durations: over 999 hours is unreadable (null), not clamped**](practice-parse-duration-returns-null-over-999-hours.md) to learn about: MAX_DURATION_SECONDS caps parseDuration on every branch; callers read null as unreadable input. #time #parsing #validation
- Open [**Web timer actions: send the seen revision, adopt the reply, fields read-only while paused**](practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only.md) to learn about: Pause, Resume, Stop while paused and session actions post to the server; a 409 carries the current state; the bar edits nothing while paused. #web #timer #pause #pomodoro

## Components (what exists)
_None yet._

## By topic

### #time
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../../api-and-data/time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
- Open [**Parse incoming timestamps with parseInstant**](../../api-and-data/time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Durations: over 999 hours is unreadable (null), not clamped**](practice-parse-duration-returns-null-over-999-hours.md) — MAX_DURATION_SECONDS caps parseDuration on every branch; callers read null as unreadable input.
### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](../../web-ui-styling-and-layout/shell-and-layout/practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../../web-ui-styling-and-layout/calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Week calendar hour height lives in three places**](../../web-ui-styling-and-layout/calendar/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #parsing
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
- Open [**Durations: over 999 hours is unreadable (null), not clamped**](practice-parse-duration-returns-null-over-999-hours.md) — MAX_DURATION_SECONDS caps parseDuration on every branch; callers read null as unreadable input.
- Open [**Parser cases live in packages/common/fixtures JSON, not in TS asserts**](../../tooling-and-project/testing/practice-parser-cases-live-in-shared-json-fixtures.md) — duration, timeOfDay, snap and pomodoroSession cases are a cross-client contract in JSON; add cases there, not in TS tests.
### #timer
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](../pomodoro/map-web-timer-state-stream-and-pomodoro-session-views.md) — TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage.
- Open [**Web timer actions: send the seen revision, adopt the reply, fields read-only while paused**](practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only.md) — Pause, Resume, Stop while paused and session actions post to the server; a 409 carries the current state; the bar edits nothing while paused.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](../pomodoro/map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #calendar
- Open [**Week calendar hour height lives in three places**](../../web-ui-styling-and-layout/calendar/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../../web-ui-styling-and-layout/calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Section hues: data-section maps each NAV section to a hue and its text colour**](../../web-ui-styling-and-layout/theme-and-tokens/practice-section-hues-data-section-maps-each-nav-section-to-a-hue.md) — Timer orange, Pomodoro cyan, Reports sky, Projects violet, Settings yellow, More pink. Text on a hue is on-section-hue; fills draw an edge.
### #common
- Open [**Pomodoro length preferences: shared defaults for new sessions**](../pomodoro/map-pomodoro-cycle-functions-in-packages-common.md) — Four Pomodoro length preferences seed new sessions; API and web share common defaults, and API validation uses common ranges.
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](../pomodoro/map-pomodoro-session-model-in-packages-common-pomodorosession.md) — Clock-free confirm-driven phases: startSession, plannedEnd, transitionKind and nextPhase, run by the server.
### #dst
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
### #entries
- Open [**Stopped entries snap to the instance time resolution on write**](../../api-and-data/time-handling/practice-stopped-entries-snap-to-the-time-resolution-on-write.md) — Every live write moves start and stop each to the nearest grid point; a span that rounds to zero is refused (typed) or trashed (timer stop); imports stay exact.
- Open [**Web previews and the entry editor show the snapped duration**](practice-web-previews-and-editor-show-snapped-durations.md) — Previews use snappedSeconds and snappedInstant with the /me resolution; toasts and chained starts use the server-returned entry.
### #pause
- Open [**Timer state service: settlement, revision and the discarded pomodoro**](../../api-and-data/timer-state/map-timer-state-service-settlement-revision-and-discarded-pomodoro.md) — settleTimer numbers a user's running entry, pause chain and Pomodoro session; every write that can change the running entry calls touchTimer.
- Open [**Web timer actions: send the seen revision, adopt the reply, fields read-only while paused**](practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only.md) — Pause, Resume, Stop while paused and session actions post to the server; a 409 carries the current state; the bar edits nothing while paused.
### #pomodoro
- Open [**Web timer actions: send the seen revision, adopt the reply, fields read-only while paused**](practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only.md) — Pause, Resume, Stop while paused and session actions post to the server; a 409 carries the current state; the bar edits nothing while paused.
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](../pomodoro/map-web-timer-state-stream-and-pomodoro-session-views.md) — TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](../pomodoro/map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #validation
- Open [**Parse incoming timestamps with parseInstant**](../../api-and-data/time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Toggl CSV import: choose team-export users by opaque key**](../../api-and-data/toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../../api-and-data/time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.