# kenkeep Index: api-and-data / users-and-admin

↑ Parent: [api-and-data](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) to learn about: PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults. #server #preferences #validation

## Components (what exists)
- Open [**Users, roles and workspace membership**](map-users-roles-and-workspace-membership.md) to learn about: Migration 3 schema, createFirstAdmin, memberWorkspace and where it gates access, shared-workspace preconditions, and multi-user API test helpers. #server #database #migrations #auth #workspaces
- Open [**Admin user management API and the last-active-admin rule**](map-admin-user-management-api-and-the-last-active-admin-rule.md) to learn about: /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in. #server #auth #admin
- Open [**Instance settings: /api/app/admin/settings and SETTING_RULES**](map-instance-settings-api-app-admin-settings-and-setting-rules.md) to learn about: session_days, invite_days and time_resolution_minutes live in instance_settings, validated by SETTING_RULES; v9 /me exposes the resolution. #server #admin #settings
- Open [**Invites and password-reset links in account_tokens**](map-invites-and-password-reset-links-in-account-tokens.md) to learn about: Invite and reset tokens are hashed in account_tokens, shown once, and give one 404 for any bad link; a reset rotates the API token. #server #auth #admin #invites

## By topic

### #server
- Open [**Admin user management API and the last-active-admin rule**](map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Parse incoming timestamps with parseInstant**](../time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
### #admin
- Open [**Admin user management API and the last-active-admin rule**](map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Invites and password-reset links in account_tokens**](map-invites-and-password-reset-links-in-account-tokens.md) — Invite and reset tokens are hashed in account_tokens, shown once, and give one 404 for any bad link; a reset rotates the API token.
- Open [**Instance settings: /api/app/admin/settings and SETTING_RULES**](map-instance-settings-api-app-admin-settings-and-setting-rules.md) — session_days, invite_days and time_resolution_minutes live in instance_settings, validated by SETTING_RULES; v9 /me exposes the resolution.
### #auth
- Open [**Admin user management API and the last-active-admin rule**](map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Invites and password-reset links in account_tokens**](map-invites-and-password-reset-links-in-account-tokens.md) — Invite and reset tokens are hashed in account_tokens, shown once, and give one 404 for any bad link; a reset rotates the API token.
- Open [**Cookie writes and session-starting routes need the CSRF header**](../password-and-csrf-rules/practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md) — Cookie writes, login, setup, invite accept and password reset need X-Tokkl-CSRF: 1 before any lookup; callers and tests must send it.
### #database
- Open [**Users, roles and workspace membership**](map-users-roles-and-workspace-membership.md) — Migration 3 schema, createFirstAdmin, memberWorkspace and where it gates access, shared-workspace preconditions, and multi-user API test helpers.
- Open [**Project and task totals rely on the live-entry partial indexes**](../reports-and-totals/practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
### #invites
- Open [**Invites and password-reset links in account_tokens**](map-invites-and-password-reset-links-in-account-tokens.md) — Invite and reset tokens are hashed in account_tokens, shown once, and give one 404 for any bad link; a reset rotates the API token.
### #migrations
- Open [**Users, roles and workspace membership**](map-users-roles-and-workspace-membership.md) — Migration 3 schema, createFirstAdmin, memberWorkspace and where it gates access, shared-workspace preconditions, and multi-user API test helpers.
- Open [**Project and task totals rely on the live-entry partial indexes**](../reports-and-totals/practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
### #preferences
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults.
### #settings
- Open [**Instance settings: /api/app/admin/settings and SETTING_RULES**](map-instance-settings-api-app-admin-settings-and-setting-rules.md) — session_days, invite_days and time_resolution_minutes live in instance_settings, validated by SETTING_RULES; v9 /me exposes the resolution.
### #validation
- Open [**Parse incoming timestamps with parseInstant**](../time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
### #workspaces
- Open [**npm workspaces: packages/common, packages/api, packages/web, packages/types**](../../tooling-and-project/repo-and-scripts/map-npm-workspaces-package-layout.md) — Four @tokkl workspaces; common and types ship raw .ts; run scripts from the root; npm install per worktree.
- Open [**Users, roles and workspace membership**](map-users-roles-and-workspace-membership.md) — Migration 3 schema, createFirstAdmin, memberWorkspace and where it gates access, shared-workspace preconditions, and multi-user API test helpers.