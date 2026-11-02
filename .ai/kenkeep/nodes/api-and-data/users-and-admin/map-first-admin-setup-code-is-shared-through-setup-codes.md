---
type: map
title: First-admin setup code is shared through setup_codes
description: >-
  Without TOKKL_SETUP_CODE, one SHA-256 setup-code hash lives in setup_codes;
  setup rechecks it under the instance lock and deletes it with the admin insert.
tags:
  - server
  - auth
  - admin
kk_schema_version: 3
kk_id: map-first-admin-setup-code-is-shared-through-setup-codes
kk_derived_from: []
kk_relates_to:
  - practice-password-checks-go-through-failurelimiter-attempt
  - map-users-roles-and-workspace-membership
kk_depends_on: []
kk_confidence: high
---
Without `TOKKL_SETUP_CODE`, startup in `packages/api/src/index.ts` stores one pending setup code when none exists. The table is `setup_codes` (migration 6) and holds only the SHA-256 hash, never the code. The instance that creates the code prints it; other instances and restarts before setup print a line that points to `npm run setup:code`. Nothing is printed once an admin exists. A configured `TOKKL_SETUP_CODE` is accepted as before, never stored, and must be identical on every replica.

Setup (`auth/storageSessions.ts`, `domain/accounts.ts`) checks the submitted code against the stored hash through `setupLimiter`. After password hashing it takes `lockInstanceAdministration` and checks the code again (`setupCredentialValid`), so a replacement or a competing setup that committed meanwhile makes the stale code fail. The transaction that creates the admin also deletes the stored hash.

`packages/api/src/setupCode.ts` (`npm run setup:code`, or `node packages/api/src/setupCode.ts` in the image) replaces the pending hash under the same lock and prints the new code. It refuses with exit 1 when `TOKKL_SETUP_CODE` is set or an account exists. It does not clear the failed-attempt counters.

<!-- kk:related:start -->
# Related

- Related: [practice-password-checks-go-through-failurelimiter-attempt](../password-and-csrf-rules/practice-password-checks-go-through-failurelimiter-attempt.md)
- Related: [map-users-roles-and-workspace-membership](map-users-roles-and-workspace-membership.md)
<!-- kk:related:end -->
