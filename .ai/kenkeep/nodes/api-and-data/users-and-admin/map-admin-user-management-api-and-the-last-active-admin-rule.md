---
type: map
title: Admin user management API and the last-active-admin rule
description: >-
  /api/app/admin users: list, role, disable, session revoke, delete; one active
  admin must remain; disabled accounts are refused at sign-in.
tags:
  - server
  - auth
  - admin
kk_schema_version: 3
kk_id: map-admin-user-management-api-and-the-last-active-admin-rule
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:7'
kk_relates_to:
  - map-users-roles-and-workspace-membership
kk_depends_on: []
kk_confidence: high
---
`packages/api/src/routes/admin.ts` is mounted at `/api/app/admin` in `packages/api/src/app.ts`, behind `requireAuth` and then `requireAdmin` (`packages/api/src/auth/storageMiddleware.ts`). `requireAdmin` accepts only an active admin (`isActiveAdmin`: `users.role` is `'admin'` and `disabled_at` is null) and otherwise answers 403 "Admin access required".

- `GET /users` lists every account through `serializeAccount` in `packages/api/src/domain/accountValues.ts`: `id`, `email`, `fullname`, `role`, `created_at` and `disabled_at` only. Never add the password hash or API token to it.
- `PATCH /users/:id` takes `role` (`'admin'` or `'user'`) and/or `disabled` (boolean). Disabling deletes all of the account's sessions; re-enabling clears `disabled_at`.
- `POST /users/:id/sessions/revoke` deletes all of the account's sessions and answers `{ ok: true }`. The API token keeps working.

At least one active admin must remain. The PATCH reads the account, counts active admins, updates the row and deletes sessions in one `transaction` (instance-administration guard, `packages/api/src/storage/transactions.ts`), so two concurrent requests cannot each remove what they see as the second-to-last admin. A change that would leave none answers 400 "At least one active admin must remain".

`DELETE /users/:id` removes an account for good; disabling is the reversible option. The body must repeat the account's email, compared with `normalizeEmail`, or the answer is 400. It also answers 400 for the caller's own account and for the last active admin. One `transaction` runs `deleteSoleMemberWorkspaces` (`models/workspaces.ts`, which cascades to the workspace's clients, projects, tasks, tags and entries), `revokeInvitesCreatedBy` (the user's unused invites) and the `users` delete, which cascades sessions, memberships and tokens tied to the account. Used invites and stored settings keep their rows with `created_by` or `updated_by` set to NULL.

A disabled account is refused on every sign-in path with the same answer as bad credentials: `findSessionUser` ignores its session cookies, Basic auth with its API token or password fails, and form login fails. Use `isActiveUser` when adding another path.

<!-- kk:related:start -->
# Related

- Related: [map-users-roles-and-workspace-membership](map-users-roles-and-workspace-membership.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:7
<!-- kk:citations:end -->
