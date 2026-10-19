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

Older databases hold zones as typed. `openDatabase` (`packages/api/src/db/index.ts`) registers a deterministic SQL function `canonical_time_zone` that wraps `canonicalTimeZone` (NULL for non-text) before it runs `migrate()`, and migration 6 in `packages/api/src/db/migrations.ts` uses it to rewrite `users.timezone`. It changes a row only when the canonical name is non-null and differs, so offsets and unknown names stay as stored, and `updated_at` is not touched. The result follows the ICU of the Node that runs the migration. `e2e/auth-browser.spec.ts` covers the startup path: stop a server, edit `tokkl.sqlite` (zone and `user_version`), restart on the same data directory.

Browsers differ from Node on these names too: Firefox 157 resolves `Asia/Kolkata` and `Europe/Kyiv` to those current names, while Node 24.21 and Chromium 156 give `Asia/Calcutta` and `Europe/Kiev`. Firefox also rejects the older names as a Playwright `timezoneId`. Compare a browser zone with a stored one only after `canonicalTimeZone` on both sides, as `ProfileSection.tsx` does for its zone notice; a plain string compare shows a false mismatch. The committed Playwright config has only Chromium, so `e2e/settings-profile.spec.ts` emulates Firefox naming there with an init script that patches `Intl.DateTimeFormat.prototype.resolvedOptions`. WebKit does not launch on the server host without the system libraries `libmanette-0.2-0` and `libenchant-2-2`, which need sudo to install.

The e2e reset fixture does not reset user timezones. A spec that changes the zone uses an extra account from the `users` fixture so later specs keep their zone.

<!-- kk:related:start -->
# Related

- Related: [practice-ui-time-math-uses-wall-clock-helpers](../../web-ui-behaviour/practice-ui-time-math-uses-wall-clock-helpers.md)
- Related: [practice-preferences-validated-by-known-key](../users-and-admin/practice-preferences-validated-by-known-key.md)
<!-- kk:related:end -->
