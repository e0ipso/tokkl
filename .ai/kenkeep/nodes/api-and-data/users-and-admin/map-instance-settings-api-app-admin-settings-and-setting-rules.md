---
type: map
title: 'Instance settings: /api/app/admin/settings and SETTING_RULES'
description: >-
  session_days, invite_days and time_resolution_minutes live in
  instance_settings, validated by SETTING_RULES; v9 /me exposes the resolution.
tags:
  - server
  - admin
  - settings
kk_schema_version: 3
kk_id: map-instance-settings-api-app-admin-settings-and-setting-rules
kk_derived_from: []
kk_relates_to:
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
kk_depends_on: []
kk_confidence: high
---
These routes are in `packages/api/src/routes/admin.ts`, mounted at `/api/app/admin` behind `requireAuth` and `requireAdmin`, so only an active admin reaches them.

`GET` and `PUT /settings` read and change the runtime settings in `instance_settings` (migration 4, JSON values, `updated_by` set to NULL when its admin is deleted); `getInstanceSettings` in `models/settings.ts` returns the effective values. There are three, typed in `InstanceSettings` (`packages/types/index.ts`):

- `session_days`: the stored value, else `TOKKL_SESSION_DAYS`, else 30; an integer from 1 to 365. New logins and new accounts take the current value; sessions that exist keep their expiry.
- `invite_days`: the stored value, else 7; from 1 to 90.
- `time_resolution_minutes`: the stored value, else 5; one of the divisors of 60 (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60). Live writes of stopped entries snap to it; see `practice-stopped-entries-snap-to-the-time-resolution-on-write`.

Each entry of `SETTING_RULES` is either a `{ min, max }` range or an `{ allowed }` set, plus a `fallback`. A stored value that fails its rule is ignored on read and the fallback applies. An unknown key or a value that fails its rule is a 400 that names the field (`Invalid time_resolution_minutes: expected one of 1, 2, ...`) and stores nothing. A PUT may carry any subset of the keys. Everything else in `Config` (server, paths, setup) stays env-only. To add a setting, add a key to `InstanceSettings` and a rule to `SETTING_RULES`.

`GET /api/v9/me` (`routes/togglV9.ts`) carries `time_resolution_minutes` next to `role` for every signed-in user, not only admins, as a Tokkl-only field. Clients read the resolution there. In the e2e suite, `saveInstanceSettings` in `e2e/fixtures.ts` takes a `Partial<InstanceSettings>`, and `me()` returns the signed-in account's `role` and `time_resolution_minutes`.

<!-- kk:related:start -->
# Related

- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write](../time-handling/practice-stopped-entries-snap-to-the-time-resolution-on-write.md)
<!-- kk:related:end -->
