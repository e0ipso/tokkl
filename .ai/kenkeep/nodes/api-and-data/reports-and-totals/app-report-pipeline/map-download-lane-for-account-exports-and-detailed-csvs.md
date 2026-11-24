---
type: map
title: Download lane for account exports and detailed CSVs
description: >-
  Account exports and detailed CSVs run in the download lane, stream
  acknowledged pieces through streamDownload and time out at 15 min.
tags:
  - server
  - reports
  - api
kk_schema_version: 3
kk_id: map-download-lane-for-account-exports-and-detailed-csvs
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:6'
kk_relates_to:
  - map-report-route-admission-to-the-reportrunner-report-lane
  - map-report-job-reads-in-sql-batches-and-golden-report-answers
kk_depends_on:
  - map-reportrunner-lanes-worker-placement-and-crash-handling
kk_confidence: high
---
The account exports and the detailed CSVs (`POST /api/app/report/detailed.csv` and v3 `search/time_entries.csv`) reserve one in the download lane instead (`reserveDownload`, 8 places, 2 per account, set with `downloads` in the runner options). The detailed CSVs are `CsvDownloadJob`s, not `ReportJob`s: `runCsvDownloadJob` in `reportJobs.ts` emits the header, then each batch's lines, through the same emitter and `streamDownload` path as the exports, so neither the worker nor the API thread holds the whole file. The pieces join to the bytes the old whole answer had; only the `Content-Length` header is gone, as the body is chunked. The summary CSVs stay whole `ReportJob`s, since they hold one line per group.

Account exports (`GET /api/app/export.json` and `/export.csv`) run as jobs of the runner's download lane (`services/exportJobs.ts`; `services/downloadJobs.ts` dispatches between them and the detailed CSVs). A download holds its place for as long as the client reads, so it never shares a queue or a worker with reports. A download that runs longer than the lane's deadline (`deadlineMs`, 15 minutes by default) is given up like a cancelled one: the worker stops, and the request fails with 503 `Download took too long` and `Retry-After: 60`, or loses its connection if a piece already went out. The job checks the credential in its own read snapshot, reads the catalogs with `transfers.exportHead`, then pages the entries with `transfers.exportEntries` (newest first for JSON, oldest first for CSV, 500 at a time) and hands each serialised piece to the route. In the worker, pieces cross to the API thread with acknowledgements: the worker sends at most `EXPORT_BYTES_AHEAD` (1 MiB) more than the response took, and the job ends only once everything was taken. `http/download.ts` writes each piece and waits for `drain`; a client that does not drain for 30 seconds is dropped, which cancels the job. Headers go out with the first piece, so queue, credential and range refusals keep their status; a failure after that destroys the connection. `test/storage/exportEquivalence.test.ts` pins the bytes with golden digests on every backend and checks that worker and inline exports agree.

<!-- kk:related:start -->
# Related

- Related: [map-report-route-admission-to-the-reportrunner-report-lane](map-report-route-admission-to-the-reportrunner-report-lane.md)
- Related: [map-report-job-reads-in-sql-batches-and-golden-report-answers](map-report-job-reads-in-sql-batches-and-golden-report-answers.md)
- Depends on: [map-reportrunner-lanes-worker-placement-and-crash-handling](map-reportrunner-lanes-worker-placement-and-crash-handling.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:6
<!-- kk:citations:end -->
