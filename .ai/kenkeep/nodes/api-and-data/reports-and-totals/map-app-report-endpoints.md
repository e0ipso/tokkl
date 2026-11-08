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

Each report route first reserves a place in the ReportRunner's report lane (`reserve` in `packages/api/src/services/reportRunner.ts`, 16 places by default, the place belonging to the signed-in account). The account exports reserve one in the download lane instead (`reserveDownload`, 8 places, 2 per account, set with `downloads` in the runner options). Each account holds at most `maxPerUser` places at once (a quarter of the queue, 4 by default), reserved, queued or running. A full queue, or an account at its share, answers 503 `Report queue is full` with `Retry-After: 2` before the route reads the workspace or the export, and a cancelled request reads nothing. The route then validates ranges, sorting and page size on the main thread and submits a typed ReportJob in its place, with canonical values (`parseDetailedOrder` turns the app's `sort`/`dir` into an `OrderBy` and a `SortDirection`). `app.ts` builds the runner; the application services get it as a `ReportExecutor`. The worker opens a read-oriented backend connection. In-memory SQLite runs inline on the existing connection. Worker lifecycle and shutdown are covered on real file/server backends.

Account exports (`GET /api/app/export.json` and `/export.csv`) run as jobs of the runner's download lane (`services/exportJobs.ts`). A download holds its place for as long as the client reads, so it never shares a queue or a worker with reports. A download that runs longer than the lane's deadline (`deadlineMs`, 15 minutes by default) is given up like a cancelled one: the worker stops, and the request fails with 503 `Download took too long` and `Retry-After: 60`, or loses its connection if a piece already went out. The job checks the credential in its own read snapshot, reads the catalogs with `transfers.exportHead`, then pages the entries with `transfers.exportEntries` (newest first for JSON, oldest first for CSV, 500 at a time) and hands each serialised piece to the route. In the worker, pieces cross to the API thread with acknowledgements: the worker sends at most `EXPORT_BYTES_AHEAD` (1 MiB) more than the response took, and the job ends only once everything was taken. `http/download.ts` writes each piece and waits for `drain`; a client that does not drain for 30 seconds is dropped, which cancels the job. Headers go out with the first piece, so queue, credential and range refusals keep their status; a failure after that destroys the connection. The bytes match the old whole-projection serialiser, a frozen copy of which is `test/fixtures/exportOracle.ts`.

`runReportJob` in `reportJobs.ts` reads and formats a job inside one read snapshot through `readReport` (`services/reports.ts`), so the snapshot stays open while it formats. No job loads the whole selection:

- Detailed pages (`v3-search`, `app-entries`) count in SQL and read only their window. Date, user and last-update orders sort on `e.start`/`e.updated_at` in SQL; duration sorts on `reportRoundedSeconds` (`storage/repositories/report-sql.ts`), which computes the rounded seconds the report shows in all four dialects. Ties go to the id, in the same direction.
- Description order cannot be collated in SQL the way `localeCompare` does, so it reads every selected id and description, sorts them with `Intl.Collator`, and reads full rows only for the ids it needs.
- Aggregates (totals, series, groupings, weekly grids) and the detailed CSVs take entries in batches of `REPORT_BATCH_SIZE` (500): aggregates by start/id keyset, CSVs in report order by id lists. The aggregates in `reportAggregates.ts` keep sums and first-seen labels, never entries.

`test/storage/reportEquivalence.test.ts` holds every job kind on every backend to `test/storage/support/reportOracle.ts`, a frozen copy of the old whole-list pipeline, on a seeded history with start, duration and description ties, rounding boundaries and a daylight-saving week. A change to report output must change both on purpose.

On the client, `reportQuery` in `packages/web/src/pages/reports/query.ts` builds the `POST /api/app/report` body for the active tab. Only the summary tab asks for its own grouping and sub-grouping. The detailed and weekly tabs need just the totals, so they send `grouping: 'projects'` and `sub_grouping: 'projects'`; the server reads a sub-grouping equal to the grouping as "none". `useReport` in `packages/web/src/api/hooks.ts` sets a 60 s `staleTime`, so switching back to the summary tab reuses the cached result. Entry edits still invalidate `keys.report`.

Report state lives in the URL (`packages/web/src/pages/reports/urlState.ts`). The `projects`, `clients` and `tags` params hold dot-separated ids (`none` for no project, client or tag), and a leading `not.` negates the filter, for example `projects=not.none.4`. Choosing "Is not" before picking any option is kept as a bare `<param>=not.`. It parses back as negated with no ids and filters nothing until an option is chosen. Choosing "Is" with no options removes the param.

`services/reportRunner.ts` queues heavy jobs in two lanes, reports and downloads, and each lane runs one job at a time in its own worker. A lane owns admission, the per-account share, the turn order and cancellation. `services/reportExecution.ts` owns where the chosen job runs: the worker's start, messages, crash recovery and shutdown, or the inline path. A worker that crashes or exits fails the running and queued jobs, and the next job waits for the old worker's exit before a new one opens its reader. Queued jobs take turns between accounts: the next is the oldest job of the account served longest ago, so one account with a full share cannot hold the others back. Each job reads and formats in one consistent read snapshot, in batches, and the worker closes its separate reader on shutdown. In-memory SQLite reports reuse the existing connection inline.

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:6
<!-- kk:citations:end -->
