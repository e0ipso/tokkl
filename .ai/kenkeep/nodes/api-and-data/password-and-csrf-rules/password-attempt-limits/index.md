# kenkeep Index: api-and-data / password-and-csrf-rules / password-attempt-limits

↑ Parent: [password-and-csrf-rules](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Verify passwords only through FailureLimiter.attempt**](practice-verify-passwords-only-through-failurelimiter-attempt.md) to learn about: Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly. #server #auth #rate-limit
- Open [**Charge invite and reset link misses to the address counter**](practice-charge-invite-and-reset-link-misses-to-the-address-counter.md) to learn about: Invite and reset token lookups charge misses to the 100-per-window address counter and answer 429 before lookup once it is full. #server #auth #rate-limit
- Open [**Key login rate limits with normalizeEmail, not toLowerCase**](practice-key-login-rate-limits-with-normalizeemail-not-tolowercase.md) to learn about: Rate-limit accounts are keyed by normalizeEmail (trim, ASCII A-Z lowercase), matching users.email_key; toLowerCase merges distinct users. #server #auth #rate-limit
- Open [**Recheck credentials inside the guarded account transaction**](practice-recheck-credentials-inside-the-guarded-account-transaction.md) to learn about: Auth and PUT /me recheck the account and credential under the guarded transaction, so revocations during scrypt refuse stale credentials. #server #auth
- Open [**Share password rate limits through database counters and reservations**](practice-share-password-rate-limits-through-database-counters-and-reservations.md) to learn about: Limiter counters and reservation leases live in the database, keyed by hash; attempt refuses with retryAfter and never queues. #server #auth #rate-limit #storage
- Open [**Validate new passwords with parseNewPassword**](practice-validate-new-passwords-with-parsenewpassword.md) to learn about: New passwords are 8-1024 characters and go through parseNewPassword; current passwords are not capped on login or rotation. #server #auth

## Components (what exists)
_None yet._

## By topic

### #auth
- Open [**Recheck credentials inside the guarded account transaction**](practice-recheck-credentials-inside-the-guarded-account-transaction.md) — Auth and PUT /me recheck the account and credential under the guarded transaction, so revocations during scrypt refuse stale credentials.
- Open [**Validate new passwords with parseNewPassword**](practice-validate-new-passwords-with-parsenewpassword.md) — New passwords are 8-1024 characters and go through parseNewPassword; current passwords are not capped on login or rotation.
- Open [**Verify passwords only through FailureLimiter.attempt**](practice-verify-passwords-only-through-failurelimiter-attempt.md) — Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly.
### #server
- Open [**Recheck credentials inside the guarded account transaction**](practice-recheck-credentials-inside-the-guarded-account-transaction.md) — Auth and PUT /me recheck the account and credential under the guarded transaction, so revocations during scrypt refuse stale credentials.
- Open [**Validate new passwords with parseNewPassword**](practice-validate-new-passwords-with-parsenewpassword.md) — New passwords are 8-1024 characters and go through parseNewPassword; current passwords are not capped on login or rotation.
- Open [**Verify passwords only through FailureLimiter.attempt**](practice-verify-passwords-only-through-failurelimiter-attempt.md) — Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly.
### #rate-limit
- Open [**Verify passwords only through FailureLimiter.attempt**](practice-verify-passwords-only-through-failurelimiter-attempt.md) — Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly.
- Open [**Charge invite and reset link misses to the address counter**](practice-charge-invite-and-reset-link-misses-to-the-address-counter.md) — Invite and reset token lookups charge misses to the 100-per-window address counter and answer 429 before lookup once it is full.
- Open [**Key login rate limits with normalizeEmail, not toLowerCase**](practice-key-login-rate-limits-with-normalizeemail-not-tolowercase.md) — Rate-limit accounts are keyed by normalizeEmail (trim, ASCII A-Z lowercase), matching users.email_key; toLowerCase merges distinct users.
### #storage
- Open [**Report job reads in SQL batches and golden report answers**](../../reports-and-totals/app-report-pipeline/map-report-job-reads-in-sql-batches-and-golden-report-answers.md) — runReportJob reads in one snapshot, pages and sorts in SQL, aggregates in 500-entry batches; goldens pin output on every backend.
- Open [**Share password rate limits through database counters and reservations**](practice-share-password-rate-limits-through-database-counters-and-reservations.md) — Limiter counters and reservation leases live in the database, keyed by hash; attempt refuses with retryAfter and never queues.