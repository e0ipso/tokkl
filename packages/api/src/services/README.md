# services

Application services coordinate domain operations, timer delivery, reports, imports
and exports. They use domain ports to reach storage and import no Express or
`storage/` code. `scripts/check-api-imports.ts` enforces the storage boundary.

`application.ts` binds operations to the authenticated user and checks credentials
around each operation. Entry and catalog writes in `entryOperations.ts` and
`catalogOperations.ts` each open one transaction with guards and timer publication,
then call domain functions within it.

`index.ts` passes `createApplicationServices` the report executor, timer bus and
clock. `reportRunners.ts` selects worker threads running `reportWorker.ts`, or
inline execution for in-memory SQLite.

Reports and exports reserve queue capacity before reading; each account has a
limit. `reportRunner.ts` admits, cancels and schedules jobs per lane.
`reportExecution.ts` handles execution, worker messages, crash recovery and shutdown.
Each report reads and formats within one snapshot through `readReport` in
`reports.ts`. Detailed reports count and page in SQL; other reports read batches.
Account exports in `exportJobs.ts` stream batches from one snapshot without holding
the full history in memory.

`maintenance.ts` runs housekeeping outside requests, including expired idempotency
key cleanup. Services stop maintenance during shutdown. Timer operations and
maintenance use the supplied clock.
