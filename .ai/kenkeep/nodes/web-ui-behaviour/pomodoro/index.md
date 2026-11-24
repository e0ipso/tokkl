# kenkeep Index: web-ui-behaviour / pomodoro

↑ Parent: [web-ui-behaviour](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`web-timer-state/`](web-timer-state/index.md) for more information on the web app's timer state intake, timer event stream and Pomodoro session views; read when changing how the web app receives, checks or shows timer and session state.

## Conventions (how we build)
- Open [**Pomodoro sounds: FFmpeg recipes, same-origin files, WAV for loops**](practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav.md) to learn about: Sounds in public/sounds are FFmpeg-generated with recipe and SHA-256 in docs/sounds; looping alarms are WAV, since MP3 padding breaks loops. #web #pomodoro #audio #csp #e2e

## Components (what exists)
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](map-pomodoro-session-model-in-packages-common-pomodorosession.md) to learn about: Clock-free confirm-driven phases: startSession, plannedEnd, transitionKind and nextPhase, run by the server. #common #pomodoro #timer #fixtures
- Open [**Pomodoro length preferences: shared defaults for new sessions**](map-pomodoro-cycle-functions-in-packages-common.md) to learn about: Four Pomodoro length preferences seed new sessions; API and web share common defaults, and API validation uses common ranges. #pomodoro #preferences #web #common
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) to learn about: notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions. #web #notifications #pomodoro #timer

## By topic

### #pomodoro
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](../time-and-timers/web-timer-actions/practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.
- Open [**PomodoroSessionProvider: a tab-side view of the server's Pomodoro session**](web-timer-state/map-pomodorosessionprovider-a-tab-side-view-of-the-server-s-pomodoro-session.md) — PomodoroSessionProvider shows state.pomodoro, rings and notifies; actions only post to the server; the browser stores no session state.
- Open [**Send the cached revision with every timer action and adopt the reply**](../time-and-timers/web-timer-actions/practice-send-the-cached-revision-with-every-timer-action-and-adopt-the-reply.md) — Timer and Pomodoro actions send the cached revision; replies and 409 bodies go through acceptTimerState; failures are TimerActionError.
### #web
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](../time-and-timers/web-timer-actions/practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.
### #common
- Open [**Pomodoro length preferences: shared defaults for new sessions**](map-pomodoro-cycle-functions-in-packages-common.md) — Four Pomodoro length preferences seed new sessions; API and web share common defaults, and API validation uses common ranges.
- Open [**UI time math uses account-local wall-clock helpers**](../time-and-timers/practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](map-pomodoro-session-model-in-packages-common-pomodorosession.md) — Clock-free confirm-driven phases: startSession, plannedEnd, transitionKind and nextPhase, run by the server.
### #timer
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**acceptTimerState: one validated entry for every web timer state**](web-timer-state/map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md) — Every web timer state passes isTimerState and acceptTimerState: revision check, cache writes, stale.timerChanged and server clock offset.
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