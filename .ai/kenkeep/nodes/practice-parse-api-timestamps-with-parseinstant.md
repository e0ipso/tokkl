---
type: practice
title: Parse incoming timestamps with parseInstant
description: >-
  Server input instants go through parseInstant: RFC 3339 with seconds and a
  zone, real dates only. Never new Date(String(x)).
tags:
  - server
  - validation
  - time
  - api
kk_schema_version: 3
kk_id: practice-parse-api-timestamps-with-parseinstant
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
`parseInstant` in `packages/api/src/lib/values.ts` is the single parser for instants arriving from clients. It accepts RFC 3339 with seconds and either `Z` or a numeric offset, rejects impossible dates such as 2026-02-30 instead of rolling them over, rejects non-strings, and truncates to whole seconds. Failures become a 400 naming the field.

Time entry create and update, the Toggl v9 `start_date`/`end_date` filters (through `parseDateOrInstant`, which also allows a bare `YYYY-MM-DD`), and JSON restore `start`/`stop` all use it. A new input path that reads a timestamp should call `parseInstant` too. `new Date(String(x))` silently accepts zone-less and out-of-range values.
