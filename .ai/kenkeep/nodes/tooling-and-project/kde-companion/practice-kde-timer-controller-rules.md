---
type: practice
title: 'KDE timer controller: server-derived time, one mutation, no replayed starts'
description: >-
  TokklTimer shows the server's timer state, derives elapsed from the server
  start and clock, runs one mutation at a time and never replays a write; the
  pause chain and sessions are the server's; the project is locked while
  running or paused.
tags:
  - kde
  - desktop
kk_schema_version: 3
kk_id: practice-kde-timer-controller-rules
kk_derived_from:
  - .ai/kenkeep/nodes/.redirects.json
kk_relates_to:
  - map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
  - map-kde-panel-button-menu-and-project-indicator
  - practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies
  - >-
    practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite
  - practice-kde-configure-page-cfg-instanceurl-and-the-wallet-save-timing
  - map-users-roles-and-workspace-membership
  - map-timer-state-service-settlement-revision-and-discarded-pomodoro
  - map-desktop-timer-state-client-stream-poll-settling-and-revisions
kk_depends_on: []
kk_confidence: high
---
`Tokkl::TimerController` (`desktop/core/src/timercontroller.h`, QML type `TokklTimer`) owns the widget's view of the running entry, elapsed time, project and billable choices, and start, stop, pause and resume. The entry, the pause chain and any Pomodoro session come from the shared `TimerStateClient` (see `map-desktop-timer-state-client-stream-poll-settling-and-revisions`), which QML sets as `stateClient`. The KDE panel, the macOS app and the GNOME `tokkl-timerd` service all use it. It reads time through the `Clock` interface in `desktop/core/src/clock.h`: `SystemClock` in the widget, `FakeClock` from `desktop/core/autotests/fakes.h` in the `timer` test. Keep it that way so the tests can move time.

Elapsed time is recomputed from the entry's server `start` and the client's server time (`TimerStateClient::serverNow()`) on every one-second tick, never counted up locally, so a sleep, a late tick or a skewed clock loses nothing. The controller does not poll. The state client reads the state, follows the event stream and polls every 30 s only while no stream delivers. `resumed()` is the session-wake slot that makes the client read again and replace its stream; it has nothing to do with `resume()` of a pause chain.

`elapsedText` is `formatElapsed(elapsedSeconds)`: whole minutes as truncated `H:MM` (`0:00` under a minute, `125:00` for 125 hours, never rounded up). `formatElapsed` in `desktop/gnome/extension/timer1.js` follows the same rule. A panel test that wants the label to change must advance the clock across a minute boundary (`autotests/qml/tst_panel.qml` does).

Mutation rules:

- Start POSTs `/workspaces/:wid/time_entries` with `duration: -1`, a UTC RFC 3339 `start` from the clock, `created_with: "tokkl-kde"`, an empty description, and the selected project and billable flag (`encodeStartEntry` in `desktop/core/src/apitypes.cpp`). Stop PATCHes `/workspaces/:wid/time_entries/:id/stop` with the running entry's id.
- `toggle()` pauses a running entry, resumes a paused chain and otherwise starts. It is the primary action on every panel: the KDE panel's click, keys and press action, the macOS status item's click, and the GNOME button's click, Space and Return (through the service's `Pause`, `Resume` and `Start`). Each panel's menu has its own item that calls `start()` or `stop()` and never pauses. It reads Start or Stop on KDE and GNOME, and Start Timer or Stop Timer on macOS. Stop while paused is `POST /api/app/timer/discard` against the revision shown, so it needs `canWrite` like every other action. All actions return false while a session is active.
- One mutation runs at a time; clicks while it runs are ignored. A read issued before a mutation cannot overwrite what the mutation returned.
- When the outcome is unknown (network error, timeout, 5xx, unreadable answer), the controller stays busy while the state client settles: until a read sent after the failure brings a state. A start or resume is never sent again, because the server may already have created the entry.
- A connection generation change (another instance, account or credential) drops the answers to requests sent before it. `TimerController::reset` and `PomodoroSession::onGenerationChanged` bump an epoch and clear their pending flags, so the controls work again on the new account and a late answer is ignored.
- A 409 on a timer action (pause, resume, discard) adopts the state in the reply and shows "The timer changed on another device first." until the next user action.
- Any other refusal, such as a 409 or 404 for an entry that was already stopped, triggers a read of the state. That read clears a stop's error. A refused start or resume keeps its message and the Error status through later reads (`m_keepError`) until the next `setError`, a new mutation, Stop while paused, a project or billable choice, `reconnect()` or a connection reset (`clearKeptError`).

