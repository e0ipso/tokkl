---
type: map
title: Server API capabilities and Pomodoro limits in /api/app/status
description: >-
  GET /api/app/status names api_version, capabilities clients probe for, and
  pomodoro_limits from packages/common.
tags:
  - api
  - pomodoro
kk_schema_version: 3
kk_id: map-server-api-capabilities-and-pomodoro-limits-in-api-app-status
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:9'
kk_relates_to:
  - map-pomodoro-session-model-in-packages-common-pomodorosession
  - map-timer-start-stop-and-edit-routes
kk_depends_on: []
kk_confidence: high
---
`GET /api/app/status` announces the server's capabilities, and the Toggl `/me` body does not: `api_version` and `capabilities` (`presenters/serverApi.ts`, typed as `ServerApi` in `packages/types`) name `app-preferences`, `timer-actions`, `timer-edit`, `pomodoro-revision`, `pause-revision`, `timer-edit-entry` and `idempotency-keys`, so clients stop guessing an old server from a 404. Add a name there when a route or body field a client probes for lands, with a probe in `test/serverApi.test.ts` (its `PROBES` map is typed by `ServerCapability`, so a new name without one does not compile). The status reply also carries `pomodoro_limits`: the inclusive `min`, `max` and `default` of each session length, named as the Pomodoro start body names them, from `POMODORO_SESSION_CONFIG_RANGES` and `DEFAULT_POMODORO_SESSION_CONFIG` in `packages/common/pomodoroSession.ts`. Clients read them there instead of copying them. Every test that pins the status body takes it from `SERVER_API` in `test/helpers.ts`, except `scripts/production-image-smoke.ts` and `FRESH_STATUS` in `e2e/auth-browser.spec.ts`, which repeat it.

<!-- kk:related:start -->
# Related

- Related: [map-pomodoro-session-model-in-packages-common-pomodorosession](../../../web-ui-behaviour/pomodoro/map-pomodoro-session-model-in-packages-common-pomodorosession.md)
- Related: [map-timer-start-stop-and-edit-routes](map-timer-start-stop-and-edit-routes.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:9
<!-- kk:citations:end -->
