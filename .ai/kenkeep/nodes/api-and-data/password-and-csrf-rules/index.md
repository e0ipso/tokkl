# kenkeep Index: api-and-data / password-and-csrf-rules

↑ Parent: [api-and-data](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Cookie writes and session-starting routes need the CSRF header**](practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md) to learn about: Cookie writes, login, setup, invite accept and password reset need X-Tokkl-CSRF: 1 before any lookup; callers and tests must send it. #server #auth #csrf
- Open [**Password checks go through FailureLimiter.attempt**](practice-password-checks-go-through-failurelimiter-attempt.md) to learn about: Password checks charge three counters; 429s send Retry-After; disabled accounts fail like bad passwords; new passwords use readNewPassword. #server #auth #rate-limit

## Components (what exists)
_None yet._

## By topic

### #auth
- Open [**Admin user management API and the last-active-admin rule**](../users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**First-admin setup code is shared through setup_codes**](../users-and-admin/map-first-admin-setup-code-is-shared-through-setup-codes.md) — Without TOKKL_SETUP_CODE, one SHA-256 setup-code hash lives in setup_codes; setup rechecks it under the instance lock and deletes it with the admin insert.
- Open [**Invites and password-reset links in account_tokens**](../users-and-admin/map-invites-and-password-reset-links-in-account-tokens.md) — Invite and reset tokens are hashed in account_tokens, shown once, and give one 404 for any bad link; a reset rotates the API token.
### #server
- Open [**Admin user management API and the last-active-admin rule**](../users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**First-admin setup code is shared through setup_codes**](../users-and-admin/map-first-admin-setup-code-is-shared-through-setup-codes.md) — Without TOKKL_SETUP_CODE, one SHA-256 setup-code hash lives in setup_codes; setup rechecks it under the instance lock and deletes it with the admin insert.
- Open [**Invites and password-reset links in account_tokens**](../users-and-admin/map-invites-and-password-reset-links-in-account-tokens.md) — Invite and reset tokens are hashed in account_tokens, shown once, and give one 404 for any bad link; a reset rotates the API token.
### #csrf
- Open [**Cookie writes and session-starting routes need the CSRF header**](practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md) — Cookie writes, login, setup, invite accept and password reset need X-Tokkl-CSRF: 1 before any lookup; callers and tests must send it.
### #rate-limit
- Open [**Password checks go through FailureLimiter.attempt**](practice-password-checks-go-through-failurelimiter-attempt.md) — Password checks charge three counters; 429s send Retry-After; disabled accounts fail like bad passwords; new passwords use readNewPassword.