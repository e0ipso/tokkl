---
type: practice
title: 'Preferences: known keys validated, unknown keys stored verbatim'
description: >-
  PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys
  pass through; bad stored values read back as defaults.
tags:
  - server
  - preferences
  - validation
kk_schema_version: 3
kk_id: practice-preferences-validated-by-known-key
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
`PREFERENCE_RULES` in `server/src/models/users.ts` lists the preference keys the web app reads and the values it can render: date and time-of-day formats, `duration_format`, `theme`, `timerView`, the boolean toggles, and `favorites` (at most `MAX_FAVORITES`). `validatePreferenceChanges` answers 400 for a known key with an unusable value. Keys not in the table are stored as sent, so Toggl clients can keep their own settings.

`getPreferences` drops stored values that fail their rule and falls back to `DEFAULT_PREFERENCES`, so values saved before validation existed never reach clients. A new preference the UI depends on needs a rule and a default here.
