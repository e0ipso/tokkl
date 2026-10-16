---
type: practice
title: 'KDE timer controller: server-derived time, one mutation, no replayed starts'
description: >-
  TokklTimer derives elapsed from the server start, polls 30 s, runs one
  mutation at a time, never replays a start, gates writes on a known entry.
tags:
  - kde
  - desktop
kk_schema_version: 3
kk_id: practice-kde-timer-controller-rules
kk_derived_from: []
kk_relates_to:
  - map-kde-plasma-companion-desktop-kde
  - practice-kde-companion-connection-and-configure-page-rules
  - map-users-roles-and-workspace-membership
kk_depends_on: []
kk_confidence: high
---
`Tokkl::TimerController` (`desktop/kde/src/timercontroller.h`, QML type `TokklTimer`) owns the widget's running entry, elapsed time, project and billable choices, and start and stop. It reads time through the `Clock` interface in `src/clock.h`: `SystemClock` in the widget, `FakeClock` from `autotests/fakes.h` in the `timer` test. Keep it that way so the tests can move time.

Elapsed time is recomputed from the entry's server `start` on every one-second tick, never counted up locally, so a sleep or a late tick loses nothing. The current entry is polled every 30 seconds (`pollIntervalMs`) and read again after every start or stop, after a resume (a tick more than 10 seconds late, `resumeGapMs`, or a call to `resumed()`), and when the connection becomes Connected again.

Mutation rules:

- Start POSTs `/workspaces/:wid/time_entries` with `duration: -1`, a UTC RFC 3339 `start` from the clock, `created_with: "tokkl-kde"`, an empty description, and the selected project and billable flag (`encodeStartEntry` in `src/apitypes.cpp`). Stop PATCHes `/workspaces/:wid/time_entries/:id/stop` with the running entry's id.
- One mutation runs at a time; clicks while it runs are ignored. A read issued before a mutation cannot overwrite what the mutation returned.
- When the outcome is unknown (network error, timeout, 5xx, unreadable answer), the controller stays busy until a read reconciles the state. A start is never sent again: the server may already have created the entry.
- Any other refusal, such as a 409 or 404 for an entry that was already stopped, triggers a read of the current entry.

`canWrite` requires the connection to allow writes, a clock, no lost workspace, no mutation or reconciliation in progress, and `m_entryKnown`, which only an accepted current-entry read sets. Do not enable start or stop before that read. `m_entryStale` is separate from the connection's state: a transient current-entry failure marks the timer stale until a current-entry read succeeds, even if other requests bring the connection back first.

A 403 from a workspace operation can mean the account lost the workspace (`memberWorkspace` on the server answers 403 for non-members). The controller then clears the workspace data it exposes, blocks writes and polling, and asks `/me` once whether the account has another workspace. Only a new connection generation or `reconnect()` lifts the block. A start or stop in flight keeps the controller busy through the loss and any reconnect until its reply arrives and a read reconciles it. A running entry from another workspace is hidden, and starting a new entry stops it on the server, because the API stops the user's running entry in any workspace.

<!-- kk:related:start -->
# Related

- Related: [map-kde-plasma-companion-desktop-kde](map-kde-plasma-companion-desktop-kde.md)
- Related: [practice-kde-companion-connection-and-configure-page-rules](practice-kde-companion-connection-and-configure-page-rules.md)
- Related: [map-users-roles-and-workspace-membership](../api-and-data/map-users-roles-and-workspace-membership.md)
<!-- kk:related:end -->
