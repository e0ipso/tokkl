# kenkeep Index: tooling-and-project / gnome-timer-service / timer1-d-bus-contract

↑ Parent: [gnome-timer-service](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**org.tokkl.Timer1 interface file, members and InterfaceVersion**](map-org-tokkl-timer1-interface-file-members-and-interfaceversion.md) to learn about: org.tokkl.Timer1.xml is the one contract source; members are additive only; InterfaceVersion and the extension support floor. #gnome #dbus
- Open [**tokkl-timerd daemon composition root and secret storage**](map-tokkl-timerd-daemon-composition-root-and-secret-storage.md) to learn about: tokkl-timerd runs tokklcore headless on the session bus; main.cpp builds the parts TimerService gets; secrets live in QtKeychain. #desktop #gnome #dbus
- Open [**Timer1 Actions, Presentation, Status and AlarmError properties**](map-timer1-actions-presentation-status-and-alarmerror-properties.md) to learn about: Timer1 menu and status properties: core MenuActionStates, StatusPresentation, status keys, shared English words, alarm failures. #gnome #dbus #desktop
- Open [**Timer1 timer, project and Pomodoro limit properties**](map-timer1-timer-project-and-pomodoro-limit-properties.md) to learn about: Timer1 StartTime, LocalStartTime, ChainSeconds, Running, Paused, CanStartSession, project properties and PomodoroLengthLimits. #gnome #dbus #desktop
- Open [**Timer1 methods: requests, RefreshProjects, Configure and Activate**](map-timer1-methods-requests-refreshprojects-configure-and-activate.md) to learn about: Timer1 Request* methods and RequestFinished, deprecated members, RefreshProjects on menu open, Configure errors, Activate results. #gnome #dbus
- Open [**Timer1 PropertiesChanged publication from TimerService**](map-timer1-propertieschanged-publication-from-timerservice.md) to learn about: TimerService sends one diffed PropertiesChanged per event-loop turn after watched core signals; how to add a property. #gnome #dbus

## By topic

### #dbus
- Open [**Timer1 Actions, Presentation, Status and AlarmError properties**](map-timer1-actions-presentation-status-and-alarmerror-properties.md) — Timer1 menu and status properties: core MenuActionStates, StatusPresentation, status keys, shared English words, alarm failures.
- Open [**org.tokkl.Timer1 interface file, members and InterfaceVersion**](map-org-tokkl-timer1-interface-file-members-and-interfaceversion.md) — org.tokkl.Timer1.xml is the one contract source; members are additive only; InterfaceVersion and the extension support floor.
- Open [**tokkl-timerd daemon composition root and secret storage**](map-tokkl-timerd-daemon-composition-root-and-secret-storage.md) — tokkl-timerd runs tokklcore headless on the session bus; main.cpp builds the parts TimerService gets; secrets live in QtKeychain.
### #gnome
- Open [**tokkl-timerd daemon composition root and secret storage**](map-tokkl-timerd-daemon-composition-root-and-secret-storage.md) — tokkl-timerd runs tokklcore headless on the session bus; main.cpp builds the parts TimerService gets; secrets live in QtKeychain.
- Open [**Timer1 Actions, Presentation, Status and AlarmError properties**](map-timer1-actions-presentation-status-and-alarmerror-properties.md) — Timer1 menu and status properties: core MenuActionStates, StatusPresentation, status keys, shared English words, alarm failures.
- Open [**Timer1 timer, project and Pomodoro limit properties**](map-timer1-timer-project-and-pomodoro-limit-properties.md) — Timer1 StartTime, LocalStartTime, ChainSeconds, Running, Paused, CanStartSession, project properties and PomodoroLengthLimits.
### #desktop
- Open [**KDE panel: button, menu and project indicator**](../../kde-companion/plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../../kde-companion/practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**tokklkde static library, KWallet store and tokkl-kde client name**](../../kde-companion/plasma-companion/desktop-cmake-projects/map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md) — tokklkde links tokklcore plus KWallet and Plasma; KdeTimerState, AppletPomodoroStore; callers inject the store and client name.