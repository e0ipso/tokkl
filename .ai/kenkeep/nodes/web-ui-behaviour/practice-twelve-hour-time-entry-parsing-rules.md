---
type: practice
title: '12-hour time entry: explicit AM/PM wins, ends follow the start'
description: >-
  parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first
  occurrence after the start; starts guess near now.
tags:
  - web
  - time
  - parsing
kk_schema_version: 3
kk_id: practice-twelve-hour-time-entry-parsing-rules
kk_derived_from: []
kk_relates_to:
  - practice-ui-time-math-uses-wall-clock-helpers
kk_depends_on: []
kk_confidence: high
---
Typed clock times go through `parseTimeOfDay` in `packages/web/src/lib/timeOfDay.ts`. For 12-hour users the rules are:

- An explicit suffix (`9am`, `9pm`, `12am`) is authoritative and never second-guessed.
- An end time without a suffix resolves to the first AM/PM occurrence after the start (the `after` option), so 11pm to "1" is 1 AM. `resolveRange` in `packages/web/src/lib/entryTime.ts` then rolls the stop over to the next calendar day in the account time zone when needed.
- A start time without a suffix picks whichever occurrence is closest to now (the `reference` option).

24-hour input without a suffix is taken literally. This mirrors Toggl's manual mode.

<!-- kk:related:start -->
# Related

- Related: [practice-ui-time-math-uses-wall-clock-helpers](practice-ui-time-math-uses-wall-clock-helpers.md)
<!-- kk:related:end -->