`canWrite` requires the connection to allow writes, a clock, a state client, a state already read (`m_view`), no lost workspace and no mutation or settling in progress. Do not enable start or stop before that read, or a start could split a timer that already runs on the server. `stale` follows the connection: a transient failure marks the data shown as the last known until it is read again.

A 403 from a workspace operation can mean the account lost the workspace (`memberWorkspace` on the server answers 403 for non-members). The controller then clears the workspace data it exposes, blocks writes and polling, and asks `/me` once whether the account has another workspace. Only a new connection generation or `reconnect()` lifts the block. A start or stop in flight keeps the controller busy through the loss and any reconnect until its reply arrives and a read reconciles it. A running entry from another workspace is hidden, and starting a new entry stops it on the server, because the API stops the user's running entry in any workspace.

Pause chain. The server owns it (`pause` in the timer state, see `map-timer-state-service-settlement-revision-and-discarded-pomodoro`). `pause()` posts `/api/app/timer/pause`, which stops the running entry and keeps its description, project, task, tags and billable flag with the seconds it stored. `resume()` posts `/api/app/timer/resume` against the revision shown, and the server starts the clone. `elapsedSeconds` is the chain total, the seconds the server stored plus the clone's running time, frozen while paused. A segment paused within half a step of the time resolution rounds to zero and adds nothing (`pauseAndResume` in `desktop/kde/tests/realservertest.cpp` checks this against a real server). A refused resume leaves the chain paused. While paused, `start()`, `chooseProject()` and `chooseBillable()` are refused and the menu reports the chain's project and billable flag. The server ends the chain on a stop of the clone, on any other running entry and on a discard, from any device, and the next state shows it. The widget stores nothing of the chain, so a restart or another device sees the same total. A chain or entry in another workspace is not shown. An unknown outcome of a pause is settled by reads, never by sending the pause again. The API checks a resumed entry's task before its project (`resolveProjectAndTask`), so a chain whose project was deleted gets 404 "Project not found" only when it has no task; with a task it fails on the task. Against a real server, `desktop/kde/tests/realservertest.cpp` covers pause and resume in `pauseAndResume` and the refusal in `resumeRefusedForDeletedProject` (fixture account `a.q`, whose running entry has a project and no task).

The panel menu (`PanelMenu.qml`) drives `chooseProject()` and `chooseBillable()`, and `status` (Unconfigured, Loading, Ready, Busy) summarises the state for the panel. Project sets only the project of the next start and is locked while an entry runs or a chain is paused: the Project submenu and its items are enabled only when `canWrite && !running` (`choosable`), and `chooseProject` returns false and sends nothing while `m_entry` exists or `isPaused()`. To change the project of a running entry, stop it and start a new one. Billable sets the next start and, while an entry runs, edits that entry in place with one PUT (`updateEntry`) that carries only `billable`. The server's `updateTimeEntry` keeps whatever the request omits (description, tags, start, stop), so do not add fields the panel did not change. Choosing a project applies its billable default (false for No project) and a later billable choice overrides it. Only an active project of the workspace is a valid choice. Projects load 200 at a time (`projectPageSize`); the project of the running entry is fetched on its own when it is archived, so the menu can name it (checked, disabled) without offering it.

