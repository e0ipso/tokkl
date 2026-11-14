# routes

Express routers, one per API area: `toggl/` for the Toggl v9 API, and the app, admin, timer and
report routes. A route checks access, parses its body with `commands`, calls one operation of a
service, and presents the result. It never opens a transaction or names a publisher: the
operations from `entriesFor`, `catalogsFor`, `accountsFor` and the other `…For(authentication)`
calls in `services/application.ts` do that. Each of those operations acts for the authenticated user
it was built for, so a route never passes `res.locals.auth.user.id` to it again. `context.ts` holds `Deps`, which `app.ts` builds once.
Each router takes `Pick<Deps, …>` of the parts it uses, so none of them sees storage or the
configuration.

`imports.ts` mounts ahead of the 1 MB body reader. For each import it authenticates, refuses an encoded (415)
or oversized (413) body, charges the account's import start limit (429), and takes an import place (503) before
it reads the body. The 8 MiB upload has 60 seconds from admission (408), and the import has five seconds from
the last byte. A disconnect or the deadline (503) rolls the import back whole. The deadline is cooperative: a
running query or rollback can outlast it.
