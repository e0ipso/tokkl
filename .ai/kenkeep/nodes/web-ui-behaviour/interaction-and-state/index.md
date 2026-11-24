# kenkeep Index: web-ui-behaviour / interaction-and-state

↑ Parent: [web-ui-behaviour](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) to learn about: Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch. #web #react-query #timer #entry-list
- Open [**End web sessions through endSession and logOut in lib/session.ts**](practice-end-sessions-through-lib-session.md) to learn about: Logout clears the Query cache and cached theme even on failure, then reloads; a 403 from /me ends the session once per sign-in. #web #auth #react-query #theme
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) to learn about: Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets. #web #a11y #keyboard #react #reports
- Open [**Timer bar pickers return focus to the description without opening suggestions**](practice-timer-bar-pickers-return-focus-without-opening-suggestions.md) to learn about: Closing the project or tag picker focuses the description through the combobox's focusQuietly; every focus clears the pending 150 ms blur hide; typing or a click reopens suggestions. #web #timer #focus #a11y
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) to learn about: navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand. #web #clipboard #self-hosting
- Open [**Web requests: deadlines, cancel signals and ordered preference saves**](practice-web-request-deadlines-cancel-signals-and-ordered-preference-saves.md) to learn about: Every request has a read, write or transfer deadline; GET queries forward TanStack's signal; preference saves share one scope and undo only their own fields. #web #tanstack-query #network

## Components (what exists)
- Open [**Entry fields: EntryFields.tsx, DescriptionCombobox.tsx and useEntryFields.ts**](map-web-entry-fields-entryfields-tsx-and-useentryfields-ts.md) to learn about: Draft-driven description, project/task and tag pickers and billable toggle; the shared DescriptionCombobox gives the timer bar, editor and rows the same suggestions; the owner decides what an edit or pick writes. #web #timer #components #react #focus
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) to learn about: PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too. #web #a11y #react #components #forms #e2e
- Open [**UI text: the typed message catalog, t() and tx(), and Intl formatting**](map-web-message-catalog-and-intl-formatting.md) to learn about: Every user-facing string is a key in packages/web/src/i18n/en/<feature>.ts, read with t or tx; dates use Intl pinned to en, numbers the browser locale. #web #i18n #a11y #react #e2e

## By topic

