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
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:6'
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
`appReportRoutes` in `packages/api/src/routes/reports.ts` (mounted at `/api/app`) serves every report the web app shows. The client does not aggregate entries itself. App reports cover the signed-in user's `default_workspace_id`. Membership-scoped repository reads reject inaccessible workspaces with403; both app and Toggl v3 reports verify their requested workspace.

- `POST /api/app/report`: totals, time series and groupings. It does not embed entries.
- `POST /api/app/report/weekly`: the weekly grid, rows by `projects` or `clients`.
- `POST /api/app/report/entries`: the paged detailed list. `page_size` defaults to 100 and above 500 returns 400; a `page` past the end returns the last page and the response says which page it is.
- `POST /api/app/report/detailed.csv` and `/summary.csv`: CSV exports of what the app shows.

App routes allow ranges up to 3660 days (`MAX_RANGE_DAYS` in `packages/api/src/commands/reports.ts`) and always apply the workspace rounding setting unless the request overrides it. This includes the CSV exports, so CSV totals match the report on screen. The Toggl v3 compatibility routes in the same file pass `TOGGL_MAX_DAYS = 366` on purpose and share the same builders (`parseReportFilter`, `summaryCsv`, and so on). Rounding stays opt-in there, as in Toggl: `parseReportFilter` applies workspace rounding only when the request sends `rounding`.

Each report route and the account exports first reserve a place in the ReportRunner queue (`reserve` in `packages/api/src/services/reportRunner.ts`, 16 places by default). A full queue answers 503 `Report queue is full` with `Retry-After: 2` before the route reads the workspace or the export, and a cancelled request reads nothing. The route then validates ranges, sorting and page size on the main thread and submits a typed ReportJob in its place, with canonical values (`parseDetailedOrder` turns the app's `sort`/`dir` into an `OrderBy` and a `SortDirection`). `app.ts` builds the runner; the application services get it as a `ReportExecutor`. The worker opens a read-oriented backend connection. In-memory SQLite runs inline on the existing connection. Worker lifecycle and shutdown are covered on real file/server backends.

`runReportJob` in `reportJobs.ts` reads and formats a job inside one read snapshot through `readReport` (`services/reports.ts`), so the snapshot stays open while it formats. No job loads the whole selection:

- Detailed pages (`v3-search`, `app-entries`) count in SQL and read only their window. Date, user and last-update orders sort on `e.start`/`e.updated_at` in SQL; duration sorts on `reportRoundedSeconds` (`storage/repositories/report-sql.ts`), which computes the rounded seconds the report shows in all four dialects. Ties go to the id, in the same direction.
- Description order cannot be collated in SQL the way `localeCompare` does, so it reads every selected id and description, sorts them with `Intl.Collator`, and reads full rows only for the ids it needs.
- Aggregates (totals, series, groupings, weekly grids) and the detailed CSVs take entries in batches of `REPORT_BATCH_SIZE` (500): aggregates by start/id keyset, CSVs in report order by id lists. The aggregates in `reportAggregates.ts` keep sums and first-seen labels, never entries.

`test/storage/reportEquivalence.test.ts` holds every job kind on every backend to `test/storage/support/reportOracle.ts`, a frozen copy of the old whole-list pipeline, on a seeded history with start, duration and description ties, rounding boundaries and a daylight-saving week. A change to report output must change both on purpose.

On the client, `reportQuery` in `packages/web/src/pages/reports/query.ts` builds the `POST /api/app/report` body for the active tab. Only the summary tab asks for its own grouping and sub-grouping. The detailed and weekly tabs need just the totals, so they send `grouping: 'projects'` and `sub_grouping: 'projects'`; the server reads a sub-grouping equal to the grouping as "none". `useReport` in `packages/web/src/api/hooks.ts` sets a 60 s `staleTime`, so switching back to the summary tab reuses the cached result. Entry edits still invalidate `keys.report`.

Report state lives in the URL (`packages/web/src/pages/reports/urlState.ts`). The `projects`, `clients` and `tags` params hold dot-separated ids (`none` for no project, client or tag), and a leading `not.` negates the filter, for example `projects=not.none.4`. Choosing "Is not" before picking any option is kept as a bare `<param>=not.`. It parses back as negated with no ids and filters nothing until an option is chosen. Choosing "Is" with no options removes the param.

`services/reportRunner.ts` runs heavy jobs in one worker, one job at a time. Each job reads and formats in one consistent read snapshot, in batches, and the worker closes its separate reader on shutdown. In-memory SQLite reports reuse the existing connection inline.

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:6
<!-- kk:citations:end -->
