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

`importAdmission.ts` limits running imports: four per instance, one per account and 8 MiB of file bytes in
total, with a place held until the work settled, a rollback included. `importPolicy.ts` caps a file at 10,000
records, 250,000 values or cells (a CSV Tags cell counts once per tag name) and 32 levels of JSON nesting, and
`importGuards.ts` stops an import at a disconnect or at the processing deadline, which it reads from the monotonic
clock as well as from its signal.
