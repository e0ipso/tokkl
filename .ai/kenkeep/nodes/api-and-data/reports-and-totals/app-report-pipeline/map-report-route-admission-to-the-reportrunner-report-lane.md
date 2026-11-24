---
type: map
title: Report route admission to the ReportRunner report lane
description: >-
  Report routes reserve a per-account place in the report lane, answer 503 when
  full, free it on abort, then submit a typed ReportJob.
tags:
  - server
  - reports
  - api
kk_schema_version: 3
kk_id: map-report-route-admission-to-the-reportrunner-report-lane
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:6'
kk_relates_to:
  - map-download-lane-for-account-exports-and-detailed-csvs
  - map-web-app-report-routes-range-limits-and-rounding
kk_depends_on:
  - map-reportrunner-lanes-worker-placement-and-crash-handling
kk_confidence: high
---
Each report route first reserves a place in the ReportRunner's report lane (`reserve` in `packages/api/src/services/reportRunner.ts`, 16 places by default, the place belonging to the signed-in account). The slot it hands the route queues work for the reservation's account only: `run`, `export` and `report` take no user id. Tests that want one call use `runReport` and `runExport` in `test/fixtures/reportRunner.ts`. Each account holds at most `maxPerUser` places at once (a quarter of the queue, 4 by default), reserved, queued or running. A full queue, or an account at its share, answers 503 `Report queue is full` with `Retry-After: 2` before the route reads the workspace or the export, and a cancelled request reads nothing. The route passes the runner `res.locals.workSignal`, which `app.ts` aborts when the response closes. On that abort the lane drops a queued job or stops a running one, so a client that gives up a request frees its place at once; `test/reportAdmission.test.ts` checks this over HTTP for both cases. The route then validates ranges, sorting and page size on the main thread and submits a typed ReportJob in its place, with canonical values (`parseDetailedOrder` turns the app's `sort`/`dir` into an `OrderBy` and a `SortDirection`).

<!-- kk:related:start -->
# Related

- Related: [map-download-lane-for-account-exports-and-detailed-csvs](map-download-lane-for-account-exports-and-detailed-csvs.md)
- Related: [map-web-app-report-routes-range-limits-and-rounding](map-web-app-report-routes-range-limits-and-rounding.md)
- Depends on: [map-reportrunner-lanes-worker-placement-and-crash-handling](map-reportrunner-lanes-worker-placement-and-crash-handling.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:6
<!-- kk:citations:end -->
