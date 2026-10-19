---
type: practice
title: 'Parser cases live in packages/common/fixtures JSON, not in TS asserts'
description: >-
  duration, timeOfDay and snap cases are a cross-client contract in JSON; add
  parser cases there, not in TS tests.
tags:
  - testing
  - common
  - parsing
kk_schema_version: 3
kk_id: practice-parser-cases-live-in-shared-json-fixtures
kk_derived_from: []
kk_relates_to:
  - practice-parse-duration-returns-null-over-999-hours
  - practice-twelve-hour-time-entry-parsing-rules
  - map-test-and-static-analysis-layout
kk_depends_on: []
kk_confidence: high
---
`packages/common/fixtures/duration.json`, `timeOfDay.json` and `snap.json` are the contract for `parseDuration`, `parseTimeOfDay` and `snapSpan`, shared with clients in other repositories that port those functions. `packages/common/fixtures/README.md` documents the format. Each file is an array of `{ name, input, options?, expected }`. `expected` is `null` for rejected input and `{ "throws": "RangeError" }` for an error, and instants are ISO 8601 UTC strings.

`duration.test.ts`, `timeOfDay.test.ts` and `snap.test.ts` import the files with `with { type: 'json' }`; `resolveJsonModule` is not needed under `nodenext`. Add a new parser case to the JSON, not as a TS assert, so every port sees it. `formatDuration` and `isTimeResolution` have no fixture and stay as TS asserts.

<!-- kk:related:start -->
# Related

- Related: [practice-parse-duration-returns-null-over-999-hours](../../web-ui-behaviour/practice-parse-duration-returns-null-over-999-hours.md)
- Related: [practice-twelve-hour-time-entry-parsing-rules](../../web-ui-behaviour/practice-twelve-hour-time-entry-parsing-rules.md)
- Related: [map-test-and-static-analysis-layout](map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
