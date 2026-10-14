---
type: map
title: Web app report endpoints under /api/app/report
description: >-
  Web app reports are built server-side by /api/app/report/* with workspace
  rounding; only the summary tab fetches groupings.
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

App routes allow ranges up to 3660 days (`MAX_RANGE_DAYS` in `server/src/services/reports.ts`) and always apply the workspace rounding setting unless the request overrides it. This includes the CSV exports, so CSV totals match the report on screen. The Toggl v3 compatibility routes in the same file pass `TOGGL_MAX_DAYS = 366` on purpose and share the same builders (`filterFromBody`, `summaryCsv`, and so on). Rounding stays opt-in there, as in Toggl: `filterFromBody` applies workspace rounding only when the request sends `rounding`.

On the client, `reportQuery` in `web/src/pages/reports/query.ts` builds the `POST /api/app/report` body for the active tab. Only the summary tab asks for its own grouping and sub-grouping. The detailed and weekly tabs need just the totals, so they send `grouping: 'projects'` and `sub_grouping: 'projects'`; the server reads a sub-grouping equal to the grouping as "none". `useReport` in `web/src/api/hooks.ts` sets a 60 s `staleTime`, so switching back to the summary tab reuses the cached result. Entry edits still invalidate `keys.report`.
