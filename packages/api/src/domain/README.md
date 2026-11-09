# domain

Tokkl's rules: entries and their spans, timers and Pomodoro sessions, catalogs, accounts,
credentials and instance settings. Operations take typed commands (`*Commands.ts`) and throw
`ApplicationError`s. Imports only `lib`, never storage, HTTP, services or presenters.

The domain owns what storage implements: the records in `model.ts`, and in `ports.ts` the
repository and reader interfaces, the transaction context, `Storage`, the `StorageConflict` a
repository throws and the `TimerBus` that carries timer signals between processes. `storage/` imports these two modules and nothing else from here.

Two kinds of code touch storage. A `create*Operations` factory takes a runner (`AccountRunner`,
`TimerRunner`) and each of its methods opens one transaction. A function that takes an
`OperationContext` (`EntryContext`, `CatalogContext`) runs in the transaction its caller opened.
The context has no `transaction` method, so it cannot start another one.

A dependency parameter names only what the code calls. `getEntryIn` takes `{ entries: { get } }`,
`stopEntryAt` the settings reader and `entries.update`, and the entry and catalog services take an
`EntryTransactions` runner whose transactions hold the entry repositories only. A `Storage` fits
each of these, and so does a test double that offers just the named methods.
