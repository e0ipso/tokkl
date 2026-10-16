---
type: map
title: 'Users, roles and workspace membership (migration 3)'
description: >-
  users.role, users.disabled_at and workspace_users come from migration 3;
  helpers live in models/workspaces.ts.
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

The backfill makes every existing user an admin and gives every existing workspace to the single lowest-id user as owner, since setup allowed only one account before this migration. `createOwner` in `packages/api/src/models/users.ts` inserts the first user as `'admin'` and adds the owner membership in the same transaction.

`addWorkspaceMember`, `isWorkspaceMember` and `listWorkspacesForUser` live in `packages/api/src/models/workspaces.ts`. Routes do not call them yet, so being signed in is still the only check on workspace access; do not assume membership is enforced.

`packages/api/test/entities.test.ts` asserts `PRAGMA user_version` equals both `MIGRATIONS.length` and a literal (now 3). A new migration must bump that literal.

<!-- kk:related:start -->
# Related

- Related: [practice-live-entry-indexes-back-project-and-task-totals](practice-live-entry-indexes-back-project-and-task-totals.md)
- Related: [practice-password-checks-and-csrf-rules](practice-password-checks-and-csrf-rules.md)
<!-- kk:related:end -->
