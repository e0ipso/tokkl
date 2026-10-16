---
type: practice
title: 'KDE timer controller: server-derived time, one mutation, no replayed starts'
description: >-
  TokklTimer derives elapsed from the server start, polls 30 s, runs one
  mutation at a time, never replays a start, gates writes on a known entry;
  the project is locked while running, billable edits it with a partial PUT.
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

The panel menu (`PanelMenu.qml`) drives `chooseProject()` and `chooseBillable()`, and `status` (Unconfigured, Loading, Ready, Busy) summarises the state for the panel. Project sets only the project of the next start and is locked while an entry runs: the Project submenu and its items are enabled only when `canWrite && !running` (`choosable`), and `chooseProject` returns false and sends nothing while `m_entry` exists. To change the project of a running entry, stop it and start a new one. Billable sets the next start and, while an entry runs, edits that entry in place with one PUT (`updateEntry`) that carries only `billable`. The server's `updateTimeEntry` keeps whatever the request omits (description, tags, start, stop), so do not add fields the panel did not change. Choosing a project applies its billable default (false for No project) and a later billable choice overrides it. Only an active project of the workspace is a valid choice. Projects load 200 at a time (`projectPageSize`); the project of the running entry is fetched on its own when it is archived, so the menu can name it (checked, disabled) without offering it.

Next-start default. After a stop, the next start uses the stopped entry's project when it is an active project of the workspace, else No project. For a stop made from the panel the project comes from the server's stop reply; a stop seen only by polling uses the project from the last read. A stop answered before the first project list waits for the list (`m_stopDefault`). On connect, and on `reconnect()`, with nothing running the controller reads `GET /me/time_entries?meta=true` (`Connection::fetchRecentEntries`; the API lists only the last 9 days, newest first) and uses the newest entry's project when `project_active` is true; an entry from another workspace gives No project, and after a longer break there is none to use. `reconnect()` refreshes the entry and the projects whenever the connection is up. Manual picks and automatic defaults are tracked apart: `m_nextStartPicked` is set by `chooseProject` and `chooseBillable` and is cleared by the next start or stop, a manual pick wins over every automatic default until then, and Reconnect replaces only an automatic default. A billable toggle made before the connect reply arrives also cancels the default.

Panel indicator. `TokklTimer` exposes `indicatorState` and `indicatorColor` with one `indicatorChanged` signal. They follow `chosenProjectId`, which is the running entry's project while an entry runs and the next-start project while stopped. `IndicatorState` is an `enum class` with None (no project, or a 404), Pending (the lookup is running) and Project; a plain `Project` enumerator would hide the `Tokkl::Project` struct. `indicatorColor` is a `QString`, not a `QColor`, so the core needs no Qt Gui: it is lowercase `#rrggbb` in the Project state and empty otherwise, and `ProjectIndicator.qml` tests for the empty string. The input is accepted case-insensitively, the rule of `isHexColor` in `packages/common/colors.ts`. The single-project read (`resolveProject`, `Connection::fetchProject`) also resolves a stopped-state project, and runs only for a project outside the active list once that list is known. The looked-up project is revalidated after every successful projects reload (Reconnect, refresh, resume): `m_lookedUpStale` marks it, and the indicator keeps the old answer until the new read returns, so a rename or recolour shows up without a reconnect. At most one read per project id is in flight (`m_lookupsPending`). Each read records `m_projectsRevision`, and an answer that arrives after a newer list, a 200 or a 404, leaves the project stale and triggers exactly one follow-up read. A 404 is provisional too: `projects.id` is `INTEGER PRIMARY KEY` without `AUTOINCREMENT`, so a deleted top id can be reused by a new project. `tokklcore` links `Qt6::Gui` for `QColor`, and the RPM spec needs `cmake(Qt6Gui)`.

`Connection::maxProjectPages` (100) caps paging, so a workspace with more than 20000 projects still loses the rest of its list. It no longer does so silently: `Connection::projectsIncomplete()` (a `Q_PROPERTY` with `NOTIFY projectsChanged`) is true when the last page read was full and still brought new projects. `TimerController::projectsIncomplete` follows it when projects load and clears with the account's data. `PanelMenu.qml` shows a disabled menu item with an accessible description before the projects, pointing to Open Tokkl. A page with nothing new ends paging without the flag, since the server then ignored the paging parameters.

<!-- kk:related:start -->
# Related

- Related: [map-kde-plasma-companion-desktop-kde](map-kde-plasma-companion-desktop-kde.md)
- Related: [practice-kde-companion-connection-and-configure-page-rules](practice-kde-companion-connection-and-configure-page-rules.md)
- Related: [map-users-roles-and-workspace-membership](../api-and-data/map-users-roles-and-workspace-membership.md)
<!-- kk:related:end -->
