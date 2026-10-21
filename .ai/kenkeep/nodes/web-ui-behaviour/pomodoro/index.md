# kenkeep Index: web-ui-behaviour / pomodoro

↑ Parent: [web-ui-behaviour](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Claim Pomodoro session saves durably under the account Web Lock**](practice-claim-pomodoro-session-saves-durably-under-the-account-web-lock.md) to learn about: Session saves and timer handoffs hold the account Web Lock; ended pomodoros wait in a durable queue that reconciles before retrying. #web #pomodoro #localstorage
- Open [**Hand timers and Pomodoro sessions over at one captured instant**](practice-hand-timers-and-pomodoro-sessions-over-at-one-captured-instant.md) to learn about: Session starts stop the running timer at the start instant; timer starts end the session first, all under the account lock. #web #pomodoro #timer
- Open [**Pomodoro sounds: FFmpeg recipes, same-origin files, WAV for loops**](practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav.md) to learn about: Sounds in public/sounds are FFmpeg-generated with recipe and SHA-256 in docs/sounds; looping alarms are WAV, since MP3 padding breaks loops. #web #pomodoro #audio #csp #e2e

## Components (what exists)
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](map-pomodoro-session-model-in-packages-common-pomodorosession.md) to learn about: Clock-free confirm-driven phases: startSession, plannedEnd, overtimeSeconds, transitionKind, nextPhase, pomodoroEntrySpan. #common #pomodoro #timer #fixtures
- Open [**Pomodoro length preferences: shared defaults for new sessions**](map-pomodoro-cycle-functions-in-packages-common.md) to learn about: Four Pomodoro length preferences seed new sessions; API and web share common defaults, and API validation uses common ranges. #pomodoro #preferences #web #common
- Open [**Web Pomodoro sessions: provider, controller and account state**](map-web-pomodoro-sessions-provider-controller-and-account-state.md) to learn about: PomodoroSessionProvider, mounted in the signed-in shell, owns account-local sessions: the /pomodoro page, banner, title, unsaved queue. #web #pomodoro #timer #localstorage
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) to learn about: notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions. #web #notifications #pomodoro #timer

## By topic

### #pomodoro
- Open [**Hand timers and Pomodoro sessions over at one captured instant**](practice-hand-timers-and-pomodoro-sessions-over-at-one-captured-instant.md) — Session starts stop the running timer at the start instant; timer starts end the session first, all under the account lock.
- Open [**Web Pomodoro sessions: provider, controller and account state**](map-web-pomodoro-sessions-provider-controller-and-account-state.md) — PomodoroSessionProvider, mounted in the signed-in shell, owns account-local sessions: the /pomodoro page, banner, title, unsaved queue.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](../../web-ui-styling-and-layout/shell-and-layout/practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Hand timers and Pomodoro sessions over at one captured instant**](practice-hand-timers-and-pomodoro-sessions-over-at-one-captured-instant.md) — Session starts stop the running timer at the start instant; timer starts end the session first, all under the account lock.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../../web-ui-styling-and-layout/calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
### #timer
- Open [**Hand timers and Pomodoro sessions over at one captured instant**](practice-hand-timers-and-pomodoro-sessions-over-at-one-captured-instant.md) — Session starts stop the running timer at the start instant; timer starts end the session first, all under the account lock.
- Open [**Web Pomodoro sessions: provider, controller and account state**](map-web-pomodoro-sessions-provider-controller-and-account-state.md) — PomodoroSessionProvider, mounted in the signed-in shell, owns account-local sessions: the /pomodoro page, banner, title, unsaved queue.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #common
- Open [**Pomodoro length preferences: shared defaults for new sessions**](map-pomodoro-cycle-functions-in-packages-common.md) — Four Pomodoro length preferences seed new sessions; API and web share common defaults, and API validation uses common ranges.
- Open [**UI time math uses account-local wall-clock helpers**](../time-and-timers/practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](map-pomodoro-session-model-in-packages-common-pomodorosession.md) — Clock-free confirm-driven phases: startSession, plannedEnd, overtimeSeconds, transitionKind, nextPhase, pomodoroEntrySpan.
### #localstorage
- Open [**Web Pomodoro sessions: provider, controller and account state**](map-web-pomodoro-sessions-provider-controller-and-account-state.md) — PomodoroSessionProvider, mounted in the signed-in shell, owns account-local sessions: the /pomodoro page, banner, title, unsaved queue.
- Open [**Claim Pomodoro session saves durably under the account Web Lock**](practice-claim-pomodoro-session-saves-durably-under-the-account-web-lock.md) — Session saves and timer handoffs hold the account Web Lock; ended pomodoros wait in a durable queue that reconciles before retrying.
- Open [**Web timer bar pause chain: pauseChain.ts, per-account storage, ending rules**](../time-and-timers/practice-web-timer-bar-pause-chain-rules.md) — Pause stops, Resume starts a clone; tabChain.ts shares the chain in a tab, localStorage per account; Stop or a foreign entry ends it.
### #audio
- Open [**Pomodoro sounds: FFmpeg recipes, same-origin files, WAV for loops**](practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav.md) — Sounds in public/sounds are FFmpeg-generated with recipe and SHA-256 in docs/sounds; looping alarms are WAV, since MP3 padding breaks loops.
### #csp
- Open [**Pomodoro sounds: FFmpeg recipes, same-origin files, WAV for loops**](practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav.md) — Sounds in public/sounds are FFmpeg-generated with recipe and SHA-256 in docs/sounds; looping alarms are WAV, since MP3 padding breaks loops.
### #e2e
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../../tooling-and-project/testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Week calendar hour height lives in three places**](../../web-ui-styling-and-layout/calendar/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #fixtures
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](map-pomodoro-session-model-in-packages-common-pomodorosession.md) — Clock-free confirm-driven phases: startSession, plannedEnd, overtimeSeconds, transitionKind, nextPhase, pomodoroEntrySpan.
### #notifications
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #preferences
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](../../api-and-data/users-and-admin/practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys Tokkl clients read, Pomodoro included; other keys pass through; bad stored values read back as defaults.
- Open [**Pomodoro length preferences: shared defaults for new sessions**](map-pomodoro-cycle-functions-in-packages-common.md) — Four Pomodoro length preferences seed new sessions; API and web share common defaults, and API validation uses common ranges.