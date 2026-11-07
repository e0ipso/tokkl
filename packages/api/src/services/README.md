# services

Application services that are not HTTP: timer delivery to streams and other processes, the
report runner and its worker, imports and exports. `application.ts` binds the domain to storage
and checks the signed-in credential around each operation. `entryOperations.ts` and
`catalogOperations.ts` are the time entry and catalog writes of one signed-in user: each method is
one transaction with its guards and timer publication bound in. No Express imports.
