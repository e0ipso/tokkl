# routes

Express routers, one per API area: `toggl/` for the Toggl v9 API, and the app, admin, timer and
report routes. A route checks access, parses its body with `commands`, calls the domain or a
service, and presents the result. `context.ts` holds `Deps`, the dependencies `app.ts` builds once
and hands to every router.
