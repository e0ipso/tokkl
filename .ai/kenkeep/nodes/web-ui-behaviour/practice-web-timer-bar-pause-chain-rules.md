---
type: practice
title: 'Web timer bar pause chain: pauseChain.ts, per-account storage, ending rules'
description: >-
  Pause stops the entry, Resume starts a clone; the chain lives in localStorage
  per account and ends on Stop, sign-out or a foreign entry.
tags:
  - web
  - timer
  - pause
  - localstorage
kk_schema_version: 3
kk_id: practice-web-timer-bar-pause-chain-rules
kk_derived_from: []
kk_relates_to:
  - practice-end-sessions-through-lib-session
  - practice-web-ui-survives-background-refetches
  - practice-kde-timer-controller-rules
kk_depends_on: []
kk_confidence: high
---
Pause and Resume in the timer bar are a chain of entries. Pause stops the running entry; Resume starts a clone that copies its description, project, task, tags and billable flag (the `ChainSnapshot`). The bar's clock shows the chain total, the seconds the server stored for the stopped entries plus the clone's running time. The rules are plain TypeScript in `packages/web/src/components/pauseChain.ts` (no React or DOM, so `node:test` loads it), and `TimerBar.tsx` drives them. `e2e/timer-pause.spec.ts` covers the behaviour.

- The chain is stored in `localStorage` under `tokkl.pauseChain.<accountId>` (`chainKey`), so another account in the same browser never sees it. `endSession` in `packages/web/src/lib/session.ts` calls `forgetChains` at sign-out.
- Other tabs follow through the `storage` event. A tab that shows no running entry must also load the paused snapshot into its draft, or its bar shows something other than what Resume will start.
- The chain ends on Stop, on a local start that is not a resume, and when the current entry shows another running entry or shows the clone stopped or replaced (`reconcile`). Stop while paused only clears the chain and the draft.
- Refetches must not end a chain that is changing. `reconcile` ignores current-entry data fetched at or before the chain's `since`, and the `chainBusy` ref skips reconciliation while a pause or resume is in flight.
- Stop pressed while Resume's start is still pending is remembered (`stopAfterResume`) and stops the clone once the start returns, so the two writes never overlap.
- Edits made while paused go into the snapshot (`withSnapshot`), so Resume and a reload use them.
- The page title (`useRunningTitle` in `App.tsx`) shows the running entry's own elapsed time, not the chain total.

<!-- kk:related:start -->
# Related

- Related: [practice-end-sessions-through-lib-session](practice-end-sessions-through-lib-session.md)
- Related: [practice-web-ui-survives-background-refetches](practice-web-ui-survives-background-refetches.md)
- Related: [practice-kde-timer-controller-rules](../tooling-and-project/kde-companion/practice-kde-timer-controller-rules.md)
<!-- kk:related:end -->
