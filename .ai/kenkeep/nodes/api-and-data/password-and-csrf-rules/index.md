# kenkeep Index: api-and-data / password-and-csrf-rules

↑ Parent: [api-and-data](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Password checks go through FailureLimiter.attempt**](practice-password-checks-go-through-failurelimiter-attempt.md) to learn about: Password checks charge three counters; 429s send Retry-After; disabled accounts fail like bad passwords; new passwords use readNewPassword. #server #auth #rate-limit
- Open [**Cookie writes and session-starting routes need the CSRF header**](practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md) to learn about: Cookie writes, login, setup, invite accept and password reset need X-Tokkl-CSRF: 1 before any lookup; callers and tests must send it. #server #auth #csrf

## Components (what exists)
_None yet._

## By topic

### #auth
- Open [**Password checks go through FailureLimiter.attempt**](practice-password-checks-go-through-failurelimiter-attempt.md) — Password checks charge three counters; 429s send Retry-After; disabled accounts fail like bad passwords; new passwords use readNewPassword.
- Open [**Cookie writes and session-starting routes need the CSRF header**](practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md) — Cookie writes, login, setup, invite accept and password reset need X-Tokkl-CSRF: 1 before any lookup; callers and tests must send it.
- Open [**Admin API and disabled accounts**](../map-admin-api-and-disabled-accounts.md) — /api/app/admin users, delete, invites and instance settings; public invite routes; last-active-admin rule; where disabled accounts are refused.
### #server
- Open [**Toggl CSV import: choose team-export users by opaque key**](../practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Parse incoming timestamps with parseInstant**](../practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](../practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults.
### #csrf
- Open [**Cookie writes and session-starting routes need the CSRF header**](practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md) — Cookie writes, login, setup, invite accept and password reset need X-Tokkl-CSRF: 1 before any lookup; callers and tests must send it.
### #rate-limit
- Open [**Password checks go through FailureLimiter.attempt**](practice-password-checks-go-through-failurelimiter-attempt.md) — Password checks charge three counters; 429s send Retry-After; disabled accounts fail like bad passwords; new passwords use readNewPassword.