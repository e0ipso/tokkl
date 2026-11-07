# services

Application services that are not HTTP: timer delivery to streams and other processes, the
report runner and its worker, imports and exports. `application.ts` binds the domain to storage
and checks the signed-in credential around each operation. No Express imports.
