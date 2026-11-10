---
type: map
title: 'Instance settings: /api/app/admin/settings'
description: >-
  Runtime session, invite, time resolution and boolean sign-up settings,
  including mail readiness and the public status flag.
tags:
  - server
  - admin
  - settings
kk_schema_version: 3
kk_id: map-instance-settings-api-app-admin-settings-and-setting-rules
kk_derived_from:
  - packages/api/src/domain/instanceSettings.ts
kk_relates_to:
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
kk_depends_on: []
kk_confidence: high
---

These routes are in `packages/api/src/routes/admin.ts`, mounted at `/api/app/admin` behind `requireAuth` and `requireAdmin`, so only an active admin reaches them.

`GET` and `PUT /settings` read and change the runtime settings in `instance_settings` (JSON values, `updated_by` set to NULL when its admin is deleted); `getInstanceSettings` in `domain/instanceSettings.ts` returns the effective values. There are four, typed in `InstanceSettings` (`packages/types/index.ts`):

- `session_days`: the stored value, else `TOKKL_SESSION_DAYS`, else 30; an integer from 1 to 365. New logins and new accounts take the current value; sessions that exist keep their expiry.
- `invite_days`: the stored value, else 7; from 1 to 90.
- `time_resolution_minutes`: the stored value, else 5; one of the divisors of 60 (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60). Live writes of stopped entries snap to it; see `practice-stopped-entries-snap-to-the-time-resolution-on-write`.

- `signup_enabled`: a boolean, false by default; it takes effect only when mail is configured.

Numeric settings require safe integers and use per-key ranges or the time-resolution predicate; sign-up requires a boolean. A stored value that fails its rule is ignored on read and the fallback applies. An unknown key or a value that fails its rule is a 400 that names the field (`Invalid time_resolution_minutes: expected one of 1, 2, ...`) and stores nothing. A PUT may carry any subset of the keys. Everything else in `Config` (server, paths, setup) stays env-only. Validation and updates are handled by `domain/instanceSettings.ts`, `domain/accounts.ts` and `commands/accounts.ts`.

`GET /api/v9/me` (`routes/toggl/me.ts`) carries `time_resolution_minutes` next to `role` for every signed-in user, not only admins, as a Tokkl-only field. Clients read the resolution there. In the e2e suite, `saveInstanceSettings` in `e2e/fixtures.ts` takes a `Partial<InstanceSettings>`, and `me()` returns the signed-in account's `role` and `time_resolution_minutes`.

Enabling sign-up without `TOKKL_SMTP_HOST`, `TOKKL_SMTP_FROM` or `TOKKL_PUBLIC_URL` returns 400 naming the missing variables. `GET` and `PUT /settings` include read-only `mail_configured: { configured, missing }`; sending that key in a PUT is an unknown-setting error. `GET /api/app/status` exposes only the effective `signup_enabled` flag, which is true when the saved boolean and mail configuration both allow it. SMTP credentials remain environment-only.

<!-- kk:related:start -->
# Related

- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-entry-resolution-at-dst-imports-and-reports](../time-handling/stopped-entry-resolution/practice-entry-resolution-at-dst-imports-and-reports.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-stopped-entry-grid-validation](../time-handling/stopped-entry-resolution/practice-stopped-entry-grid-validation.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-timer-stop-snapping-and-duration-limits](../time-handling/stopped-entry-resolution/practice-timer-stop-snapping-and-duration-limits.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [packages/api/src/domain/instanceSettings.ts](../../../../../packages/api/src/domain/instanceSettings.ts)
<!-- kk:citations:end -->
