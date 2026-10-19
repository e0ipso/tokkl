---
type: practice
title: 'E2E isolation: worker accounts, the reset fixture and the error guard'
description: >-
  Each worker has its own admin; the data fixture wipes that user's data;
  runtimeErrors fails tests unless a spec allows the failure.
tags:
  - testing
  - e2e
kk_schema_version: 3
kk_id: practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
- Each `desktop` worker signs in as its own admin, `worker-<runid>-<workerIndex>@e2e.example`, invited by the setup admin by the worker-scoped `account` fixture in `e2e/fixtures.ts` and deleted when the worker stops. `e2e/global-setup.ts` sets `TOKKL_E2E_RUN_ID` (`RUN_ID_VARIABLE`, eight characters of a UUID) before any worker starts, and workers inherit it, so two runs never build the same address. The fixture throws when the variable is missing. A run killed before its workers stop (SIGKILL cannot run the exit cleanup, and the runner's `webServer` processes can stay up) leaves its worker accounts on a data directory that persists. Global setup deletes every account whose email matches `WORKER_EMAIL` (`/^worker-[^@]*@e2e\.example$/`, `e2e/fixtures.ts`) on each server through `TestData.deleteWorkerAccounts()`, the older `worker-<n>@e2e.example` format included. `e2e/worker-accounts.spec.ts`, in `INSTANCE_SPECS`, pins that pattern: it matches both formats and no other address. `login` in `e2e/helpers.ts` and the API helpers that log in by password use `currentAccount()`, which is the setup admin (`ADMIN_ACCOUNT`) in the instance project. Two runs sharing one persistent `TOKKL_E2E_DATA_DIR` would delete each other's live worker accounts, which is why the directory is locked (see the data directory item above).
- The automatic `data` fixture in `e2e/fixtures.ts` deletes entries (running or not), the trash, projects, clients and tags, and resets preferences (the theme goes back to "system") before and after every test. It posts `BASELINE_PREFERENCES` in `e2e/fixtures.ts`, the defaults a new account gets for every preference a scenario changes, the six `pomodoro_*` keys included; a spec that writes another preference adds its key there, or the next test on that worker account inherits the value. `reset()` touches only the signed-in user's workspace, so parallel workers do not wipe each other. In the instance project it first runs `TestData.resetInstance()`, in a `finally` so a failed test still cleans up: it deletes every account but the setup admin and revokes pending invites. Password reset links go with their accounts through the foreign-key cascade. Each spec must create the data it needs and cannot rely on another spec's leftovers.
- Every scenario also runs under the automatic `runtimeErrors` fixture (`RuntimeErrors` in `e2e/runtime-errors.ts`). It fails the test on uncaught page errors, console errors, responses with status 400 or higher, and failed requests. React logs errors caught by an ErrorBoundary through `console.error`, so those fail the test too. Chromium's "Failed to load resource" console lines are ignored because the response and requestfailed listeners already record the same failures.
- The guard has two exceptions. An `/api/` 403 on a request without a `tokkl_session` cookie passes, because the app probes `/api/v9/me` on load while logged out. A scenario that provokes a failure on purpose calls `runtimeErrors.allowResponse({ status, method, path, reason })` before triggering it; `path` is a RegExp and `reason` says why the failure is expected. Do not clear `runtimeErrors.issues` in scenarios. Only the canaries in `e2e/guard.spec.ts` do that.
- Specs for loading and error states (`page-states.spec.ts`) provoke the failure on purpose, so they call `runtimeErrors.allowResponse` for each failing request. Error toasts and load errors are both `role=alert`; scope or filter `getByRole('alert')` when more than one can be on screen.

<!-- Verified against the current code on 2026-10-16. -->
