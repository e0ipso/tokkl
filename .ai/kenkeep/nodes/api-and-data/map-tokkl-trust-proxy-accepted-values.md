---
type: map
title: TOKKL_TRUST_PROXY accepted values
description: >-
  TOKKL_TRUST_PROXY takes empty/0, a hop count, or an IP/CIDR list; boolean
  words like true/yes stop startup with a named error.
tags:
  - api
  - config
  - proxy
  - rate-limit
  - security
kk_schema_version: 3
kk_id: map-tokkl-trust-proxy-accepted-values
kk_derived_from:
  - 'c9834e60-a48f-4804-be35-a7d8ba5e20e1:map:0'
kk_relates_to:
  - map-api-composition-root-services-http-app-and-clock
  - practice-password-checks-go-through-failurelimiter-attempt
  - map-tokkl-rename-legacy-name-fallbacks
kk_depends_on: []
kk_confidence: medium
---
`TOKKL_TRUST_PROXY` (parsed by `trustProxy` in `packages/api/src/config.ts`, passed to Express `trust proxy` in `app.ts`) accepts three forms:

- empty or `0`: trust no proxy;
- a positive hop count, which must be a safe integer (a long digit string that parses as `Infinity` is rejected);
- a comma-separated list of IP addresses and CIDR ranges.

Anything else, including `true`, `yes` and other boolean words, stops startup with an error that names the setting. Boolean words are rejected because Express reads `true` as trusting every hop, which lets a client spoof `X-Forwarded-For` and so defeat the per-address rate-limit keys. The parser throws a `ConfigurationError`; startup (`packages/api/src/index.ts`) prints the message only for that error class, because other startup errors can carry connection details.

A hop count or a proxy list matters when a CDN or edge sits in front of a load balancer: each layer adds a hop, and a wrong count makes rate-limit keys use the proxy's address instead of the client's.

<!-- kk:related:start -->
# Related

- Related: [map-api-composition-root-services-http-app-and-clock](map-api-composition-root-services-http-app-and-clock.md)
- Related: [practice-password-checks-go-through-failurelimiter-attempt → practice-charge-invite-and-reset-link-misses-to-the-address-counter](password-and-csrf-rules/password-attempt-limits/practice-charge-invite-and-reset-link-misses-to-the-address-counter.md)
- Related: [practice-password-checks-go-through-failurelimiter-attempt → practice-key-login-rate-limits-with-normalizeemail-not-tolowercase](password-and-csrf-rules/password-attempt-limits/practice-key-login-rate-limits-with-normalizeemail-not-tolowercase.md)
- Related: [practice-password-checks-go-through-failurelimiter-attempt → practice-recheck-credentials-inside-the-guarded-account-transaction](password-and-csrf-rules/password-attempt-limits/practice-recheck-credentials-inside-the-guarded-account-transaction.md)
- Related: [practice-password-checks-go-through-failurelimiter-attempt → practice-share-password-rate-limits-through-database-counters-and-reservations](password-and-csrf-rules/password-attempt-limits/practice-share-password-rate-limits-through-database-counters-and-reservations.md)
- Related: [practice-password-checks-go-through-failurelimiter-attempt → practice-validate-new-passwords-with-parsenewpassword](password-and-csrf-rules/password-attempt-limits/practice-validate-new-passwords-with-parsenewpassword.md)
- Related: [practice-password-checks-go-through-failurelimiter-attempt → practice-verify-passwords-only-through-failurelimiter-attempt](password-and-csrf-rules/password-attempt-limits/practice-verify-passwords-only-through-failurelimiter-attempt.md)
- Related: [map-tokkl-rename-legacy-name-fallbacks](../tooling-and-project/repo-and-scripts/map-tokkl-rename-legacy-name-fallbacks.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] c9834e60-a48f-4804-be35-a7d8ba5e20e1:map:0
<!-- kk:citations:end -->
