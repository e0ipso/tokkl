# kenkeep Index: api-and-data / users-and-admin

↑ Parent: [api-and-data](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) to learn about: PREFERENCE_RULES in accountValues.ts validates the keys Tokkl clients read, Pomodoro included; other keys pass through; bad stored values read back as defaults. #server #preferences #validation
- Open [**Signed-in operations bind the authenticated user at construction**](practice-signed-in-operations-bind-the-authenticated-user.md) to learn about: entriesFor, timersFor, catalogsFor, importsFor, preferencesFor and accountsFor take the Authentication once; routes never pass the user's id or the admin actor again. #server #auth #architecture

## Components (what exists)
- Open [**Invites and password-reset links in account_tokens**](map-invites-and-password-reset-links-in-account-tokens.md) to learn about: Hashed invite and reset links, email-locked sign-up invites, SMTP delivery, shared limits and safe failed-send cleanup. #server #auth #admin #invites
- Open [**Instance settings: /api/app/admin/settings**](map-instance-settings-api-app-admin-settings-and-setting-rules.md) to learn about: Runtime session, invite and boolean sign-up settings, including mail readiness and the public status flag; the time resolution is a per-user preference. #server #admin #settings
- Open [**Admin user management API and the last-active-admin rule**](map-admin-user-management-api-and-the-last-active-admin-rule.md) to learn about: /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in. #server #auth #admin
- Open [**Users, roles and workspace membership**](map-users-roles-and-workspace-membership.md) to learn about: Account roles, scoped membership contracts, protected writes and neutral multi-user fixtures. #server #database #migrations #auth #workspaces

## By topic

### #server
- Open [**Recheck credentials inside the guarded account transaction**](../password-and-csrf-rules/password-attempt-limits/practice-recheck-credentials-inside-the-guarded-account-transaction.md) — Auth and PUT /me recheck the account and credential under the guarded transaction, so revocations during scrypt refuse stale credentials.
- Open [**Validate new passwords with parseNewPassword**](../password-and-csrf-rules/password-attempt-limits/practice-validate-new-passwords-with-parsenewpassword.md) — New passwords are 8-1024 characters and go through parseNewPassword; current passwords are not capped on login or rotation.
- Open [**Verify passwords only through FailureLimiter.attempt**](../password-and-csrf-rules/password-attempt-limits/practice-verify-passwords-only-through-failurelimiter-attempt.md) — Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly.
### #auth
- Open [**Recheck credentials inside the guarded account transaction**](../password-and-csrf-rules/password-attempt-limits/practice-recheck-credentials-inside-the-guarded-account-transaction.md) — Auth and PUT /me recheck the account and credential under the guarded transaction, so revocations during scrypt refuse stale credentials.
- Open [**Validate new passwords with parseNewPassword**](../password-and-csrf-rules/password-attempt-limits/practice-validate-new-passwords-with-parsenewpassword.md) — New passwords are 8-1024 characters and go through parseNewPassword; current passwords are not capped on login or rotation.
- Open [**Verify passwords only through FailureLimiter.attempt**](../password-and-csrf-rules/password-attempt-limits/practice-verify-passwords-only-through-failurelimiter-attempt.md) — Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly.
### #admin
- Open [**Admin user management API and the last-active-admin rule**](map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Invites and password-reset links in account_tokens**](map-invites-and-password-reset-links-in-account-tokens.md) — Hashed invite and reset links, email-locked sign-up invites, SMTP delivery, shared limits and safe failed-send cleanup.
- Open [**Instance settings: /api/app/admin/settings**](map-instance-settings-api-app-admin-settings-and-setting-rules.md) — Runtime session, invite and boolean sign-up settings, including mail readiness and the public status flag; the time resolution is a per-user preference.
### #architecture
- Open [**API composition root: services, HTTP app and clock**](../map-api-composition-root-services-http-app-and-clock.md) — index.ts builds createApplicationServices, then createHttpApp over them, and holds the typed close; tests compose the same two pieces through composeApp and pass a fixed Clock.
- Open [**Signed-in operations bind the authenticated user at construction**](practice-signed-in-operations-bind-the-authenticated-user.md) — entriesFor, timersFor, catalogsFor, importsFor, preferencesFor and accountsFor take the Authentication once; routes never pass the user's id or the admin actor again.
### #database
- Open [**Project and task totals rely on the live-entry partial indexes**](../reports-and-totals/practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Users, roles and workspace membership**](map-users-roles-and-workspace-membership.md) — Account roles, scoped membership contracts, protected writes and neutral multi-user fixtures.
- Open [**Creates take an Idempotency-Key, recorded in the create's own transaction**](../toggl-compat-and-import/practice-creates-take-an-idempotency-key.md) — v9 entry and catalog creates, timer and Pomodoro start and entry split run once per user and key for 24 hours; a different request with the key is 422.
### #invites
- Open [**Invites and password-reset links in account_tokens**](map-invites-and-password-reset-links-in-account-tokens.md) — Hashed invite and reset links, email-locked sign-up invites, SMTP delivery, shared limits and safe failed-send cleanup.
### #migrations
- Open [**Project and task totals rely on the live-entry partial indexes**](../reports-and-totals/practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Users, roles and workspace membership**](map-users-roles-and-workspace-membership.md) — Account roles, scoped membership contracts, protected writes and neutral multi-user fixtures.
- Open [**Browser storage restart and migration isolation**](../../tooling-and-project/testing/e2e-suite/map-rewinddatabase-the-migration-upgrade-e2e-scenarios-in-auth-browser-spec-ts.md) — Browser restart tests preserve real accounts/preferences; explicit storage fixtures own migration and legacy refusal checks.
### #preferences
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in accountValues.ts validates the keys Tokkl clients read, Pomodoro included; other keys pass through; bad stored values read back as defaults.
- Open [**Pomodoro length preferences: shared defaults for new sessions**](../../web-ui-behaviour/pomodoro/map-pomodoro-cycle-functions-in-packages-common.md) — Four Pomodoro length preferences seed new sessions; API and web share common defaults, and API validation uses common ranges.
### #settings
- Open [**Instance settings: /api/app/admin/settings**](map-instance-settings-api-app-admin-settings-and-setting-rules.md) — Runtime session, invite and boolean sign-up settings, including mail readiness and the public status flag; the time resolution is a per-user preference.
### #validation
- Open [**Parse incoming timestamps with parseInstant**](../time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
### #workspaces
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](../../tooling-and-project/repo-and-scripts/map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**Users, roles and workspace membership**](map-users-roles-and-workspace-membership.md) — Account roles, scoped membership contracts, protected writes and neutral multi-user fixtures.