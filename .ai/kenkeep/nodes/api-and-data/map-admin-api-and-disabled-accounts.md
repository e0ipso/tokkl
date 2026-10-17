---
type: map
title: Admin API and disabled accounts
description: >-
  /api/app/admin users, delete, invites and instance settings; public invite
  routes; last-active-admin rule; where disabled accounts are refused.
tags:
  - server
  - auth
  - admin
  - invites
  - settings
kk_schema_version: 3
kk_id: map-admin-api-and-disabled-accounts
kk_derived_from: []
kk_relates_to:
  - map-users-roles-and-workspace-membership
  - practice-password-checks-go-through-failurelimiter-attempt
kk_depends_on: []
kk_confidence: high
---
`packages/api/src/routes/admin.ts` is mounted at `/api/app/admin` in `packages/api/src/app.ts`, behind `requireAuth` and then `requireAdmin` (`packages/api/src/auth/middleware.ts`). `requireAdmin` accepts only an active admin (`isActiveAdmin`: `users.role` is `'admin'` and `disabled_at` is null) and otherwise answers 403 "Admin access required".

- `GET /users` lists every account through `serializeAccount` in `packages/api/src/models/users.ts`: `id`, `email`, `fullname`, `role`, `created_at` and `disabled_at` only. Never add the password hash or API token to it.
- `PATCH /users/:id` takes `role` (`'admin'` or `'user'`) and/or `disabled` (boolean). Disabling deletes all of the account's sessions; re-enabling clears `disabled_at`.
- `POST /users/:id/sessions/revoke` deletes all of the account's sessions and answers `{ ok: true }`. The API token keeps working.

At least one active admin must remain. The PATCH reads the account, counts active admins, updates the row and deletes sessions in one `transaction` (`BEGIN IMMEDIATE`, `packages/api/src/db/index.ts`), so two concurrent requests cannot each remove what they see as the second-to-last admin. A change that would leave none answers 400 "At least one active admin must remain".

`DELETE /users/:id` removes an account for good; disabling is the reversible option. The body must repeat the account's email, compared with `normalizeEmail`, or the answer is 400. It also answers 400 for the caller's own account and for the last active admin. One `transaction` runs `deleteSoleMemberWorkspaces` (`models/workspaces.ts`, which cascades to the workspace's clients, projects, tasks, tags and entries), `revokeInvitesCreatedBy` (the user's unused invites) and the `users` delete, which cascades sessions, memberships and tokens tied to the account. Used invites and stored settings keep their rows with `created_by` or `updated_by` set to NULL.

Invites use the `account_tokens` table (migration 5; `kind` is `invite` or `password_reset`) and `models/accountTokens.ts`. The token is 256 random bits, only its SHA-256 is stored, and `POST /invites` is the one response that carries it, as `url: /invite/<token>`. `GET /invites` lists unused, unexpired invites and `DELETE /invites/:id` revokes one by row id. An invite expires after the `invite_days` setting. The public routes `GET` and `POST /api/app/invites/:token` (in `routes/app.ts`, with no login) answer one identical 404 (`INVITE_NOT_FOUND`) for unknown, expired, used and revoked tokens. `POST` runs `acceptInvite`, which in one transaction re-checks the invite, creates the user through `insertAccount`, gives it a private workspace it owns as its default, and marks the token used, then starts a session. `insertAccount` and the field checks in `readNewAccount` are shared with first-admin setup. The web page is `InvitePage` at `/invite/:token` (`packages/web/src/pages/InvitePage.tsx`), reachable signed in or not.

Password resets reuse `account_tokens` with `kind = 'password_reset'` (`createPasswordReset`, `resetPassword`, `findResetUser` in `models/accountTokens.ts`). `POST /users/:id/password-reset` answers `{ url: /reset/<token>, expires_at }` once, the only response with the token. The link lasts `PASSWORD_RESET_HOURS` (24), deletes the account's earlier unused reset links, and a disabled account is a 400. The public routes `GET` and `POST /api/app/password-resets/:token` (in `routes/app.ts`) answer one 404 (`RESET_NOT_FOUND`) for every bad link, and a miss charges the address counter. `GET` returns `{ email }`. `POST` requires the CSRF header first, then in one transaction sets the hash, marks the link used and deletes all of the account's sessions. It starts no session, and the API token is not changed. It then clears the account and account+address failed-login counters but keeps the address counter. The web page is `ResetPasswordPage` at `/reset/:token`, reachable while logged out; it and `InvitePage` share `pages/linkCheck.tsx`, and `AdminPage` shows a new invite or reset link once in its local `NewLink`. See the password node for the stale-hash check.

`GET` and `PUT /settings` read and change the runtime settings in `instance_settings` (migration 4, JSON values, `updated_by` set to NULL when its admin is deleted); `getInstanceSettings` in `models/settings.ts` returns the effective values. There are three, typed in `InstanceSettings` (`packages/types/index.ts`):

- `session_days`: the stored value, else `TOKKL_SESSION_DAYS`, else 30; an integer from 1 to 365. New logins and new accounts take the current value; sessions that exist keep their expiry.
- `invite_days`: the stored value, else 7; from 1 to 90.
- `time_resolution_minutes`: the stored value, else 5; one of the divisors of 60 (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60). Live writes of stopped entries snap to it; see `practice-stopped-entries-snap-to-the-time-resolution-on-write`.

Each entry of `SETTING_RULES` is either a `{ min, max }` range or an `{ allowed }` set, plus a `fallback`. A stored value that fails its rule is ignored on read and the fallback applies. An unknown key or a value that fails its rule is a 400 that names the field (`Invalid time_resolution_minutes: expected one of 1, 2, ...`) and stores nothing. A PUT may carry any subset of the keys. Everything else in `Config` (server, paths, setup) stays env-only. To add a setting, add a key to `InstanceSettings` and a rule to `SETTING_RULES`.

`GET /api/v9/me` (`routes/togglV9.ts`) carries `time_resolution_minutes` next to `role` for every signed-in user, not only admins, as a Tokkl-only field. Clients read the resolution there. In the e2e suite, `saveInstanceSettings` in `e2e/fixtures.ts` takes a `Partial<InstanceSettings>`, and `me()` returns the signed-in account's `role` and `time_resolution_minutes`.

A disabled account is refused on every sign-in path with the same answer as bad credentials: `findSessionUser` ignores its session cookies, Basic auth with its API token or password fails, and form login fails. Use `isActiveUser` when adding another path.

<!-- kk:related:start -->
# Related

- Related: [map-users-roles-and-workspace-membership](map-users-roles-and-workspace-membership.md)
- Related: [practice-password-checks-go-through-failurelimiter-attempt](password-and-csrf-rules/practice-password-checks-go-through-failurelimiter-attempt.md)
<!-- kk:related:end -->
