---
type: map
title: 'Users, roles and workspace membership'
description: >-
  Migration 3 schema, createFirstAdmin, membership helpers, which routes check
  membership, and the multi-user API test helpers.
tags:
  - server
  - database
  - migrations
  - auth
  - workspaces
kk_schema_version: 3
kk_id: map-users-roles-and-workspace-membership
kk_derived_from: []
kk_relates_to:
  - practice-live-entry-indexes-back-project-and-task-totals
  - practice-password-checks-and-csrf-rules
kk_depends_on: []
kk_confidence: high
---
The third entry of `MIGRATIONS` in `packages/api/src/db/migrations.ts` adds the multi-user schema:

- `users.role`: `'admin'` or `'user'`, default `'user'`.
- `users.disabled_at`: nullable timestamp for suspended accounts.
- `workspace_users(workspace_id, user_id, role)`: `role` is `'owner'` or `'member'`, the primary key is the `(workspace_id, user_id)` pair, `workspace_users_user` indexes `user_id`, and both foreign keys cascade on delete.

The backfill makes every existing user an admin and gives every existing workspace to the single lowest-id user as owner, since setup allowed only one account before this migration. `createFirstAdmin` in `packages/api/src/models/users.ts` creates the first user as `'admin'` with a new workspace it owns, in one transaction, and refuses once any user exists. The setup route in `packages/api/src/routes/app.ts` calls it. Until it has run, `packages/api/src/index.ts` logs `No admin account yet. Open the web UI and use this setup code to create it: <code>` at startup.

The membership helpers live in `packages/api/src/models/workspaces.ts`: `addWorkspaceMember`, `isWorkspaceMember`, `getWorkspaceRole`, `countWorkspaceMembers`, `listWorkspaceMembers` and `listWorkspacesForUser`. `serializeWorkspace(ws, membership)` takes the caller's `workspace_users` role: `'owner'` gives `admin: true` and `role: 'admin'`, anything else gives `false` and `'user'`. `users.role` is the instance role and never appears in a Toggl-shaped response. In `packages/api/src/routes/togglV9.ts`, `/me/organizations` lists only the caller's workspaces with a real `user_count`, and `GET /api/v9/workspaces/:wid/users` returns 403 to non-members.

Membership is not enforced anywhere else yet. `workspaceFor` only checks that the workspace exists, and `/me/workspaces`, the other `/me` lists and the JSON export (`packages/api/src/services/export.ts`) still use `listWorkspaces`, which returns every workspace. Check the route before assuming a non-member is refused.

For multi-user API tests, `addUser(ctx, { email, role })` in `packages/api/test/helpers.ts` adds an account that owns its own workspace and returns a `TestContext` signed in as it. Every context on one database shares one app (a `WeakMap` keyed by `Db`), so they also share the rate limiters. `sessionCookie(ctx)` logs in through `/api/app/login` and returns the `tokkl_session=...` pair; send it with `authorization: ''`, or the API token still signs the request in.

`packages/api/test/entities.test.ts` asserts `PRAGMA user_version` equals both `MIGRATIONS.length` and a literal (now 3). A new migration must bump that literal.

<!-- kk:related:start -->
# Related

- Related: [practice-live-entry-indexes-back-project-and-task-totals](practice-live-entry-indexes-back-project-and-task-totals.md)
- Related: [practice-password-checks-and-csrf-rules](practice-password-checks-and-csrf-rules.md)
<!-- kk:related:end -->
