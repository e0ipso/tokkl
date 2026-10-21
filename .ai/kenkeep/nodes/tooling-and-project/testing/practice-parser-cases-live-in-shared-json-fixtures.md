---
type: practice
title: 'Parser cases live in packages/common/fixtures JSON, not in TS asserts'
description: >-
  duration, timeOfDay, snap and pomodoroSession cases are a cross-client
  contract in JSON; add cases there, not in TS tests.
tags:
  - testing
  - common
  - parsing
kk_schema_version: 3
kk_id: practice-parser-cases-live-in-shared-json-fixtures
kk_derived_from:
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:practice:6'
kk_relates_to:
  - practice-parse-duration-returns-null-over-999-hours
  - practice-twelve-hour-time-entry-parsing-rules
  - map-test-and-static-analysis-layout
  - map-pomodoro-session-model-in-packages-common-pomodorosession
kk_depends_on: []
kk_confidence: high
---
`packages/common/fixtures/duration.json`, `timeOfDay.json`, `snap.json` and `pomodoroSession.json` are the contract for `parseDuration`, `parseTimeOfDay`, `snapSpan` and the session functions in `packages/common/pomodoroSession.ts`, shared with clients in other repositories that port those functions. Ports do not read the files. Tokkl for Android copies cases by hand into its own tests and names the tokkl commit it copied from in each test file. In `pomodoroSession.json` each case names the function it calls in `input.function`, and the other `input` fields are its arguments. `packages/common/fixtures/README.md` documents the format. Each file is an array of `{ name, input, options?, expected }`. `expected` is `null` for rejected input and `{ "throws": "RangeError" }` for an error, and instants are ISO 8601 UTC strings.

`duration.test.ts`, `timeOfDay.test.ts`, `snap.test.ts` and `pomodoroSession.test.ts` import the files with `with { type: 'json' }`; `resolveJsonModule` is not needed under `nodenext`. Add a new parser or session case to the JSON, not as a TS assert, so every port sees it. `formatDuration` and `isTimeResolution` have no fixture and stay as TS asserts.

<!-- kk:related:start -->
# Related

- Related: [practice-parse-duration-returns-null-over-999-hours](../../web-ui-behaviour/practice-parse-duration-returns-null-over-999-hours.md)
- Related: [practice-twelve-hour-time-entry-parsing-rules](../../web-ui-behaviour/practice-twelve-hour-time-entry-parsing-rules.md)
- Related: [map-test-and-static-analysis-layout](map-test-and-static-analysis-layout.md)
- Related: [map-pomodoro-session-model-in-packages-common-pomodorosession](../../web-ui-behaviour/map-pomodoro-session-model-in-packages-common-pomodorosession.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:practice:6
<!-- kk:citations:end -->
