---
type: map
title: 'ReportRunner lanes, worker placement and crash handling'
description: >-
  createReportRunner places jobs on worker threads or inline; each lane runs
  concurrent workers, owns admission, FIFO and crash recovery.
tags:
  - server
  - reports
kk_schema_version: 3
kk_id: map-reportrunner-lanes-worker-placement-and-crash-handling
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:6'
kk_relates_to:
  - map-report-route-admission-to-the-reportrunner-report-lane
  - map-download-lane-for-account-exports-and-detailed-csvs
  - map-report-job-reads-in-sql-batches-and-golden-report-answers
kk_depends_on: []
kk_confidence: high
---
`index.ts` builds the runner with `createReportRunner` (`src/reportRunners.ts`) and hands it to `createApplicationServices` as a `ReportExecutor`. `createReportRunner` turns the storage configuration into a placement: worker threads that run `src/reportWorker.ts`, each opening a read-oriented backend connection, or inline on the existing connection for in-memory SQLite. `services/` never imports `storage/`; `scripts/check-api-imports.ts` refuses it. Tests pass `startWorker` to `createReportRunner` to watch or fake the threads. Worker lifecycle and shutdown are covered on real file/server backends.

`services/reportRunner.ts` queues heavy jobs in two lanes, reports and downloads. Each lane runs up to `concurrency` jobs at once, each execution with its own worker and reader: 2 for reports and 3 for downloads (`REPORT_DEFAULTS`, `DOWNLOAD_DEFAULTS`), lowered to `maxQueue` when that is smaller, and one for in-memory SQLite, which has one connection. So one slow download holds only its own worker, not the lane. A lane starts at most one worker at a time, so workers that cannot open their reader fail the queue after one attempt. A lane owns admission, the per-account share (running jobs count toward it), FIFO order and cancellation. `services/reportExecution.ts` owns where the chosen job runs: the worker's start (through the placement's `startWorker`), messages, crash recovery and shutdown, or the inline path. A worker that crashes or exits fails its own running job and the queued ones, while jobs on the lane's other workers carry on, and the next job waits for the old worker's exit before a new one opens its reader. Queued jobs run in arrival order; the per-account share keeps one account from filling the lane. Each job reads and formats in one consistent read snapshot, in batches, and the worker closes its separate reader on shutdown. In-memory SQLite reports reuse the existing connection inline.

<!-- kk:related:start -->
# Related

- Related: [map-report-route-admission-to-the-reportrunner-report-lane](map-report-route-admission-to-the-reportrunner-report-lane.md)
- Related: [map-download-lane-for-account-exports-and-detailed-csvs](map-download-lane-for-account-exports-and-detailed-csvs.md)
- Related: [map-report-job-reads-in-sql-batches-and-golden-report-answers](map-report-job-reads-in-sql-batches-and-golden-report-answers.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:6
<!-- kk:citations:end -->
