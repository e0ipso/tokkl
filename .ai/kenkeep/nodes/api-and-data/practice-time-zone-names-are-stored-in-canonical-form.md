---
type: practice
title: 'Time zones: store canonicalTimeZone, reject offset IDs'
description: >-
  Account zones go through canonicalTimeZone and are stored as ICU names; bad
  input is a 400 'Invalid timezone'.
tags:
  - api
  - time
  - validation
kk_schema_version: 3
kk_id: practice-time-zone-names-are-stored-in-canonical-form
kk_derived_from: []
kk_relates_to:
  - practice-ui-time-math-uses-wall-clock-helpers
  - practice-preferences-validated-by-known-key
kk_depends_on: []
kk_confidence: high
---
`canonicalTimeZone(name)` in `packages/common/time.ts` is the only zone check. It returns `Intl`'s `resolvedOptions().timeZone`, or `null` for a name `Intl` rejects and for offset IDs (a leading `+`, `-` or U+2212). `Intl` itself accepts `+02:00`, but the browser zone list has none and `java.time` refuses offsets past +-18:00, so the helper refuses them first.

`PUT /me` (`packages/api/src/routes/togglV9.ts`) and setup and invite (`readNewAccountTimeZone` in `packages/api/src/routes/app.ts`) store the canonical name, not the typed one, and answer 400 `Invalid timezone` on `null`. In setup and invite a missing or empty timezone means `UTC`; `null` or any non-string is a 400.

The canonical form follows the running Node's ICU and its tz backward links, so it can differ from what the user typed. On Node 24.21, `Asia/Kolkata` comes back as `Asia/Calcutta`, `Europe/Kyiv` as `Europe/Kiev` and `EST` as `America/Panama`.

The e2e reset fixture does not reset user timezones. A spec that changes the zone uses an extra account from the `users` fixture so later specs keep their zone.

<!-- kk:related:start -->
# Related

- Related: [practice-ui-time-math-uses-wall-clock-helpers](../web-ui-behaviour/practice-ui-time-math-uses-wall-clock-helpers.md)
- Related: [practice-preferences-validated-by-known-key](practice-preferences-validated-by-known-key.md)
<!-- kk:related:end -->
