---
type: map
title: Invites and password-reset links in account_tokens
description: >-
  Invite and reset tokens are hashed in account_tokens, shown once, and give one
  404 for any bad link; a reset rotates the API token.
tags:
  - server
  - auth
  - admin
  - invites
kk_schema_version: 3
kk_id: map-invites-and-password-reset-links-in-account-tokens
kk_derived_from: []
kk_relates_to:
  - map-users-roles-and-workspace-membership
  - practice-password-checks-go-through-failurelimiter-attempt
  - practice-cookie-writes-and-session-starting-routes-need-the-csrf-header
kk_depends_on: []
kk_confidence: high
---
These routes are in `packages/api/src/routes/admin.ts`, mounted at `/api/app/admin` behind `requireAuth` and `requireAdmin`, so only an active admin reaches them.

Invites use the `account_tokens` table (migration 5; `kind` is `invite` or `password_reset`) and `models/accountTokens.ts`. The token is 256 random bits, only its SHA-256 is stored, and `POST /invites` is the one response that carries it, as `url: /invite/<token>`. `GET /invites` lists unused, unexpired invites and `DELETE /invites/:id` revokes one by row id. An invite expires after the `invite_days` setting. The public routes `GET` and `POST /api/app/invites/:token` (in `routes/app.ts`, with no login) answer one identical 404 (`INVITE_NOT_FOUND`) for unknown, expired, used and revoked tokens. `POST` runs `acceptInvite`, which in one transaction re-checks the invite, creates the user through `insertAccount`, gives it a private workspace it owns as its default, and marks the token used, then starts a session. `insertAccount` and the field checks in `readNewAccount` are shared with first-admin setup. The web page is `InvitePage` at `/invite/:token` (`packages/web/src/pages/InvitePage.tsx`), reachable signed in or not.

Password resets reuse `account_tokens` with `kind = 'password_reset'` (`createPasswordReset`, `resetPassword`, `findResetUser` in `models/accountTokens.ts`). `POST /users/:id/password-reset` answers `{ url: /reset/<token>, expires_at }` once, the only response with the token. The link lasts `PASSWORD_RESET_HOURS` (24), deletes the account's earlier unused reset links, and a disabled account is a 400. The public routes `GET` and `POST /api/app/password-resets/:token` (in `routes/app.ts`) answer one 404 (`RESET_NOT_FOUND`) for every bad link, and a miss charges the address counter. `GET` returns `{ email }`. `POST` requires the CSRF header first, then in one transaction sets the hash, replaces the API token with `generateApiToken`, marks the link used and deletes all of the account's sessions. It starts no session; the user logs in and reads the new token from `GET /me`. `PUT /me` with a new password also replaces the token, in the same transaction as the password, and returns the new one. It then clears the account and account+address failed-login counters but keeps the address counter. The web page is `ResetPasswordPage` at `/reset/:token`, reachable while logged out; it and `InvitePage` share `pages/linkCheck.tsx`, and `AdminPage` shows a new invite or reset link once in its local `NewLink`. See the password node for the stale-hash check.

<!-- kk:related:start -->
# Related

- Related: [map-users-roles-and-workspace-membership](map-users-roles-and-workspace-membership.md)
- Related: [practice-password-checks-go-through-failurelimiter-attempt](../password-and-csrf-rules/practice-password-checks-go-through-failurelimiter-attempt.md)
- Related: [practice-cookie-writes-and-session-starting-routes-need-the-csrf-header](../password-and-csrf-rules/practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md)
<!-- kk:related:end -->
