# storage

The database: connections, migrations, the physical schema, the transaction runner with its lock
order, and one repository per table under `repositories/`. Repositories return the records in
`domain.ts` and know no business rules. Imports only `lib`.
