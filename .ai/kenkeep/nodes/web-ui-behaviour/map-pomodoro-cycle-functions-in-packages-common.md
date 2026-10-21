---
type: map
title: 'Pomodoro length preferences: session defaults and API-only toggle keys'
description: >-
  The four pomodoro_* length preferences seed new /pomodoro sessions;
  pomodoro_enabled and stop_timer_at_end have no web or common reader.
tags:
  - pomodoro
  - preferences
  - web
  - common
kk_schema_version: 3
kk_id: map-pomodoro-cycle-functions-in-packages-common
kk_derived_from:
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:4'
kk_relates_to:
  - practice-preferences-validated-by-known-key
  - map-pomodoro-session-model-in-packages-common-pomodorosession
  - map-web-pomodoro-sessions-provider-controller-and-account-state
kk_depends_on: []
kk_confidence: high
---
`@tokkl/common` exports one Pomodoro module, `./pomodoroSession` (`packages/common/pomodoroSession.ts`, see `map-pomodoro-session-model-in-packages-common-pomodorosession`). Its `DEFAULT_POMODORO_SESSION_CONFIG` (work 25, short rest 5 and long rest 15 minutes, a long rest every 4 pomodoros) is the only source of default lengths in the web app.

Settings under Preferences (`packages/web/src/pages/manage/settings/PreferencesSection.tsx`) edits four lengths: `pomodoro_focus_interval_in_minutes`, `pomodoro_break_interval_in_minutes`, `pomodoro_long_break_interval_in_minutes` and `pomodoro_long_break_every`, each falling back to `DEFAULT_POMODORO_SESSION_CONFIG` when unset. They are defaults for new sessions only: the `/pomodoro` start form in `PomodoroPage.tsx` prefills from them, and starting a session never writes them back. Preferences has no Pomodoro on/off or stop-at-end control.

The API and `packages/types` still accept `pomodoro_enabled` and `pomodoro_stop_timer_at_end` (see `practice-preferences-validated-by-known-key`), but no web or common code reads them. `localStorage` entries under `tokkl.pomodoro.<accountId>` are inert: nothing reads them and sign-out does not clear them.

<!-- kk:related:start -->
# Related

- Related: [practice-preferences-validated-by-known-key](../api-and-data/users-and-admin/practice-preferences-validated-by-known-key.md)
- Related: [map-pomodoro-session-model-in-packages-common-pomodorosession](map-pomodoro-session-model-in-packages-common-pomodorosession.md)
- Related: [map-web-pomodoro-sessions-provider-controller-and-account-state](map-web-pomodoro-sessions-provider-controller-and-account-state.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:4
<!-- kk:citations:end -->
