# kenkeep Index: api-and-data

↑ Parent: [kenkeep](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`password-and-csrf-rules/`](password-and-csrf-rules/index.md) for more information on password rate limits, Retry-After and the CSRF header rule; read before adding a route that checks or sets a password, starts a session or writes.
- Load [`reports-and-totals/`](reports-and-totals/index.md) for more information on report endpoints, project and task totals, hourly rates, write-path reference checks and client deletion; read before changing reports, totals, rates or project and client writes.
- Load [`time-handling/`](time-handling/index.md) for more information on timestamp parsing, canonical time zone names and time-resolution snapping of stopped entries; read before changing how the API reads, stores or rounds times.
- Load [`timer-state/`](timer-state/index.md) for more information on the server-owned timer state (running entry, pause chain, Pomodoro session), its revisions and actions, and the SSE event stream; read before changing timer routes, writes to the running entry, or stream auth.
- Load [`toggl-compat-and-import/`](toggl-compat-and-import/index.md) for more information on Toggl v9 DELETE responses, Toggl CSV import and JSON restore; read before changing a v9 route or an import or restore path.
- Load [`users-and-admin/`](users-and-admin/index.md) for more information on accounts, roles, workspace membership, preferences, the admin API, invites, password resets and instance settings; read before changing users, admin routes, sign-in refusal or instance settings.

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**API composition root: services, HTTP app and clock**](map-api-composition-root-services-http-app-and-clock.md) to learn about: index.ts builds createApplicationServices, then createHttpApp over them, and holds the typed close; tests compose the same two pieces through composeApp and pass a fixed Clock. #server #architecture #testing

## By topic

### #architecture
- Open [**Signed-in operations bind the authenticated user at construction**](users-and-admin/practice-signed-in-operations-bind-the-authenticated-user.md) — entriesFor, timersFor, catalogsFor, importsFor, preferencesFor and accountsFor take the Authentication once; routes never pass the user's id or the admin actor again.
- Open [**API composition root: services, HTTP app and clock**](map-api-composition-root-services-http-app-and-clock.md) — index.ts builds createApplicationServices, then createHttpApp over them, and holds the typed close; tests compose the same two pieces through composeApp and pass a fixed Clock.
### #server
- Open [**Admin user management API and the last-active-admin rule**](users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Signed-in operations bind the authenticated user at construction**](users-and-admin/practice-signed-in-operations-bind-the-authenticated-user.md) — entriesFor, timersFor, catalogsFor, importsFor, preferencesFor and accountsFor take the Authentication once; routes never pass the user's id or the admin actor again.
- Open [**Parse incoming timestamps with parseInstant**](time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../tooling-and-project/testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../tooling-and-project/testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.