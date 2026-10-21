---
type: practice
title: 'Web timer bar pause chain: pauseChain.ts, per-account storage, ending rules'
description: >-
  Pause stops, Resume starts a clone; tabChain.ts shares the chain in a tab,
  localStorage per account; Stop or a foreign entry ends it.
tags:
  - web
  - timer
  - pause
  - localstorage
kk_schema_version: 3
kk_id: practice-web-timer-bar-pause-chain-rules
kk_derived_from:
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:practice:4'
kk_relates_to:
  - practice-end-sessions-through-lib-session
  - practice-web-ui-survives-background-refetches
  - practice-kde-timer-controller-rules
kk_depends_on: []
kk_confidence: high
---
Pause and Resume in the timer bar are a chain of entries. Pause stops the running entry; Resume starts a clone that copies its description, project, task, tags and billable flag (the `ChainSnapshot`). The bar's clock shows the chain total, the seconds the server stored for the stopped entries plus the clone's running time. The rules are plain TypeScript in `packages/web/src/components/pauseChain.ts` (no React or DOM, so `node:test` loads it), and `TimerBar.tsx` drives them. `e2e/timer-pause.spec.ts` covers the behaviour.

- The chain is stored in `localStorage` under `tokkl.pauseChain.<accountId>` (`chainKey`), so another account in the same browser never sees it. At sign-out `endSession` in `packages/web/src/lib/session.ts` calls `forgetTabChain`, which empties this tab's memory copy, and then `forgetChains`.
- The timer bar and the Pomodoro session provider (`PomodoroSessionProvider.tsx`) both use the chain: the provider clears it when it stops the running entry and checks that the chain is still paused before a resuming start goes ahead. Both read and write it through `packages/web/src/components/tabChain.ts` (`readTabChain`, `writeTabChain`, `subscribeTabChain`), so a write from one reaches the other at once. Other tabs follow through the `storage` event, whose listener matches `chainKey` and then calls `readTabChain`. Read and write the chain only through `tabChain.ts`. `usePauseCoordination()` in `PauseCoordination.tsx` (which imports only `react`) shares `busy` (a pause or resume in flight from anything that pauses the entry) and `pausing` (a `PendingPause` whose `stopAfter` a Stop pressed mid-pause sets); `PauseCoordinationProvider` is mounted in `App.tsx` above `PomodoroSessionProvider` and the shell; `TimerBar.tsx` is its only reader.
- Full or blocked storage does not lose the chain in this tab. `saveChain` returns whether storage took the write. When storage refuses one (a full quota), `writeTabChain` keeps the chain in memory along with the text storage held at that moment, and `readTabChain` returns the memory copy for as long as storage still holds that text. A change from another tab, such as Stop's `removeItem` (which still works on a full quota), changes the stored text and wins, and the next successful write sends reads back to storage. When storage throws on every access, reads return the memory copy until the page reloads. The memory slot holds one account at a time, and sign-out empties it (see `practice-end-sessions-through-lib-session`). `e2e/timer-pause.spec.ts` checks that a refused pause is gone after the session expires and the same user logs in again without a reload. `e2e/timer-pause.spec.ts` has a test for a pause that full storage refuses.
- Other tabs follow through the `storage` event. A tab that shows no running entry must also load the paused snapshot into its draft, or its bar shows something other than what Resume will start.
- The chain ends on Stop, on a local start that is not a resume, and when the current entry shows another running entry or shows the clone stopped or replaced (`reconcile`). Stop while paused only clears the chain and the draft.
- Refetches must not end a chain that is changing. `reconcile` ignores current-entry data fetched at or before the chain's `since`, and the `chainBusy` ref skips reconciliation while a pause or resume is in flight.
- Stop pressed while Resume's start is still pending is remembered (`stopAfterResume`) and stops the clone once the start returns, so the two writes never overlap. Stop pressed while a pause's stop is in flight sets `stopAfter` on the pending pause (`pausing`) and sends nothing; when the stop answers, the pause ends the chain instead of recording it.
- Edits made while paused go into the snapshot (`withSnapshot`), so Resume and a reload use them.
- The page title (`useRunningTitle` in `App.tsx`) shows the running entry's own elapsed time, not the chain total.

<!-- kk:related:start -->
# Related

- Related: [practice-end-sessions-through-lib-session](../interaction-and-state/practice-end-sessions-through-lib-session.md)
- Related: [practice-web-ui-survives-background-refetches](../interaction-and-state/practice-web-ui-survives-background-refetches.md)
- Related: [practice-kde-timer-controller-rules](../../tooling-and-project/kde-companion/practice-kde-timer-controller-rules.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:practice:4
<!-- kk:citations:end -->