Next-start default. After a stop, the next start uses the stopped entry's project when it is an active project of the workspace, else No project. For a stop made from the panel the project comes from the server's stop reply; a stop seen only by polling uses the project from the last read. A stop answered before the first project list waits for the list (`m_stopDefault`). On connect, and on `reconnect()`, with nothing running the controller reads `GET /me/time_entries?meta=true` (`Connection::fetchRecentEntries`; the API lists only the last 9 days, newest first) and uses the newest entry's project when `project_active` is true; an entry from another workspace gives No project, and after a longer break there is none to use. `reconnect()` refreshes the entry and the projects whenever the connection is up. Manual picks and automatic defaults are tracked apart: `m_nextStartPicked` is set by `chooseProject` and `chooseBillable` and is cleared by the next start or stop, a manual pick wins over every automatic default until then, and Reconnect replaces only an automatic default. A billable toggle made before the connect reply arrives also cancels the default.

Panel indicator. `TokklTimer` exposes `indicatorState` and `indicatorColor` with one `indicatorChanged` signal. They follow `chosenProjectId`, which is the running entry's project while an entry runs and the next-start project while stopped. `IndicatorState` is an `enum class` with None (no project, or a 404), Pending (the lookup is running) and Project; a plain `Project` enumerator would hide the `Tokkl::Project` struct. `indicatorColor` is a `QString`, not a `QColor`, so the core needs no Qt Gui: it is lowercase `#rrggbb` in the Project state and empty otherwise, and `ProjectIndicator.qml` tests for the empty string. The input is accepted case-insensitively, the rule of `isHexColor` in `packages/common/colors.ts`. The single-project read (`resolveProject`, `Connection::fetchProject`) also resolves a stopped-state project, and runs only for a project outside the active list once that list is known. The looked-up project is revalidated after every successful projects reload (Reconnect, refresh, resume): `m_lookedUpStale` marks it, and the indicator keeps the old answer until the new read returns, so a rename or recolour shows up without a reconnect. At most one read per project id is in flight (`m_lookupsPending`). Each read records `m_projectsRevision`, and an answer that arrives after a newer list, a 200 or a 404, leaves the project stale and triggers exactly one follow-up read. A 404 is provisional too: `projects.id` is `INTEGER PRIMARY KEY` without `AUTOINCREMENT`, so a deleted top id can be reused by a new project.

`Connection::maxProjectPages` (100) caps paging, so a workspace with more than 20000 projects still loses the rest of its list. It no longer does so silently: `Connection::projectsIncomplete()` (a `Q_PROPERTY` with `NOTIFY projectsChanged`) is true when the last page read was full and still brought new projects. `TimerController::projectsIncomplete` follows it when projects load and clears with the account's data. `PanelMenu.qml` shows a disabled menu item with an accessible description before the projects, pointing to Open Tokkl. A page with nothing new ends paging without the flag, since the server then ignored the paging parameters.

<!-- kk:related:start -->
# Related

- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
- Related: [map-kde-panel-button-menu-and-project-indicator](plasma-companion/map-kde-panel-button-menu-and-project-indicator.md)
- Related: [practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies](connection-and-credentials/practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies.md)
- Related: [practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite](connection-and-credentials/practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite.md)
- Related: [practice-kde-configure-page-cfg-instanceurl-and-the-wallet-save-timing](connection-and-credentials/practice-kde-configure-page-cfg-instanceurl-and-the-wallet-save-timing.md)
- Related: [map-users-roles-and-workspace-membership](../../api-and-data/users-and-admin/map-users-roles-and-workspace-membership.md)
- Related: [map-timer-state-service-settlement-revision-and-discarded-pomodoro](../../api-and-data/timer-state/map-timer-state-service-settlement-revision-and-discarded-pomodoro.md)
- Related: [map-desktop-timer-state-client-stream-poll-settling-and-revisions](plasma-companion/map-desktop-timer-state-client-stream-poll-settling-and-revisions.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [.ai/kenkeep/nodes/.redirects.json](../../.redirects.json)
<!-- kk:citations:end -->
