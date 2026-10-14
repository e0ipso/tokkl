---
type: map
title: Web app report endpoints under /api/app/report
description: >-
  The web app's reports are aggregated server-side by /api/app/report/*; Toggl
  v3 report routes keep a 366-day cap.
tags:
  - server
  - reports
  - api
  - web
kk_schema_version: 3
kk_id: map-app-report-endpoints
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
`appReportRoutes` in `server/src/routes/reports.ts` (mounted at `/api/app`) serves every report the web app shows. The client does not aggregate entries itself.

- `POST /api/app/report`: totals, time series and groupings. It does not embed entries.
- `POST /api/app/report/weekly`: the weekly grid, rows by `projects` or `clients`.
- `POST /api/app/report/entries`: the paged detailed list. `page_size` defaults to 100 and above 500 returns 400; a `page` past the end returns the last page and the response says which page it is.
- `POST /api/app/report/detailed.csv` and `/summary.csv`: CSV exports of what the app shows.

App routes allow ranges up to 3660 days (`MAX_RANGE_DAYS` in `server/src/services/reports.ts`) and always apply the workspace rounding setting unless the request overrides it. The Toggl v3 compatibility routes in the same file pass `TOGGL_MAX_DAYS = 366` on purpose and share the same builders (`filterFromBody`, `summaryCsv`, and so on).
