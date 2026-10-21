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
kk_relates_to:
  - map-pomodoro-cycle-functions-in-packages-common
kk_depends_on: []
kk_confidence: high
---
`PREFERENCE_RULES` in `packages/api/src/models/users.ts` lists the preference keys Tokkl clients read and the values they can render: date and time-of-day formats, `duration_format`, `theme`, `timerView`, the boolean toggles, `favorites` (at most `MAX_FAVORITES`), and the six Pomodoro keys. `validatePreferenceChanges` answers 400 for a known key with an unusable value. Keys not in the table are stored as sent, so Toggl clients can keep their own settings.

`getPreferences` drops stored values that fail their rule and falls back to `DEFAULT_PREFERENCES`, so values saved before validation existed never reach clients. A new preference the UI depends on needs a rule and a default here.

Pomodoro keys and defaults: `pomodoro_enabled` (false), `pomodoro_focus_interval_in_minutes` 1 to 180 (25), `pomodoro_break_interval_in_minutes` 1 to 60 (5), `pomodoro_long_break_interval_in_minutes` 1 to 60 (15), `pomodoro_long_break_every` 1 to 12 (4) and `pomodoro_stop_timer_at_end` (true). The ranges use `integerFrom(min, max)`, which takes only a JSON number that `Number.isInteger` accepts, so fractions, numeric strings, null and booleans get 400 `Invalid <key>: expected an integer from N to M`. The web app reads only the four length keys, as defaults for a new Pomodoro session; `pomodoro_enabled` and `pomodoro_stop_timer_at_end` are still accepted and stored, but no web or common code reads them (see `map-pomodoro-cycle-functions-in-packages-common`).

`/me/preferences` and `/me/preferences/:client` (GET and POST, `packages/api/src/routes/togglV9.ts`) read and merge into the same `users.preferences` record; `:client` is ignored. A value the phone saves is the value the web app reads, so a client-specific setting needs its own key.

<!-- Verified against the current code on 2026-10-19. -->

<!-- kk:related:start -->
# Related

- Related: [map-pomodoro-cycle-functions-in-packages-common](../../web-ui-behaviour/map-pomodoro-cycle-functions-in-packages-common.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:practice:5
<!-- kk:citations:end -->
