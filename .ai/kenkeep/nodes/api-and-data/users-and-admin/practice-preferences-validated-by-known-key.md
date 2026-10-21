---
type: practice
title: 'Preferences: known keys validated, unknown keys stored verbatim'
description: >-
  PREFERENCE_RULES in users.ts validates the keys Tokkl clients read, Pomodoro
  included; other keys pass through; bad stored values read back as defaults.
tags:
  - server
  - preferences
  - validation
kk_schema_version: 3
kk_id: practice-preferences-validated-by-known-key
kk_derived_from:
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:practice:5'
  - 'bff2d85c-6ffd-4b0a-8c4b-78f0be7d1099:practice:0'
kk_relates_to:
  - map-pomodoro-cycle-functions-in-packages-common
kk_depends_on: []
kk_confidence: high
---
`PREFERENCE_RULES` in `packages/api/src/models/users.ts` lists the preference keys Tokkl clients read and the values they can render: date and time-of-day formats, `duration_format`, `theme`, `timerView`, the boolean toggles, `favorites` (at most `MAX_FAVORITES`), and the four Pomodoro length keys. `validatePreferenceChanges` answers 400 for a known key with an unusable value. Keys not in the table are stored as sent, so Toggl clients can keep their own settings.

`getPreferences` drops stored values that fail their rule and falls back to `DEFAULT_PREFERENCES`, so values saved before validation existed never reach clients. A new preference the UI depends on needs a rule and a default here.

Pomodoro length keys and defaults: `pomodoro_focus_interval_in_minutes` 1 to 180 (25), `pomodoro_break_interval_in_minutes` 1 to 60 (5), `pomodoro_long_break_interval_in_minutes` 1 to 60 (15) and `pomodoro_long_break_every` 1 to 12 (4). `users.ts` imports `DEFAULT_POMODORO_SESSION_CONFIG` and `POMODORO_SESSION_CONFIG_RANGES` from `@tokkl/common/pomodoroSession` for their defaults and rules. The ranges use `integerFrom(min, max)`, which takes only a JSON number that `Number.isInteger` accepts, so fractions, numeric strings, null and booleans get 400 `Invalid <key>: expected an integer from N to M`. These four keys are the known Pomodoro preferences in API defaults/rules and `Preferences` in `packages/types/index.ts`; the web app reads them as defaults for a new session (see `map-pomodoro-cycle-functions-in-packages-common`).

Startup migration 7 in `packages/api/src/db/migrations.ts` removes `pomodoro_enabled` and `pomodoro_stop_timer_at_end` from existing `users.preferences` with `json_remove`, preserving other values. Neither key is a supported Pomodoro preference. Generic unknown-key pass-through still permits future writes of those names; the migration does not add a rejection rule.

`/me/preferences` and `/me/preferences/:client` (GET and POST, `packages/api/src/routes/togglV9.ts`) read and merge into the same `users.preferences` record; `:client` is ignored. A value the phone saves is the value the web app reads, so a client-specific setting needs its own key.

<!-- Verified against the current code on 2026-10-21. -->

<!-- kk:related:start -->
# Related

- Related: [map-pomodoro-cycle-functions-in-packages-common](../../web-ui-behaviour/map-pomodoro-cycle-functions-in-packages-common.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:practice:5
[2] bff2d85c-6ffd-4b0a-8c4b-78f0be7d1099:practice:0
<!-- kk:citations:end -->
