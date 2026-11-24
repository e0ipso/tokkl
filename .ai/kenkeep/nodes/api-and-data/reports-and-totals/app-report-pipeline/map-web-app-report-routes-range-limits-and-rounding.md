---
type: map
title: 'Web app report routes, range limits and rounding'
description: >-
  /api/app/report routes build every web report server-side with workspace
  rounding and a 3660-day range; Toggl v3 shares builders.
tags:
  - server
  - reports
  - api
kk_schema_version: 3
kk_id: map-web-app-report-routes-range-limits-and-rounding
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:6'
kk_relates_to:
  - map-report-route-admission-to-the-reportrunner-report-lane
  - map-reports-page-query-body-caching-and-cancellation
kk_depends_on: []
kk_confidence: high
---
`appReportRoutes` in `packages/api/src/routes/reports.ts` (mounted at `/api/app`) serves every report the web app shows. The client does not aggregate entries itself. App reports cover the signed-in user's `default_workspace_id`. Membership-scoped repository reads reject inaccessible workspaces with403; both app and Toggl v3 reports verify their requested workspace.

- `POST /api/app/report`: totals, time series and groupings. It does not embed entries.
- `POST /api/app/report/weekly`: the weekly grid, rows by `projects` or `clients`.
- `POST /api/app/report/entries`: the paged detailed list. `page_size` defaults to 100 and above 500 returns 400; a `page` past the end returns the last page and the response says which page it is.
- `POST /api/app/report/detailed.csv` and `/summary.csv`: CSV exports of what the app shows.

App routes allow ranges up to 3660 days (`MAX_RANGE_DAYS` in `packages/api/src/commands/reports.ts`) and always apply the workspace rounding setting unless the request overrides it. This includes the CSV exports, so CSV totals match the report on screen. The Toggl v3 compatibility routes in the same file pass `TOGGL_MAX_DAYS = 366` on purpose and share the same builders (`parseReportFilter`, `summaryCsv`, and so on). Rounding stays opt-in there, as in Toggl: `parseReportFilter` applies workspace rounding only when the request sends `rounding`.

<!-- kk:related:start -->
# Related

- Related: [map-report-route-admission-to-the-reportrunner-report-lane](map-report-route-admission-to-the-reportrunner-report-lane.md)
- Related: [map-reports-page-query-body-caching-and-cancellation](map-reports-page-query-body-caching-and-cancellation.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:6
<!-- kk:citations:end -->
