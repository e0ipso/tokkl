# routes

Express routers, one per API area: `toggl/` for the Toggl v9 API, and the app, admin, timer and
report routes. A route checks access, parses its body with `commands`, calls one operation of a
service, and presents the result. It never opens a transaction or names a publisher: the
operations from `entriesFor`, `catalogsFor`, `accountsFor` and the other `…For(authentication)`
calls in `services/application.ts` do that. `context.ts` holds `Deps`, which `app.ts` builds once.
Each router takes `Pick<Deps, …>` of the parts it uses, so none of them sees storage or the
configuration.
