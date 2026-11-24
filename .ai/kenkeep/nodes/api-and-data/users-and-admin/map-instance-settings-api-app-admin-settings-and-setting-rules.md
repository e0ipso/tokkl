---
type: map
title: 'Instance settings: /api/app/admin/settings'
description: >-
  Runtime session, invite and boolean sign-up settings, including mail readiness
  and the public status flag; the time resolution is a per-user preference.
tags:
  - server
  - admin
  - settings
kk_schema_version: 3
kk_id: map-instance-settings-api-app-admin-settings-and-setting-rules
kk_derived_from:
  - packages/api/src/domain/instanceSettings.ts
  - '9ac1e335-c9fa-41b0-baa6-7595ca4c245b:map:0'
kk_relates_to:
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
  - practice-preferences-validated-by-known-key
kk_depends_on: []
kk_confidence: high
---
These routes are in `packages/api/src/routes/admin.ts`, mounted at `/api/app/admin` behind `requireAuth` and `requireAdmin`, so only an active admin reaches them.

`GET` and `PUT /settings` read and change the runtime settings in `instance_settings` (JSON values, `updated_by` set to NULL when its admin is deleted); `getInstanceSettings` in `domain/instanceSettings.ts` returns the effective values. There are three, typed in `InstanceSettings` (`packages/types/index.ts`):

- `session_days`: the stored value, else `TOKKL_SESSION_DAYS`, else 30; an integer from 1 to 365. New logins and new accounts take the current value; sessions that exist keep their expiry.
- `invite_days`: the stored value, else 7; from 1 to 90.
- `signup_enabled`: a boolean, false by default; it takes effect only when mail is configured.

Numeric settings require safe integers and use per-key ranges; sign-up requires a boolean. A stored value that fails its rule is ignored on read and the fallback applies. An unknown key or a value that fails its rule is a 400 that names the field and stores nothing. A PUT may carry any subset of the keys. Everything else in `Config` (server, paths, setup) stays env-only. Validation and updates are handled by `domain/instanceSettings.ts`, `domain/accounts.ts` and `commands/accounts.ts`.

The time resolution is not an instance setting. `time_resolution_minutes` is a key in each user's preferences (one of the divisors of 60, default 5, in `PREFERENCE_RULES` / `DEFAULT_PREFERENCES` of `domain/accountValues.ts`), read and written through `/me/preferences` and edited in Settings → Preferences (`TimeResolutionField` in `packages/web/src/pages/manage/settings/PreferenceFields.tsx`). `timeResolutionOf(user)` returns it, and `domain/timeEntries.ts` snaps an entry's stop, create, update and split writes to its owner's resolution. A PUT to `/settings` that carries the key is a 400 `Unknown setting: time_resolution_minutes`, `GET /api/v9/me` does not carry it, and migration 10 deletes the old `instance_settings` row. The web app reads it in `settingsFrom` (`packages/web/src/lib/settings.ts`) through `resolutionOf`, which falls back to 1 when the value is missing or fails `isTimeResolution`, because snapping throws `RangeError` on a step that does not divide the hour. Tests set it per user with `setTimeResolution` in `e2e/fixtures.ts` and `packages/api/test/helpers.ts`.

In the e2e suite, `saveInstanceSettings` in `e2e/fixtures.ts` takes a `Partial<InstanceSettings>`, and `me()` returns the signed-in account's `role`.

Enabling sign-up without `TOKKL_SMTP_HOST`, `TOKKL_SMTP_FROM` or `TOKKL_PUBLIC_URL` returns 400 naming the missing variables. `GET` and `PUT /settings` include read-only `mail_configured: { configured, missing }`; sending that key in a PUT is an unknown-setting error. `GET /api/app/status` exposes only the effective `signup_enabled` flag, which is true when the saved boolean and mail configuration both allow it. SMTP credentials remain environment-only.

<!-- kk:related:start -->
# Related

- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-entry-resolution-at-dst-imports-and-reports](../time-handling/stopped-entry-resolution/practice-entry-resolution-at-dst-imports-and-reports.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-stopped-entry-grid-validation](../time-handling/stopped-entry-resolution/practice-stopped-entry-grid-validation.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-timer-stop-snapping-and-duration-limits](../time-handling/stopped-entry-resolution/practice-timer-stop-snapping-and-duration-limits.md)
- Related: [practice-preferences-validated-by-known-key](practice-preferences-validated-by-known-key.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [packages/api/src/domain/instanceSettings.ts](../../../../../packages/api/src/domain/instanceSettings.ts)
[2] 9ac1e335-c9fa-41b0-baa6-7595ca4c245b:map:0
<!-- kk:citations:end -->
