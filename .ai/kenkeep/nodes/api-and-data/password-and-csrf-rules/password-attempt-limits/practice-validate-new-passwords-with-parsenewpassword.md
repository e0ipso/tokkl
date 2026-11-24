---
type: practice
title: Validate new passwords with parseNewPassword
description: >-
  New passwords are 8-1024 characters and go through parseNewPassword; current
  passwords are not capped on login or rotation.
tags:
  - server
  - auth
kk_schema_version: 3
kk_id: practice-validate-new-passwords-with-parsenewpassword
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8'
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
New passwords must be at least `MIN_PASSWORD_LENGTH` (8) and at most `MAX_PASSWORD_LENGTH` (1024) characters (`packages/api/src/domain/accountValues.ts`). Current passwords are not capped on login, Basic auth or rotation, so an owner with an older, longer password can still sign in and change it.

New passwords from first-admin setup, invite accept, `PUT /me` and password reset all go through `parseNewPassword` in `packages/api/src/commands/accounts.ts`; use it for any new path that sets one.

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8
<!-- kk:citations:end -->
