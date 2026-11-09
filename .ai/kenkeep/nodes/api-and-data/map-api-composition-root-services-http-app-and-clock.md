---
type: map
title: 'API composition root: services, HTTP app and clock'
description: >-
  index.ts builds createApplicationServices, then createHttpApp over them, and
  holds the typed close; tests compose the same two pieces through composeApp
  and pass a fixed Clock.
tags:
  - server
  - architecture
  - testing
kk_schema_version: 3
kk_id: map-api-composition-root-services-http-app-and-clock
kk_derived_from:
  - packages/api/src/index.ts
  - packages/api/src/app.ts
  - packages/api/src/services/application.ts
  - packages/api/test/fixtures/app.ts
kk_relates_to:
  - practice-signed-in-operations-bind-the-authenticated-user
  - map-app-report-endpoints
kk_depends_on: []
kk_confidence: high
---
`packages/api/src/index.ts` is the server's composition root. After it opens storage and starts the timer bus, it builds the application services with `createApplicationServices({ storage, reports, bus, clock, logger, sessionDays })` (`services/application.ts`), passing `createReportRunner(config.storage, storage, { logger })` as `reports` and `systemClock` (`lib/clock.ts`) as `clock`. It then calls `createHttpApp(services, { storage, config, setup, logger })` (`app.ts`), which adds the HTTP adapters (rate limiters, auth middleware, session handlers, routers) and returns an `HttpApp` of `{ app, close }`. `close()` answers new requests with 503, aborts running ones through `res.locals.workSignal`, then closes the services (report runner, maintenance, streams). `index.ts` awaits it beside `server.close()` and closes the bus and storage afterwards. Nothing hangs on `app.locals`.

The services own the timer bus wiring: `createTimerDelivery` registers `bus.receive` and refreshes local streams on each remote signal. The caller still owns the bus's lifetime.

`Clock` (`now(): Date`) is a domain port in `domain/ports.ts`. `createTimerOperations(runner, user, publish, clock)` reads it once per action, and `runMaintenance`/`startMaintenance` take `{ clock }`. Operations never take a `now` argument.

Tests compose the same pieces. `composeApp` in `packages/api/test/fixtures/app.ts` fills in the defaults `index.ts` uses (local bus, report runner on `config.storage`, logger at `config.logLevel`, system clock) and returns `{ app, close, services }`; `createApp` returns only the Express app for tests that never close it. `test/helpers.ts`, `test/storage/support/invariantHttp.ts` and `desktop/gnome/extension/ci/realservice.test.ts` use them. For time, `test/fixtures/clock.ts` has `fixedClock(at)` and `manualClock(start)`; the timer adapters in `test/fixtures/entryBodies.ts` (`timersById`, `bodyTimers`) and the timer helpers in `test/fixtures/domain.ts` keep a trailing `now?: Date` that builds the operations on a fixed clock for that call.
