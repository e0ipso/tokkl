# kenkeep Index: web-ui-behaviour / pomodoro

↑ Parent: [web-ui-behaviour](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Pomodoro sounds: FFmpeg recipes, same-origin files, WAV for loops**](practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav.md) to learn about: Sounds in public/sounds are FFmpeg-generated with recipe and SHA-256 in docs/sounds; looping alarms are WAV, since MP3 padding breaks loops. #web #pomodoro #audio #csp #e2e

## Components (what exists)
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](map-pomodoro-session-model-in-packages-common-pomodorosession.md) to learn about: Clock-free confirm-driven phases: startSession, plannedEnd, transitionKind and nextPhase, run by the server. #common #pomodoro #timer #fixtures
- Open [**Pomodoro length preferences: shared defaults for new sessions**](map-pomodoro-cycle-functions-in-packages-common.md) to learn about: Four Pomodoro length preferences seed new sessions; API and web share common defaults, and API validation uses common ranges. #pomodoro #preferences #web #common
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](map-web-timer-state-stream-and-pomodoro-session-views.md) to learn about: TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage. #web #pomodoro #timer #sse
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) to learn about: notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions. #web #notifications #pomodoro #timer

## By topic

### #pomodoro
- Open [**Web timer actions: send the seen revision, adopt the reply, fields read-only while paused**](../time-and-timers/practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only.md) — Pause, Resume, Stop while paused and session actions post to the server; a 409 carries the current state; the bar edits nothing while paused.
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](map-web-timer-state-stream-and-pomodoro-session-views.md) — TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](../../web-ui-styling-and-layout/shell-and-layout/practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../../web-ui-styling-and-layout/calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Week calendar hour height lives in three places**](../../web-ui-styling-and-layout/calendar/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #timer
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](map-web-timer-state-stream-and-pomodoro-session-views.md) — TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage.
- Open [**Web timer actions: send the seen revision, adopt the reply, fields read-only while paused**](../time-and-timers/practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only.md) — Pause, Resume, Stop while paused and session actions post to the server; a 409 carries the current state; the bar edits nothing while paused.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #common
- Open [**Pomodoro length preferences: shared defaults for new sessions**](map-pomodoro-cycle-functions-in-packages-common.md) — Four Pomodoro length preferences seed new sessions; API and web share common defaults, and API validation uses common ranges.
- Open [**UI time math uses account-local wall-clock helpers**](../time-and-timers/practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](map-pomodoro-session-model-in-packages-common-pomodorosession.md) — Clock-free confirm-driven phases: startSession, plannedEnd, transitionKind and nextPhase, run by the server.
### #audio
- Open [**Pomodoro sounds: FFmpeg recipes, same-origin files, WAV for loops**](practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav.md) — Sounds in public/sounds are FFmpeg-generated with recipe and SHA-256 in docs/sounds; looping alarms are WAV, since MP3 padding breaks loops.
- Open [**Desktop Pomodoro alarm playback: one backend per platform**](../../tooling-and-project/map-desktop-pomodoro-alarm-playback-one-backend-per-platform.md) — KDE plays the alarm with QSoundEffect, tokkl-timerd with libpulse-simple, macOS with NSSound; the four WAVs come from desktop/core/sounds.
### #csp
- Open [**Pomodoro sounds: FFmpeg recipes, same-origin files, WAV for loops**](practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav.md) — Sounds in public/sounds are FFmpeg-generated with recipe and SHA-256 in docs/sounds; looping alarms are WAV, since MP3 padding breaks loops.
### #e2e
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../../tooling-and-project/testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../../tooling-and-project/testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #fixtures
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](map-pomodoro-session-model-in-packages-common-pomodorosession.md) — Clock-free confirm-driven phases: startSession, plannedEnd, transitionKind and nextPhase, run by the server.
### #notifications
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #preferences
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](../../api-and-data/users-and-admin/practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in accountValues.ts validates the keys Tokkl clients read, Pomodoro included; other keys pass through; bad stored values read back as defaults.
- Open [**Pomodoro length preferences: shared defaults for new sessions**](map-pomodoro-cycle-functions-in-packages-common.md) — Four Pomodoro length preferences seed new sessions; API and web share common defaults, and API validation uses common ranges.
### #sse
- Open [**Timer event stream: keep-alive, credential rechecks and the stream cap**](../../api-and-data/timer-state/map-timer-event-stream-keep-alive-auth-rechecks-and-stream-cap.md) — GET /api/app/timer/events sends the full state on connect and each change, a keep-alive every 25 s, and ends when the credential stops passing.
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](map-web-timer-state-stream-and-pomodoro-session-views.md) — TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage.
- Open [**Desktop TimerStateClient: stream, poll, settling and revisions**](../../tooling-and-project/kde-companion/plasma-companion/map-desktop-timer-state-client-stream-poll-settling-and-revisions.md) — One TimerStateClient per desktop app reads GET /api/app/timer, follows the event stream, polls only while it is down, and settles unknown write outcomes.