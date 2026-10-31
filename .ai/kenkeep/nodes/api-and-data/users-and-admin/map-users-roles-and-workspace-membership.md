---
type: map
title: 'Users, roles and workspace membership'
description: >-
  Account roles, scoped membership contracts, protected writes and neutral
  multi-user fixtures.
tags:
  - server
  - database
  - migrations
  - auth
  - workspaces
kk_schema_version: 3
kk_id: map-users-roles-and-workspace-membership
kk_derived_from:
  - .ai/kenkeep/nodes/.redirects.json
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:8'
kk_relates_to:
  - practice-live-entry-indexes-back-project-and-task-totals
  - practice-password-checks-go-through-failurelimiter-attempt
  - map-admin-user-management-api-and-the-last-active-admin-rule
  - map-invites-and-password-reset-links-in-account-tokens
  - map-instance-settings-api-app-admin-settings-and-setting-rules
kk_depends_on: []
kk_confidence: high
---
The fresh schema in `packages/api/src/storage/schema.ts` defines:

- `users.role`: `'admin'` or `'user'`, default `'user'`.
- `users.disabled_at`: nullable timestamp for suspended accounts.
- `workspace_users(workspace_id, user_id, role)`: `role` is `'owner'` or `'member'`, the primary key is the `(workspace_id, user_id)` pair, `workspace_users_user` indexes `user_id`, and both foreign keys cascade on delete.

`createFirstAdmin` in `packages/api/src/domain/accounts.ts` creates the first user as `'admin'` with a new workspace it owns, in one transaction, and refuses once any user exists. The setup route in `packages/api/src/routes/app.ts` calls it. Until it has run, `packages/api/src/index.ts` logs `No admin account yet. Open the web UI and use this setup code to create it: <code>` at startup.

Membership operations use transaction-bound workspace repository contracts in `storage/contracts.ts`, implemented by `storage/repositories/accounts.ts`. `serializeWorkspace(ws, membership)` takes the caller's `workspace_users` role: `'owner'` gives `admin: true` and `role: 'admin'`, anything else gives `false` and `'user'`. `users.role` is the instance role. The one Toggl-shaped response that carries it is `GET /api/v9/me`, as a Tokkl-only `role` (`'admin'` or `'user'`, typed on `Me` in `packages/types/index.ts`) that the web app uses to show the Admin area; the other `/me` fields, `PUT /me` and the exports are unchanged. The server's 403 on `/api/app/admin/*` is the protection, not the hidden nav entry.

Workspace-scoped paths verify `ctx.workspaces.forMember(userId, wid)` before reads or writes; missing membership returns403 without distinguishing missing workspaces. Protected imports and timer/catalog writes recheck membership under transaction guards. A stored default workspace is not authorization. `PUT /me` rejects an inaccessible default workspace.

The `/me` collections (`/me/workspaces`, `/me/organizations` with a real `user_count`, and the per-workspace lists) and `buildJsonExport` in `services/storageExport.ts` use membership-scoped repository projections. There is no helper that lists every workspace on the instance; add one only for a deliberate admin feature.

Shared workspaces are out of scope in `docs/PRD.md`: each account tracks time in its own workspace and data is never shared between accounts. Account creation through the users repository inserts an owner membership for a new workspace. First-admin setup, invite acceptance and the `addUser` test helper all go through it. Some code relies on one member per workspace. Fix these before adding shared workspaces (several members in one workspace):

- `deleteProject` in `domain/catalogs.ts` with `teDeletionMode=delete` trashes the entries of every user on that project, not only the caller's.
- Project `actual_seconds`/`actual_hours` (`storage/repositories/catalogs.ts`) and task `tracked_seconds` (`storage/repositories/catalogs.ts`) sum every user's live entries.

For multi-user API tests, `addUser(ctx, { email, role })` in `packages/api/test/helpers.ts` adds an account that owns its own workspace and returns a `TestContext` signed in as it. Every context on one database shares one app (a `WeakMap` keyed by neutral `FixtureDatabase` identity), so they also share the rate limiters. `sessionCookie(ctx)` logs in through `/api/app/login` and returns the `tokkl_session=...` pair; send it with `authorization: ''`, or the API token still signs the request in.

Migration tests inspect the checksum/state/schema ledger and actual engine constraints. Unsupported legacy SQLite is refused rather than backfilled.

<!-- kk:related:start -->
# Related

- Related: [practice-live-entry-indexes-back-project-and-task-totals](../reports-and-totals/practice-live-entry-indexes-back-project-and-task-totals.md)
- Related: [practice-password-checks-go-through-failurelimiter-attempt](../password-and-csrf-rules/practice-password-checks-go-through-failurelimiter-attempt.md)
- Related: [map-admin-user-management-api-and-the-last-active-admin-rule](map-admin-user-management-api-and-the-last-active-admin-rule.md)
- Related: [map-invites-and-password-reset-links-in-account-tokens](map-invites-and-password-reset-links-in-account-tokens.md)
- Related: [map-instance-settings-api-app-admin-settings-and-setting-rules](map-instance-settings-api-app-admin-settings-and-setting-rules.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [.ai/kenkeep/nodes/.redirects.json](../../.redirects.json)
[2] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:8
<!-- kk:citations:end -->
