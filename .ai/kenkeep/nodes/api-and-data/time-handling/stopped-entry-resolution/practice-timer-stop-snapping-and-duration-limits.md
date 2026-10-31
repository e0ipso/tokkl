---
type: practice
title: Timer stop snapping and duration limits
description: >-
  Timer stops can trash zero spans, preserve switching boundaries and clamp the
  maximum duration.
tags:
  - server
  - timer
  - time
kk_schema_version: 3
kk_id: practice-timer-stop-snapping-and-duration-limits
kk_derived_from:
  - '6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:3'
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:12'
kk_relates_to:
  - map-admin-user-management-api-and-the-last-active-admin-rule
  - map-invites-and-password-reset-links-in-account-tokens
  - map-instance-settings-api-app-admin-settings-and-setting-rules
  - practice-parse-api-timestamps-with-parseinstant
kk_depends_on: []
kk_confidence: high
---
Live timer stops use `stopEntryAt` in `packages/api/src/domain/timeEntries.ts` and the shared instance grid.

- A timer stop that rounds to zero (stop endpoint, `stopRunning` on a new start, restore while another timer runs) soft-deletes the entry into the trash with start and stop both on the snapped start. The stop endpoint reads it back with `includeDeleted`, so the reply is the entry with `duration` 0 and `server_deleted_at` set. The server's pause chain adds the stored duration of the paused entry, so a few-second segment before a pause adds no seconds. A pomodoro that rounds to zero is reported once in the timer state's `discarded_pomodoro` (see `map-timer-state-service-settlement-revision-and-discarded-pomodoro`). Undo from the trash brings back the zero-length entry.
- `PATCH /workspaces/:wid/time_entries/:id/stop` takes an optional JSON `stop` instant, validated by `parseInstant`; without one the stop is the request time. Both go through `stopEntryAt`, so snapping, the trash and Undo behave the same. The web app passes the instant when a Pomodoro session starts over a running timer.
- A running entry keeps its exact start until it stops. A new timer started at the switch instant later snaps its start to the same grid point as the old stop, so switches are stored back to back. A stop and a later start sent seconds apart can leave a gap of R, never an overlap.
- The 999 h cap is checked after snapping, so a stop under half a step past 999 h snaps back onto it and is accepted. Create and edit reject a longer span, but `stopEntryAt` clamps it to exactly 999 h instead: a timer left running past the cap must still stop, because a failed stop would leave it running and every new start fails too (starting one stops the old one).

<!-- kk:related:start -->
# Related

- Related: [map-admin-user-management-api-and-the-last-active-admin-rule](../../users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md)
- Related: [map-invites-and-password-reset-links-in-account-tokens](../../users-and-admin/map-invites-and-password-reset-links-in-account-tokens.md)
- Related: [map-instance-settings-api-app-admin-settings-and-setting-rules](../../users-and-admin/map-instance-settings-api-app-admin-settings-and-setting-rules.md)
- Related: [practice-parse-api-timestamps-with-parseinstant](../practice-parse-api-timestamps-with-parseinstant.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:3
[2] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:12
<!-- kk:citations:end -->
