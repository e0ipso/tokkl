---
type: map
title: Admin API and disabled accounts
description: >-
  /api/app/admin user list, role and disable changes, session revoke;
  last-active-admin rule; where disabled accounts are refused.
tags:
  - server
  - auth
  - admin
kk_schema_version: 3
kk_id: map-admin-api-and-disabled-accounts
kk_derived_from: []
kk_relates_to:
  - map-users-roles-and-workspace-membership
  - practice-password-checks-and-csrf-rules
kk_depends_on: []
kk_confidence: high
---
`packages/api/src/routes/admin.ts` is mounted at `/api/app/admin` in `packages/api/src/app.ts`, behind `requireAuth` and then `requireAdmin` (`packages/api/src/auth/middleware.ts`). `requireAdmin` accepts only an active admin (`isActiveAdmin`: `users.role` is `'admin'` and `disabled_at` is null) and otherwise answers 403 "Admin access required".

- `GET /users` lists every account through `serializeAccount` in `packages/api/src/models/users.ts`: `id`, `email`, `fullname`, `role`, `created_at` and `disabled_at` only. Never add the password hash or API token to it.
- `PATCH /users/:id` takes `role` (`'admin'` or `'user'`) and/or `disabled` (boolean). Disabling deletes all of the account's sessions; re-enabling clears `disabled_at`.
- `POST /users/:id/sessions/revoke` deletes all of the account's sessions and answers `{ ok: true }`. The API token keeps working.

At least one active admin must remain. The PATCH reads the account, counts active admins, updates the row and deletes sessions in one `transaction` (`BEGIN IMMEDIATE`, `packages/api/src/db/index.ts`), so two concurrent requests cannot each remove what they see as the second-to-last admin. A change that would leave none answers 400 "At least one active admin must remain".

A disabled account is refused on every sign-in path with the same answer as bad credentials: `findSessionUser` ignores its session cookies, Basic auth with its API token or password fails, and form login fails. Use `isActiveUser` when adding another path.

<!-- kk:related:start -->
# Related

- Related: [map-users-roles-and-workspace-membership](map-users-roles-and-workspace-membership.md)
- Related: [practice-password-checks-and-csrf-rules](practice-password-checks-and-csrf-rules.md)
<!-- kk:related:end -->
