# domain

Tokkl's rules: entries and their spans, timers and Pomodoro sessions, catalogs, accounts,
credentials and instance settings. Operations take typed commands (`*Commands.ts`) and throw
`ApplicationError`s. Imports `storage` and `lib`, never HTTP, services or presenters.

Two kinds of code touch storage. A `create*Operations` factory takes a runner (`AccountRunner`,
`TimerRunner`) and each of its methods opens one transaction. A function that takes an
`OperationContext` (`EntryContext`, `CatalogContext`) runs in the transaction its caller opened.
The context has no `transaction` method, so it cannot start another one.
