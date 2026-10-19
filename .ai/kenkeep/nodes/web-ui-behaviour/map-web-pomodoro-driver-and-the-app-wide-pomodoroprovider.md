---
type: map
title: 'Web Pomodoro: pomodoroCycle.ts, usePomodoro and the app-wide PomodoroProvider'
description: >-
  The Pomodoro runs on every signed-in page; a per-account cycle that follows
  the running entry, freezes at a pause and rings a local bell.
tags:
  - web
  - pomodoro
  - timer
  - localstorage
kk_schema_version: 3
kk_id: map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider
kk_derived_from: []
kk_relates_to:
  - map-pomodoro-cycle-functions-in-packages-common
  - practice-web-timer-bar-pause-chain-rules
  - practice-web-ui-survives-background-refetches
  - practice-preferences-validated-by-known-key
kk_depends_on: []
kk_confidence: high
---
`packages/web/src/components/pomodoroCycle.ts` drives the Pomodoro over the clock-free rules in `@tokkl/common/pomodoro` (see `map-pomodoro-cycle-functions-in-packages-common`). It is plain TypeScript with no React or DOM, so `node:test` loads it. `pomodoroConfig(prefs)` maps the `pomodoro_*` preferences onto the settings and returns null while the Pomodoro is off. `advance(state, timer, now, config)` moves the cycle to `now`. `countdown` and `nextDeadline` work from stored instants and `now`, never from ticks, so a throttled background tab shows the right time when it wakes. The cycle (work phase, break, completed count) belongs to the device and is stored in `localStorage` under `tokkl.pomodoro.<accountId>` (`pomodoroKey`).

`TimerView` is what `advance` sees of the timer: `{ entryId, resumed, paused, pausedAt }`. `WorkState` keeps the `entryId` the phase last followed, so another entry that starts running abandons the phase (the count stays) and begins a fresh one, while Resume's clone (`resumed`) continues it. A pause freezes work time at `pausedAt`, when the pause began, not when its stop answered; a pause recorded in another tab freezes at its chain's `since`. With `pomodoro_stop_timer_at_end` on, the end of a work phase pauses the running entry.

`usePomodoro.ts` holds the state, and `PomodoroProvider.tsx` wraps the signed-in shell in `App.tsx`, so phases end, ring and show `PomodoroBanner` on every page; the timer bar shows the countdown when it is mounted. For stop-at-end the bar's own Pause (`barPause`) runs while the bar is mounted; elsewhere the provider stops the entry and records the pause through `tabChain.ts`, so Resume on the timer page starts a clone. Either way the pause waits until no other write is in flight and holds `busy` (see `practice-web-timer-bar-pause-chain-rules`).

Turning the Pomodoro off drops the cycle. The switch-off shows at once and a failed save rolls it back, so the countdown hides at once, but `usePomodoro` clears the stored cycle only when no preferences save is pending. `useSavePreferences` sets `mutationKey: keys.preferences`, and the provider checks `useIsMutating` for that key. Every preferences write in the web app goes through `useSavePreferences`; keep it that way, or the check misses the new write.

The bell is `packages/web/public/sounds/pomodoro-bell.mp3`, served from the app's own origin because the Content Security Policy allows media only from `'self'`. Tokkl generated it with FFmpeg; `docs/sounds/README.md` holds the command, the SHA-256 and the MIT licence. It loads on the first ring, and a rejected or throwing `play()` is ignored, since the banner shows either way.

`e2e/timer-pomodoro.spec.ts` and `e2e/settings-pomodoro.spec.ts` cover it. They move the browser clock with `page.clock` while the server keeps real time, so the phase lengths are short and countdowns are checked within a few seconds.

<!-- kk:related:start -->
# Related

- Related: [map-pomodoro-cycle-functions-in-packages-common](map-pomodoro-cycle-functions-in-packages-common.md)
- Related: [practice-web-timer-bar-pause-chain-rules](practice-web-timer-bar-pause-chain-rules.md)
- Related: [practice-web-ui-survives-background-refetches](practice-web-ui-survives-background-refetches.md)
- Related: [practice-preferences-validated-by-known-key](../api-and-data/users-and-admin/practice-preferences-validated-by-known-key.md)
<!-- kk:related:end -->
