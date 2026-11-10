# storage

The database: connections, migrations, the physical schema, the transaction runner with its lock
order, and one repository per table under `repositories/`. Repositories return the records in
`domain/model.ts` and implement the repository interfaces in `domain/ports.ts`, and know no
business rules. Imports `lib` and those two domain modules, nothing else of the domain. Nothing
the domain needs to know lives here: driver error codes become a `StorageConflict` from the ports.
