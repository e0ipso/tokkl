---
type: practice
title: Charge invite and reset link misses to the address counter
description: >-
  Invite and reset token lookups charge misses to the 100-per-window address
  counter and answer 429 before lookup once it is full.
tags:
  - server
  - auth
  - rate-limit
kk_schema_version: 3
kk_id: practice-charge-invite-and-reset-link-misses-to-the-address-counter
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8'
kk_relates_to:
  - map-invites-and-password-reset-links-in-account-tokens
kk_depends_on:
  - practice-verify-passwords-only-through-failurelimiter-attempt
kk_confidence: high
---
Invite and password reset link lookups (`GET` and `POST` on `/invites/:token` and `/password-resets/:token`, `routes/app.ts`) charge a miss to the address counter (`addressCounter`, the same 100-per-window counter login uses) and answer 429 before the lookup once it is full, so tokens cannot be guessed at speed. A successful reset clears `accountCounters` for that account and address.

<!-- kk:related:start -->
# Related

- Related: [map-invites-and-password-reset-links-in-account-tokens](../../users-and-admin/map-invites-and-password-reset-links-in-account-tokens.md)
- Depends on: [practice-verify-passwords-only-through-failurelimiter-attempt](practice-verify-passwords-only-through-failurelimiter-attempt.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8
<!-- kk:citations:end -->
