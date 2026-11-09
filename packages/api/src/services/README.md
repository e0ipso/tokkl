# services

Application services that are not HTTP: timer delivery to streams and other processes, the
report runner, imports and exports. Services reach the database through the domain's ports only and
never import `storage/`; `scripts/check-api-imports.ts` enforces it. `reportRunners.ts`, at the top
of `src`, turns a storage configuration into the runner's placement (worker threads that run
`reportWorker.ts`, or inline for in-memory SQLite), and `app.ts` passes in the timer bus. `application.ts` binds the domain to storage
and checks the signed-in credential around each operation. `app.ts` builds the report runner and
passes it in as a `ReportExecutor`. Reports and exports reserve a place in its queue before they
read anything, and each account may hold only its share of the places. `reportRunner.ts` admits,
cancels and orders the jobs and runs a few at once per lane; `reportExecution.ts` runs each chosen one, in the worker (start,
messages, crash recovery, shutdown) or inline for in-memory SQLite. Account exports are jobs too (`exportJobs.ts`): they read the
entries a batch at a time in the job's snapshot and stream each piece to the response, never
holding the history whole. A report job reads and
formats in one read snapshot (`readReport` in `reports.ts`): detailed pages count and page in SQL,
and everything else takes the entries a batch at a time. `entryOperations.ts` and
`catalogOperations.ts` are the time entry and catalog writes of one signed-in user. Each method
opens one transaction with its guards and timer publication bound in, and calls domain functions
that run inside it. `maintenance.ts` runs housekeeping on a timer, off the request path: it
forgets expired idempotency keys, and the services close it on shutdown. No Express imports.
