---
type: practice
title: 'Key login rate limits with normalizeEmail, not toLowerCase'
description: >-
  Rate-limit accounts are keyed by normalizeEmail (trim, ASCII A-Z lowercase),
  matching users.email_key; toLowerCase merges distinct users.
tags:
  - server
  - auth
  - rate-limit
kk_schema_version: 3
kk_id: practice-key-login-rate-limits-with-normalizeemail-not-tolowercase
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8'
kk_relates_to:
  - practice-verify-passwords-only-through-failurelimiter-attempt
kk_depends_on: []
kk_confidence: high
---
Accounts are keyed by `normalizeEmail`: trim, then lowercase ASCII A-Z only. That matches the `users.email_key` column, which folds the same letters on every engine. Do not use `toLowerCase`, which also folds letters such as Ä and would merge distinct users (`Ä@` and `ä@`) into one counter.

<!-- kk:related:start -->
# Related

- Related: [practice-verify-passwords-only-through-failurelimiter-attempt](practice-verify-passwords-only-through-failurelimiter-attempt.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:8
<!-- kk:citations:end -->
