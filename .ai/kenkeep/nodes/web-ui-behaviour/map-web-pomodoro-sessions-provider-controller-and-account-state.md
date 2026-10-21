---
type: map
title: 'Web Pomodoro sessions: provider, controller and account state'
description: >-
  PomodoroSessionProvider owns account-local confirm-driven sessions; the
  controller saves snapped work-plus-rest entries.
tags:
  - web
  - pomodoro
  - timer
  - localstorage
kk_schema_version: 3
kk_id: map-web-pomodoro-sessions-provider-controller-and-account-state
kk_derived_from:
  - 'b2225129-5ef2-4f05-a52f-c5e72c04d34c:map:0'
kk_relates_to:
  - map-pomodoro-session-model-in-packages-common-pomodorosession
  - practice-end-sessions-through-lib-session
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
kk_depends_on: []
kk_confidence: high
---
`packages/web/src/components/PomodoroSessionProvider.tsx` exposes `usePomodoroSession` inside the signed-in shell in `packages/web/src/App.tsx`, nested within the existing timer-tied `PomodoroProvider`. It remounts account state by `me.id` and delegates `start`, `nextPhase`, `end` and `updateFields` to `createPomodoroSessionController` in `pomodoroSessionController.ts`. Each operation captures one instant before entering the lock; the shared model receives explicit instants.

`pomodoroSessionState.ts` owns device-local account state in `localStorage` under `tokkl.pomodoroSession.<accountId>`, serialized as version 1. It keeps the session id, revision, config, phase, exact `pomodoroStart`, ending claim and entry-field snapshot. `sessionFields` whitelists description, project, task, tags and billable, copying tags. Invalid or future records parse as no session. The provider listens for storage changes.

Moving from rest to work saves the preceding work-plus-rest span; End saves through the captured end instant. `pomodoroEntrySpan` from `packages/common/pomodoroSession.ts` wraps `snapSpan` with the signed-in account's timezone and resolution. The next pomodoro retains the unsnapped boundary. A collapsed span shows `This pomodoro was too short to save.` and sends no entry POST.

`pomodoroSessionLifecycle.ts` connects the provider to ordered authentication cleanup in `packages/web/src/lib/session.ts`. Controller and storage contracts live in `pomodoroSessionController.test.ts` and `pomodoroSessionState.test.ts` beside the implementation. `e2e/timer-pomodoro-session.spec.ts` exercises restored sessions through the existing logout controls and belongs to the isolated instance project in `playwright.config.ts` because it changes time resolution.

<!-- kk:related:start -->
# Related

- Related: [map-pomodoro-session-model-in-packages-common-pomodorosession](map-pomodoro-session-model-in-packages-common-pomodorosession.md)
- Related: [practice-end-sessions-through-lib-session](practice-end-sessions-through-lib-session.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write](../api-and-data/time-handling/practice-stopped-entries-snap-to-the-time-resolution-on-write.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] b2225129-5ef2-4f05-a52f-c5e72c04d34c:map:0
<!-- kk:citations:end -->
