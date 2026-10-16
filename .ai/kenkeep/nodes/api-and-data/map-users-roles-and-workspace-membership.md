---
type: map
title: 'Users, roles and workspace membership'
description: >-
  Migration 3 schema, createFirstAdmin, memberWorkspace and where it gates
  access, shared-workspace preconditions, and multi-user API test helpers.
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

The membership helpers live in `packages/api/src/models/workspaces.ts`: `addWorkspaceMember`, `isWorkspaceMember`, `memberWorkspace`, `getWorkspaceRole`, `countWorkspaceMembers`, `listWorkspaceMembers` and `listWorkspacesForUser`. `serializeWorkspace(ws, membership)` takes the caller's `workspace_users` role: `'owner'` gives `admin: true` and `role: 'admin'`, anything else gives `false` and `'user'`. `users.role` is the instance role and never appears in a Toggl-shaped response.

`memberWorkspace(db, userId, wid)` returns the workspace only when the user is a member. Otherwise it throws 403 with `NO_WORKSPACE_ACCESS` ("User does not have access to this resource."), also when the workspace does not exist, so a non-member cannot tell the two apart. Every workspace-scoped path goes through it: both `workspaceFor` helpers (`routes/togglV9.ts` and the Reports v3 routes in `routes/reports.ts`), `GET /api/v9/workspaces/:wid/users`, the app report routes (on the user's `default_workspace_id`), `restoreTimeEntry` inside its transaction, and the JSON and CSV imports (`services/importJson.ts`, `services/importCsv.ts`), dry runs included. A stored `default_workspace_id` can predate the checks or outlive the membership, so code that acts on it calls `memberWorkspace` instead of trusting it. `PUT /api/v9/me` refuses a `default_workspace_id` the caller is not a member of with 400 "Invalid default_workspace_id". A new workspace-scoped route or service must call `memberWorkspace` too.

The `/me` collections (`/me/workspaces`, `/me/organizations` with a real `user_count`, and the per-workspace lists) and `buildJsonExport` in `services/export.ts` use `listWorkspacesForUser`. There is no helper that lists every workspace on the instance; add one only for a deliberate admin feature.

Shared workspaces are out of scope in `docs/PRD.md`: each account tracks time in its own workspace and data is never shared between accounts. Apart from the migration backfill, only `createFirstAdmin` (and the `addUser` test helper) writes `workspace_users` rows, always an owner of a new workspace. Some code relies on one member per workspace. Fix these before adding shared workspaces (several members in one workspace):

- `deleteProject` in `models/projects.ts` with `teDeletionMode=delete` trashes the entries of every user on that project, not only the caller's.
- Project `actual_seconds`/`actual_hours` (`models/projects.ts`) and task `tracked_seconds` (`models/tasks.ts`) sum every user's live entries.

For multi-user API tests, `addUser(ctx, { email, role })` in `packages/api/test/helpers.ts` adds an account that owns its own workspace and returns a `TestContext` signed in as it. Every context on one database shares one app (a `WeakMap` keyed by `Db`), so they also share the rate limiters. `sessionCookie(ctx)` logs in through `/api/app/login` and returns the `tokkl_session=...` pair; send it with `authorization: ''`, or the API token still signs the request in.

`packages/api/test/entities.test.ts` asserts `PRAGMA user_version` equals both `MIGRATIONS.length` and a literal (now 3). A new migration must bump that literal.

<!-- kk:related:start -->
# Related

- Related: [practice-live-entry-indexes-back-project-and-task-totals](practice-live-entry-indexes-back-project-and-task-totals.md)
- Related: [practice-password-checks-and-csrf-rules](practice-password-checks-and-csrf-rules.md)
<!-- kk:related:end -->