### #web
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](../time-and-timers/web-timer-actions/practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.
### #a11y
- Open [**UI text: the typed message catalog, t() and tx(), and Intl formatting**](map-web-message-catalog-and-intl-formatting.md) — Every user-facing string is a key in packages/web/src/i18n/en/<feature>.ts, read with t or tx; dates use Intl pinned to en, numbers the browser locale.
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
### #react
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
- Open [**UI text: the typed message catalog, t() and tx(), and Intl formatting**](map-web-message-catalog-and-intl-formatting.md) — Every user-facing string is a key in packages/web/src/i18n/en/<feature>.ts, read with t or tx; dates use Intl pinned to en, numbers the browser locale.
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
### #timer
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**acceptTimerState: one validated entry for every web timer state**](../pomodoro/web-timer-state/map-accepttimerstate-one-validated-entry-for-every-web-timer-state.md) — Every web timer state passes isTimerState and acceptTimerState: revision check, cache writes, stale.timerChanged and server clock offset.
### #components
- Open [**Entry fields: EntryFields.tsx, DescriptionCombobox.tsx and useEntryFields.ts**](map-web-entry-fields-entryfields-tsx-and-useentryfields-ts.md) — Draft-driven description, project/task and tag pickers and billable toggle; the shared DescriptionCombobox gives the timer bar, editor and rows the same suggestions; the owner decides what an edit or pick writes.
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
- Open [**Shared list controls live in packages/web/src/pages/manage/ui.tsx**](../../web-ui-styling-and-layout/shell-and-layout/map-shared-list-controls-in-manage-ui.md) — Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css.
### #e2e
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../../tooling-and-project/testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../../tooling-and-project/testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #focus
- Open [**Entry fields: EntryFields.tsx, DescriptionCombobox.tsx and useEntryFields.ts**](map-web-entry-fields-entryfields-tsx-and-useentryfields-ts.md) — Draft-driven description, project/task and tag pickers and billable toggle; the shared DescriptionCombobox gives the timer bar, editor and rows the same suggestions; the owner decides what an edit or pick writes.
- Open [**Timer bar pickers return focus to the description without opening suggestions**](practice-timer-bar-pickers-return-focus-without-opening-suggestions.md) — Closing the project or tag picker focuses the description through the combobox's focusQuietly; every focus clears the pending 150 ms blur hide; typing or a click reopens suggestions.
### #react-query
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
- Open [**End web sessions through endSession and logOut in lib/session.ts**](practice-end-sessions-through-lib-session.md) — Logout clears the Query cache and cached theme even on failure, then reloads; a 403 from /me ends the session once per sign-in.
### #auth
- Open [**Recheck credentials inside the guarded account transaction**](../../api-and-data/password-and-csrf-rules/password-attempt-limits/practice-recheck-credentials-inside-the-guarded-account-transaction.md) — Auth and PUT /me recheck the account and credential under the guarded transaction, so revocations during scrypt refuse stale credentials.
- Open [**Validate new passwords with parseNewPassword**](../../api-and-data/password-and-csrf-rules/password-attempt-limits/practice-validate-new-passwords-with-parsenewpassword.md) — New passwords are 8-1024 characters and go through parseNewPassword; current passwords are not capped on login or rotation.
- Open [**Verify passwords only through FailureLimiter.attempt**](../../api-and-data/password-and-csrf-rules/password-attempt-limits/practice-verify-passwords-only-through-failurelimiter-attempt.md) — Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly.
### #clipboard
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) — navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand.
### #entry-list
- Open [**Web UI state must survive background refetches**](practice-web-ui-survives-background-refetches.md) — Entry rows keep a stable key, the timer bar syncs on every mirrored field, and focus or visibility triggers a refetch.
### #forms
- Open [**Loading, error, empty and field-error states use the shared components**](map-web-page-state-and-field-error-components.md) — PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and FieldError.tsx with useFieldErrors; error toasts are role=alert too.
### #i18n
- Open [**UI text: the typed message catalog, t() and tx(), and Intl formatting**](map-web-message-catalog-and-intl-formatting.md) — Every user-facing string is a key in packages/web/src/i18n/en/<feature>.ts, read with t or tx; dates use Intl pinned to en, numbers the browser locale.
### #keyboard
- Open [**Arrow keys: arrowTarget for roving tabindex; global shortcuts yield**](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md) — Option groups move focus with arrowTarget and one tab stop; global arrow shortcuts skip defaultPrevented events and \[data-own-arrows\] targets.
### #network
- Open [**Web requests: deadlines, cancel signals and ordered preference saves**](practice-web-request-deadlines-cancel-signals-and-ordered-preference-saves.md) — Every request has a read, write or transfer deadline; GET queries forward TanStack's signal; preference saves share one scope and undo only their own fields.
### #reports
- Open [**Report route admission to the ReportRunner report lane**](../../api-and-data/reports-and-totals/app-report-pipeline/map-report-route-admission-to-the-reportrunner-report-lane.md) — Report routes reserve a per-account place in the report lane, answer 503 when full, free it on abort, then submit a typed ReportJob.
- Open [**Download lane for account exports and detailed CSVs**](../../api-and-data/reports-and-totals/app-report-pipeline/map-download-lane-for-account-exports-and-detailed-csvs.md) — Account exports and detailed CSVs run in the download lane, stream acknowledged pieces through streamDownload and time out at 15 min.
- Open [**Web app report routes, range limits and rounding**](../../api-and-data/reports-and-totals/app-report-pipeline/map-web-app-report-routes-range-limits-and-rounding.md) — /api/app/report routes build every web report server-side with workspace rounding and a 3660-day range; Toggl v3 shares builders.
### #self-hosting
- Open [**Clipboard copy needs a fallback on plain HTTP**](practice-clipboard-copy-needs-http-fallback.md) — navigator.clipboard exists only on HTTPS or localhost; copy code falls back to a hidden textarea, then asks the user to copy by hand.
### #tanstack-query
- Open [**Web requests: deadlines, cancel signals and ordered preference saves**](practice-web-request-deadlines-cancel-signals-and-ordered-preference-saves.md) — Every request has a read, write or transfer deadline; GET queries forward TanStack's signal; preference saves share one scope and undo only their own fields.
### #theme
- Open [**Theme: light-dark() tokens, data-theme and the cached theme**](../../web-ui-styling-and-layout/theme-and-tokens/practice-theme-tokens-data-theme-and-cached-theme.md) — Tokens are light-dark() on :root; \[data-theme\] sets only color-scheme; theme-boot.js applies the cached theme before first paint.
- Open [**End web sessions through endSession and logOut in lib/session.ts**](practice-end-sessions-through-lib-session.md) — Logout clears the Query cache and cached theme even on failure, then reloads; a 403 from /me ends the session once per sign-in.