# services

Application services that are not HTTP: timer delivery to streams and other processes, the
report runner and its worker, imports and exports. `application.ts` binds the domain to storage
and checks the signed-in credential around each operation. `app.ts` builds the report runner and
passes it in as a `ReportExecutor`. Reports and exports reserve a place in its queue before they
read anything, and each account may hold only its share of the places. A report job reads and
formats in one read snapshot (`readReport` in `reports.ts`): detailed pages count and page in SQL,
and everything else takes the entries a batch at a time. `entryOperations.ts` and
`catalogOperations.ts` are the time entry and catalog writes of one signed-in user. Each method
opens one transaction with its guards and timer publication bound in, and calls domain functions
that run inside it. No Express imports.
