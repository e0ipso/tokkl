---
type: practice
title: Recheck credentials inside the guarded account transaction
description: >-
  Auth and PUT /me recheck the account and credential under the guarded
  transaction, so revocations during scrypt refuse stale credentials.
tags:
  - server
  - auth
kk_schema_version: 3
kk_id: practice-recheck-credentials-inside-the-guarded-account-transaction
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8'
kk_relates_to:
  - practice-verify-passwords-only-through-failurelimiter-attempt
kk_depends_on: []
kk_confidence: high
---
Authentication in `auth/middleware.ts` runs password verification through the limiter, then asynchronously re-reads the active account and verified credential identity. Session creation and protected mutations recheck credentials inside the guarded transaction. A suspension, deletion, password reset or token/session revocation committed while scrypt or lock acquisition waits must refuse the stale credential.

`PUT /me` password rotation validates the current credential again under the protected account transaction after hashing. `createApplicationServices` in `services/application.ts` composes these guarded rechecks, and routers get only the guarded `accountsFor`: the unguarded account operations go to the session handlers alone (`createSessionAccountOperations`, called in `app.ts`); no synchronous no-await window is assumed. API race tests hold actual crypto work or guard acquisition to prove revocation.

<!-- kk:related:start -->
# Related

- Related: [practice-verify-passwords-only-through-failurelimiter-attempt](practice-verify-passwords-only-through-failurelimiter-attempt.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8
<!-- kk:citations:end -->
