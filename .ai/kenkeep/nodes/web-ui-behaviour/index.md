# kenkeep Index: web-ui-behaviour

↑ Parent: [kenkeep](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) to learn about: Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work. #web #time #dst #calendar #common
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) to learn about: Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch. #web #react-query #timer #entry-list
- Open [**End web sessions through endSession and logOut in lib/session.ts**](practice-end-sessions-through-lib-session.md) to learn about: Logout clears the Query cache and cached theme even on failure, then reloads; a 403 from /me ends the session once per sign-in. #web #auth #react-query #theme
- Open [**Web previews and the entry editor show the snapped duration**](practice-web-previews-and-editor-show-snapped-durations.md) to learn about: Previews use snappedSeconds and snappedInstant with the /me resolution; toasts and chained starts use the server-returned entry. #web #time #timer #entries
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) to learn about: parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now. #web #time #parsing
- Open [**Claim Pomodoro session saves durably under the account Web Lock**](practice-claim-pomodoro-session-saves-durably-under-the-account-web-lock.md) to learn about: Session saves and timer handoffs hold the account Web Lock; ended pomodoros wait in a durable queue that reconciles before retrying. #web #pomodoro #localstorage
- Open [**Web timer bar pause chain: pauseChain.ts, per-account storage, ending rules**](practice-web-timer-bar-pause-chain-rules.md) to learn about: Pause stops, Resume starts a clone; tabChain.ts shares the chain in a tab, localStorage per account; Stop or a foreign entry ends it. #web #timer #pause #localstorage
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) to learn about: Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets. #web #a11y #keyboard #react #reports
- Open [**Durations: over 999 hours is unreadable (null), not clamped**](practice-parse-duration-returns-null-over-999-hours.md) to learn about: MAX_DURATION_SECONDS caps parseDuration on every branch; callers read null as unreadable input. #time #parsing #validation
- Open [**Timer bar pickers return focus to the description without opening suggestions**](practice-timer-bar-pickers-return-focus-without-opening-suggestions.md) to learn about: Closing the project or tag picker focuses the description through quietFocus; every focus clears the pending 150 ms blur hide; typing reopens suggestions. #web #timer #focus #a11y
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) to learn about: navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand. #web #clipboard #self-hosting
- Open [**Hand timers and Pomodoro sessions over at one captured instant**](practice-hand-timers-and-pomodoro-sessions-over-at-one-captured-instant.md) to learn about: Session starts stop the running timer at the start instant; timer starts end the session first, all under the account lock. #web #pomodoro #timer
- Open [**Pomodoro sounds: FFmpeg recipes, same-origin files, WAV for loops**](practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav.md) to learn about: Sounds in public/sounds are FFmpeg-generated with recipe and SHA-256 in docs/sounds; looping alarms are WAV, since MP3 padding breaks loops. #web #pomodoro #audio #csp #e2e

## Components (what exists)
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](map-pomodoro-session-model-in-packages-common-pomodorosession.md) to learn about: Clock-free confirm-driven phases: startSession, plannedEnd, overtimeSeconds, transitionKind, nextPhase, pomodoroEntrySpan. #common #pomodoro #timer #fixtures
- Open [**Pomodoro length preferences: session defaults and API-only toggle keys**](map-pomodoro-cycle-functions-in-packages-common.md) to learn about: The four pomodoro_* length preferences seed new /pomodoro sessions; pomodoro_enabled and stop_timer_at_end have no web or common reader. #pomodoro #preferences #web #common
- Open [**Web Pomodoro sessions: provider, controller and account state**](map-web-pomodoro-sessions-provider-controller-and-account-state.md) to learn about: PomodoroSessionProvider, mounted in the signed-in shell, owns account-local sessions: the /pomodoro page, banner, title, unsaved queue. #web #pomodoro #timer #localstorage
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) to learn about: notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions. #web #notifications #pomodoro #timer
- Open [**Entry fields: EntryFields.tsx and useEntryFields.ts**](map-web-entry-fields-entryfields-tsx-and-useentryfields-ts.md) to learn about: Draft-driven description, suggestions, project/task and tag pickers and billable toggle; the parent decides what an edit writes. #web #timer #components #react #focus
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) to learn about: PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too. #web #a11y #react #components #forms #e2e

## By topic

### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](../web-ui-styling-and-layout/practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Hand timers and Pomodoro sessions over at one captured instant**](practice-hand-timers-and-pomodoro-sessions-over-at-one-captured-instant.md) — Session starts stop the running timer at the start instant; timer starts end the session first, all under the account lock.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../web-ui-styling-and-layout/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
### #timer
- Open [**Hand timers and Pomodoro sessions over at one captured instant**](practice-hand-timers-and-pomodoro-sessions-over-at-one-captured-instant.md) — Session starts stop the running timer at the start instant; timer starts end the session first, all under the account lock.
- Open [**Web Pomodoro sessions: provider, controller and account state**](map-web-pomodoro-sessions-provider-controller-and-account-state.md) — PomodoroSessionProvider, mounted in the signed-in shell, owns account-local sessions: the /pomodoro page, banner, title, unsaved queue.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #pomodoro
- Open [**Hand timers and Pomodoro sessions over at one captured instant**](practice-hand-timers-and-pomodoro-sessions-over-at-one-captured-instant.md) — Session starts stop the running timer at the start instant; timer starts end the session first, all under the account lock.
- Open [**Web Pomodoro sessions: provider, controller and account state**](map-web-pomodoro-sessions-provider-controller-and-account-state.md) — PomodoroSessionProvider, mounted in the signed-in shell, owns account-local sessions: the /pomodoro page, banner, title, unsaved queue.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #time
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../api-and-data/time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
- Open [**Parse incoming timestamps with parseInstant**](../api-and-data/time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Durations: over 999 hours is unreadable (null), not clamped**](practice-parse-duration-returns-null-over-999-hours.md) — MAX_DURATION_SECONDS caps parseDuration on every branch; callers read null as unreadable input.
### #a11y
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
- Open [**Timer bar pickers return focus to the description without opening suggestions**](practice-timer-bar-pickers-return-focus-without-opening-suggestions.md) — Closing the project or tag picker focuses the description through quietFocus; every focus clears the pending 150 ms blur hide; typing reopens suggestions.
### #common
- Open [**Pomodoro length preferences: session defaults and API-only toggle keys**](map-pomodoro-cycle-functions-in-packages-common.md) — The four pomodoro_* length preferences seed new /pomodoro sessions; pomodoro_enabled and stop_timer_at_end have no web or common reader.
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](map-pomodoro-session-model-in-packages-common-pomodorosession.md) — Clock-free confirm-driven phases: startSession, plannedEnd, overtimeSeconds, transitionKind, nextPhase, pomodoroEntrySpan.
### #localstorage
- Open [**Web Pomodoro sessions: provider, controller and account state**](map-web-pomodoro-sessions-provider-controller-and-account-state.md) — PomodoroSessionProvider, mounted in the signed-in shell, owns account-local sessions: the /pomodoro page, banner, title, unsaved queue.
- Open [**Claim Pomodoro session saves durably under the account Web Lock**](practice-claim-pomodoro-session-saves-durably-under-the-account-web-lock.md) — Session saves and timer handoffs hold the account Web Lock; ended pomodoros wait in a durable queue that reconciles before retrying.
- Open [**Web timer bar pause chain: pauseChain.ts, per-account storage, ending rules**](practice-web-timer-bar-pause-chain-rules.md) — Pause stops, Resume starts a clone; tabChain.ts shares the chain in a tab, localStorage per account; Stop or a foreign entry ends it.
### #react
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
- Open [**Entry fields: EntryFields.tsx and useEntryFields.ts**](map-web-entry-fields-entryfields-tsx-and-useentryfields-ts.md) — Draft-driven description, suggestions, project/task and tag pickers and billable toggle; the parent decides what an edit writes.
### #components
- Open [**Entry fields: EntryFields.tsx and useEntryFields.ts**](map-web-entry-fields-entryfields-tsx-and-useentryfields-ts.md) — Draft-driven description, suggestions, project/task and tag pickers and billable toggle; the parent decides what an edit writes.
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](../web-ui-styling-and-layout/map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css.
### #e2e
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../tooling-and-project/testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Week calendar hour height lives in three places**](../web-ui-styling-and-layout/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
### #focus
- Open [**Entry fields: EntryFields.tsx and useEntryFields.ts**](map-web-entry-fields-entryfields-tsx-and-useentryfields-ts.md) — Draft-driven description, suggestions, project/task and tag pickers and billable toggle; the parent decides what an edit writes.
- Open [**Timer bar pickers return focus to the description without opening suggestions**](practice-timer-bar-pickers-return-focus-without-opening-suggestions.md) — Closing the project or tag picker focuses the description through quietFocus; every focus clears the pending 150 ms blur hide; typing reopens suggestions.
### #parsing
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
- Open [**Durations: over 999 hours is unreadable (null), not clamped**](practice-parse-duration-returns-null-over-999-hours.md) — MAX_DURATION_SECONDS caps parseDuration on every branch; callers read null as unreadable input.
- Open [**Parser cases live in packages/common/fixtures JSON, not in TS asserts**](../tooling-and-project/testing/practice-parser-cases-live-in-shared-json-fixtures.md) — duration, timeOfDay, snap and pomodoroSession cases are a cross-client contract in JSON; add cases there, not in TS tests.
### #react-query
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
- Open [**End web sessions through endSession and logOut in lib/session.ts**](practice-end-sessions-through-lib-session.md) — Logout clears the Query cache and cached theme even on failure, then reloads; a 403 from /me ends the session once per sign-in.
### #audio
- Open [**Pomodoro sounds: FFmpeg recipes, same-origin files, WAV for loops**](practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav.md) — Sounds in public/sounds are FFmpeg-generated with recipe and SHA-256 in docs/sounds; looping alarms are WAV, since MP3 padding breaks loops.
### #auth
- Open [**Admin user management API and the last-active-admin rule**](../api-and-data/users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Invites and password-reset links in account_tokens**](../api-and-data/users-and-admin/map-invites-and-password-reset-links-in-account-tokens.md) — Invite and reset tokens are hashed in account_tokens, shown once, and give one 404 for any bad link; a reset rotates the API token.
- Open [**Cookie writes and session-starting routes need the CSRF header**](../api-and-data/password-and-csrf-rules/practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md) — Cookie writes, login, setup, invite accept and password reset need X-Tokkl-CSRF: 1 before any lookup; callers and tests must send it.
### #calendar
- Open [**Week calendar hour height lives in three places**](../web-ui-styling-and-layout/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../web-ui-styling-and-layout/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Section hues: data-section maps each NAV section to a hue and its text colour**](../web-ui-styling-and-layout/practice-section-hues-data-section-maps-each-nav-section-to-a-hue.md) — Timer orange, Pomodoro cyan, Reports sky, Projects violet, Settings yellow, More pink. Text on a hue is on-section-hue; fills draw an edge.
### #clipboard
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) — navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand.
### #csp
- Open [**Pomodoro sounds: FFmpeg recipes, same-origin files, WAV for loops**](practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav.md) — Sounds in public/sounds are FFmpeg-generated with recipe and SHA-256 in docs/sounds; looping alarms are WAV, since MP3 padding breaks loops.
### #dst
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use packages/common/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
### #entries
- Open [**Stopped entries snap to the instance time resolution on write**](../api-and-data/time-handling/practice-stopped-entries-snap-to-the-time-resolution-on-write.md) — Every live write moves start and stop each to the nearest grid point; a span that rounds to zero is refused (typed) or trashed (timer stop); imports stay exact.
- Open [**Web previews and the entry editor show the snapped duration**](practice-web-previews-and-editor-show-snapped-durations.md) — Previews use snappedSeconds and snappedInstant with the /me resolution; toasts and chained starts use the server-returned entry.
### #entry-list
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
### #fixtures
- Open [**Pomodoro session model in packages/common/pomodoroSession.ts**](map-pomodoro-session-model-in-packages-common-pomodorosession.md) — Clock-free confirm-driven phases: startSession, plannedEnd, overtimeSeconds, transitionKind, nextPhase, pomodoroEntrySpan.
### #forms
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
### #keyboard
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
### #notifications
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #pause
- Open [**Web timer bar pause chain: pauseChain.ts, per-account storage, ending rules**](practice-web-timer-bar-pause-chain-rules.md) — Pause stops, Resume starts a clone; tabChain.ts shares the chain in a tab, localStorage per account; Stop or a foreign entry ends it.
### #preferences
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](../api-and-data/users-and-admin/practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys Tokkl clients read, Pomodoro included; other keys pass through; bad stored values read back as defaults.
- Open [**Pomodoro length preferences: session defaults and API-only toggle keys**](map-pomodoro-cycle-functions-in-packages-common.md) — The four pomodoro_* length preferences seed new /pomodoro sessions; pomodoro_enabled and stop_timer_at_end have no web or common reader.
### #reports
- Open [**Web app report endpoints under /api/app/report**](../api-and-data/reports-and-totals/map-app-report-endpoints.md) — Web app reports are built server-side by /api/app/report/* with workspace rounding; only the summary tab fetches groupings.
- Open [**styles.css loads last and owns the colour tokens**](../web-ui-styling-and-layout/practice-styles-css-loads-last-and-owns-colour-tokens.md) — styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals.
- Open [**Report totals wrap as a flex row; an Amount figure never breaks**](../web-ui-styling-and-layout/practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break.md) — Tiles share --tile-basis (220px, 160px at 760px and below); Amount sizes to its nowrap figures. The visual baselines show no Amount tile.
### #self-hosting
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) — navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand.
### #theme
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](../web-ui-styling-and-layout/practice-theme-tokens-data-theme-and-cached-theme.md) — Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint.
- Open [**End web sessions through endSession and logOut in lib/session.ts**](practice-end-sessions-through-lib-session.md) — Logout clears the Query cache and cached theme even on failure, then reloads; a 403 from /me ends the session once per sign-in.
### #validation
- Open [**Parse incoming timestamps with parseInstant**](../api-and-data/time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Toggl CSV import: choose team-export users by opaque key**](../api-and-data/toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../api-and-data/time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.