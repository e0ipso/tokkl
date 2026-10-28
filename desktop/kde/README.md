# Tokkl KDE companion

A Plasma 6 panel widget for Tokkl. It shows the running timer in the panel,
starts, pauses and resumes it with a click, stops it from its menu, and sets
the project and billable flag. It is a client of the Toggl-compatible API of
one Tokkl instance and keeps nothing locally except its settings and the
Pomodoro mode; the timer, its pause chain and the Pomodoro session are the
server's, so they show the same on every device. The API token or password is
in KDE Wallet.

It has two parts:

- `package/`: the widget, a QML package with plugin id `com.github.e0ipso.tokkl`.
  Its entry point is `contents/ui/main.qml`; the panel item and its menu are
  `PanelButton.qml` (with its project indicator, `ProjectIndicator.qml`) and
  `PanelMenu.qml`.
- `src/`: the backend, a Qt/C++ QML module imported as `com.github.e0ipso.tokkl.backend`.
  The KDE Wallet store and the connection types the widget creates from QML,
  which pass that store in, are in the `tokklkde` static library.

The API client, the credential store interface, connection state and timer
controller are the `tokklcore` static library in `desktop/core`, a separate
CMake project that needs only Qt Core and Network (and Qt Test for its
tests). This project adds it with `add_subdirectory`, so the module and the
tests link it and its tests run in this project's CTest. `TOKKL_CORE_DIR`
names its source directory; the default is `../core`.

This is a standalone CMake project. The npm workspaces, `npm run build` and the
server image do not build or ship it.

Contents: [Install, upgrade and remove](#install-upgrade-and-remove),
[Add the widget to a panel](#add-the-widget-to-a-panel),
[Connection settings](#connection-settings),
[Accounts and privacy](#accounts-and-privacy), [Panel](#panel),
[Timer](#timer), [Packages](#packages), [Build and test](#configure-build-and-test),
[CI and releases](#ci-and-releases) and the
[Plasma smoke checklist](#real-plasma-smoke-checklist).

## Install, upgrade and remove

The companion has a separate package for each supported system:

| System                      | Architecture | Package                                 |
| --------------------------- | ------------ | --------------------------------------- |
| Debian 13                   | amd64        | `tokkl-kde_<version>_amd64.deb`         |
| Kubuntu 26.04               | amd64        | `tokkl-kde_<version>_amd64-ubuntu26.04.deb` |
| Fedora KDE 44, with updates | x86_64       | `tokkl-kde-<version>-1.fc44.x86_64.rpm` |

The source needs Plasma 6.3 or newer, KDE Frameworks 6.13 and Qt 6.8; the exact
bounds are under [Requirements](#requirements) and [Packages](#packages).
Other distributions receive no dedicated CI target. Compatibility depends on
their installed libraries, as described under [Packages](#packages). The manual
checks cover a Plasma Wayland session; X11 sessions are not checked.

A Tokkl release at <https://github.com/e0ipso/tokkl/releases> that includes
the companion has its packages attached. To build them yourself, follow
[Build and check](#build-and-check).

In the directory with the downloaded file:

```sh
# Debian 13
sudo apt install ./tokkl-kde_<version>_amd64.deb      # install or upgrade
sudo apt remove tokkl-kde                             # remove

# Kubuntu 26.04
sudo apt install ./tokkl-kde_<version>_amd64-ubuntu26.04.deb

# Fedora KDE 44
sudo dnf install ./tokkl-kde-<version>-1.fc44.x86_64.rpm   # install
sudo dnf upgrade ./tokkl-kde-<version>-1.fc44.x86_64.rpm   # upgrade
sudo dnf remove tokkl-kde                             # remove
```

`<version>` is the Tokkl version; a pre-release such as `1.2.0-rc.1` appears
as `1.2.0~rc1` in the file name. `apt` and `dnf` install the QML modules the
widget needs (see [Packages](#packages)). `apt purge tokkl-kde` also works. The
package has no maintainer scripts, so remove and purge leave each user's
widget settings and KDE Wallet entries in place; a later install finds them
again. Delete the `Tokkl` folder in KDE Wallet by hand to drop the saved
secrets.

The packages are under the MIT license (`License: MIT` in both). The DEB has
the text in `/usr/share/doc/tokkl-kde/copyright`, the RPM in
`/usr/share/licenses/tokkl-kde/LICENSE`.

The Tokkl server needs no change. The Docker image does not contain the
companion, which uses only the instance's public API.

## Add the widget to a panel

1. Install the package. If the widget does not appear in the next step, log
   out and back in so Plasma rescans its widgets.
2. Right-click the panel, open its edit mode, choose Add Widgets, search for
   Tokkl (category Utilities) and add it.
3. Right-click the new widget, choose Configure and fill in the Connection
   page as described next. Until you do, the panel shows the Not configured
   symbol.

Menu names can differ between Plasma versions; the
[smoke checklist](#real-plasma-smoke-checklist) confirms them on each target
before a release.

## Requirements

| Dependency                                                        | Minimum |
| ----------------------------------------------------------------- | ------- |
| CMake                                                             | 3.27    |
| Qt 6: Core, Multimedia, Network, Qml, Quick (DBus, Test, QuickTest for tests) | 6.8     |
| Extra CMake Modules; KF6 Wallet, Package, Config                  | 6.13    |
| KF6 I18n with I18nQml, KF6 KirigamiPlatform (tests only)          | 6.13    |
| QML modules: Kirigami, KCMUtils                                   | 6.13    |
| Plasma: libplasma, PlasmaQuick                                    | 6.3     |

The minimums are what Debian 13 shipped with (Qt 6.8.2, KDE Frameworks
6.13.0, Plasma 6.3.5). Fedora KDE 44 is newer (released with Qt 6.10.2, KDE
Frameworks 6.25.0 and libplasma 6.6.4; see [Packages](#packages) for the
versions its updates bring). Older Plasma 6 releases are not supported.

Packages on Debian 13: `cmake extra-cmake-modules qt6-base-dev
qt6-declarative-dev qt6-multimedia-dev libplasma-dev libkf6wallet-dev
libkf6config-dev libkf6i18n-dev qml6-module-org-kde-kirigami
qml6-module-org-kde-kcmutils`, and
for the tests `libkirigami-dev`, `qml6-module-qttest`,
`plasma-desktoptheme` (Plasma's QML components) and `dbus-daemon`.
The CI images in `ci/` hold the complete lists for all targets (see
[CI and releases](#ci-and-releases)).

## Configure, build and test

Run from the repository root. The examples build in `desktop/kde/build`, which
git ignores; any other directory works too.

```sh
cmake -S desktop/kde -B desktop/kde/build -DCMAKE_INSTALL_PREFIX=/usr
cmake --build desktop/kde/build -j"$(nproc)"
ctest --test-dir desktop/kde/build --output-on-failure
```

CTest runs these checks. `api`, `connection`, `timer` and `networktransport`
come from `desktop/core`.

- `api`: instance URL parsing, Basic credentials and decoding of the API's
  bare JSON objects, arrays, `null` and error strings.
- `connection`: the connection state machine and the Configure page helper,
  against a scripted transport and credential store. It never opens KDE
  Wallet or the network.
- `timer`: the timer controller (`TokklTimer`) against a fake clock, transport
  and credential store: ticking, sleep gaps, polling, start and stop requests,
  repeated clicks, conflicts, late replies, failures and account switches.
- `kdetimerstate`: the timer state client the widget creates from QML
  (`TokklTimerState`): built once the connection is set, reading through that
  connection, replaced when the connection changes.
- `kdepomodoro`: the Pomodoro wiring (`TokklPomodoro`): the session acts
  through the state client the timer reads, and is built again when the timer
  gets another client.
- `appletpomodorostore`: the Pomodoro mode in the configuration of an applet
  that a test corona hosts, and that records an earlier version kept there are
  neither read nor removed.
- `panel`: the panel item, its project indicator and its menu
  (`PanelButton.qml`, `ProjectIndicator.qml`, `PanelMenu.qml`) in QtQuickTest, from the QML tests in `autotests/qml/`, offscreen. The
  backend types come from `tokklcore` wired to the fake clock, transport and
  credential store; the test never loads `main.qml`, the real connection or a
  copy of the backend plugin. It covers clicks and keys, pause, resume and
  Stop from the menu, the menu and its focus, billable defaults, edits of a running entry, paging, archived
  projects, every state, disabled controls and account switches, and a session
  started on another device in Timer mode: its menu items, its clicks, its
  messages and its end.
- `networktransport`: the real HTTP transport against an in-process server on
  127.0.0.1: headers, no cookies, redirects not followed, timeouts.
- `kdeconnection`: the connection and Configure page types the widget creates
  (`TokklConnection`, `TokklConnectionSetup`) with the real KDE Wallet client
  and transport. A fake kwalletd answers on a private `dbus-daemon` the test
  starts, and an in-process server on 127.0.0.1 plays Tokkl, so neither your
  wallet nor your session bus is touched. It checks the KDE Wallet message for
  each wallet status, that both types share one wallet store, that each owns
  its transport, and the `tokkl-kde` client name in `created_with` and the
  User-Agent.
- `kdewallet-disabled`: the same types with KDE Wallet turned off in a
  temporary `kwalletrc`. KDE Wallet reads that setting once per process, so
  this is a test of its own.
- `version`: version resolution and metadata stamping.
- `native-version`: the versions `scripts/native-version.sh` accepts, what it
  maps them to and the ones it refuses. dpkg and rpm then check that the
  mapped versions sort in SemVer order; either tool is skipped, with a
  message, when it is not installed.
- `prune-package`: a source file removed from `package/contents/` leaves the
  assembled package and the staged install after a rebuild in the same build
  directory.
- `stage-install`, `smokeload`, `stage-cleanup`: install into
  `<build>/autotests/stage` with `DESTDIR`, then load the widget, its
  configuration schema and Configure page, and the backend from there in an
  offscreen Plasma session. `smokeload` also checks that the widget picker
  icon is installed at 32, 48, 64, 96, 128 and 256 px, that the icon theme
  finds all six, and that the 96 px file is a copy of
  `contents/images/tokkl.png`. The test uses its own XDG directories, so widgets
  installed in your home directory do not interfere.
- `appstreamtest`: added by Extra CMake Modules when `appstreamcli` is installed.

## Connection settings

Right-click the widget and choose Configure, then Connection:

- **Instance URL**: blank at first. Enter the address of the Tokkl server with
  `http://` or `https://`. A path prefix is kept, so
  `https://example.com/tokkl` reaches the API at
  `https://example.com/tokkl/api/v9/`. Addresses with a user name, password,
  query or fragment are refused and never saved; Apply with an unusable
  address saves an empty one. A valid address is saved normalized, for example
  without a trailing slash or default port. Plain `http://` to another machine shows a
  warning, because the secret would travel unencrypted.
- **Sign in with**: an API token (the default; find it under Settings → API
  token in Tokkl) or an email and password. Both use HTTP Basic auth, as
  `<token>:api_token` or `<email>:<password>`.
- **Test Connection** calls `GET /api/v9/me` with the values on screen, before
  they are saved, and reports "Connected as <name>, workspace <id>". It needs
  an address and a secret on screen.

Token sign-in is the default. Rotating the token under Settings → API token in
Tokkl makes the saved one fail, and the widget shows Sign-in refused until you
save the new token. Changing the account's password, or setting a new one
through an admin's reset link, replaces the token too, so a saved token fails
the same way. Sign in to Tokkl with the new password, copy the new token from
Settings → API token and save it here. With email sign-in, save the new
password instead.

The page loads the saved token or password of the address, sign-in method and
email on screen. Changing any of them clears a loaded or saved secret, so it
is never tested against or saved for another account. A secret you typed stays
and Apply saves it for the account on screen.

The address, sign-in method and email are ordinary widget settings, in the
Plasma applet configuration. The token or password is saved only in KDE Wallet,
in the network wallet under the folder `Tokkl`, one entry per instance (and
email, for password sign-in). If the wallet is disabled, locked or denies
access, the page and the widget say so and nothing is saved elsewhere. When
the wallet refuses to save the secret, the widget shows a wallet error saying
the new credentials were not saved. After Apply, the page also keeps the
secret, shows the error and enables Apply again, so closing the dialog asks
whether to apply or discard. OK closes the dialog before KDE Wallet answers,
and Plasma gives the page no way to keep it open, so after OK the secret is
gone and you enter it again. Reconnect from the context menu clears the
widget's error and uses whatever the wallet still holds.

The widget validates the account with `GET /api/v9/me` and uses its
`default_workspace_id` for every request. Changing the address, sign-in method,
email or secret clears the account data and ignores answers to requests made
before the change. When `/me` or `/me/time_entries/current` answers 403 the widget clears the
account and stops retrying until you choose Reconnect from its context menu or
change the settings; the saved secret stays in the wallet so you can correct it. A 429
answer pauses requests for the `Retry-After` time (60 seconds when the server
sends none). Connection failures, timeouts and 5xx answers keep the last account
data, marked stale. Redirects are not followed, so the credentials never go to
another address; enter the final address instead.

## Accounts and privacy

Every Tokkl account has its own private workspace, and the widget works inside
the one account it is configured for:

- It sends that account's credentials only, to the one address you entered,
  and reads and writes the account's `default_workspace_id` workspace only.
  The server answers 403 for any other workspace, including to admins, who
  manage accounts but cannot read anyone else's entries.
- It never reads other accounts' projects or entries. The real-server test
  checks this against two instances whose ids collide by construction (see
  [Real-server test](#real-server-test)).
- The tooltip, menu and Open Tokkl address hold no token or password. The
  token or password is only in KDE Wallet.

To switch to another account or instance, open Configure, change the address,
sign-in method, email or secret, and Apply. The widget then:

- drops the previous account's entry, projects, project and billable choices
  and errors at once, and closes an open menu;
- ignores any reply still on its way for the previous account, even when the
  new account uses the same numeric ids, and does not send a start or stop
  again;
- starts reading the new account from nothing: the first current-entry read
  must succeed before Start works.

The wallet keeps one secret per instance and email, so switching back loads
the one saved before. If the server disables the account (Sign-in refused) or
removes its access to the workspace (Error), the widget clears the account's
data and stops until you choose Reconnect or change the settings.

## Panel

In Configure, Use a monochrome panel icon changes the clock logo to the panel's text colour automatically. Apply keeps the preference. Full colour is the default, and the project and state indicators keep their colours in either mode.

The panel shows the Tokkl clock logo, the project indicator, the elapsed time
and, unless everything is ready, a symbol for the state. Each state also has
its own words in the tooltip, the menu and the accessible description, so none
relies on color: Not configured, Loading, Connected, Saving, Offline (the last
known state), Sign-in refused and Error.

The project indicator shows the running or paused entry's project, or the
next start's while stopped. A dot pulses while an entry runs, a still dot
shows while paused and a still square while stopped. The project's colour fills it inside a thin ring in the theme's text
colour, which keeps well over 3:1 against the panel in Breeze Light and Breeze
Dark whatever the project colour. A project whose colour is not `#rrggbb` is
filled with the text colour. No project draws a dashed outline of the dot or
the square, and while the project is still being read the slot stays empty.
The slot has the same width in every state. Only the dot's fill pulses; the
ring and the dashed outline stay solid. The pulse stops while the panel is
hidden, and with Plasma's Animation speed set to Instant. The tooltip and the
accessible description name the project, or say No project, so the colour is
never the only sign.

| State           | Symbol             | Meaning                                                                                                                                                                  |
| --------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Not configured  | configure          | No address or no saved secret. Open Configure.                                                                                                                           |
| Loading         | network-connect    | Reading the secret, validating the account or making the first timer state read.                                                                                         |
| Connected       | none               | Ready. Start, pause, resume, stop, Project and Billable work.                                                                                                            |
| Saving          | view-refresh       | A start, pause, resume, stop or edit is on its way, or its outcome is not known yet. Clicks are ignored.                                                                 |
| Offline         | network-disconnect | The instance cannot be reached after a successful connection. The last entry stays, marked stale, and reads are retried.                                                 |
| Sign-in refused | dialog-password    | The instance answered 403 to the credentials: a wrong or rotated token, a wrong password or a disabled account. Nothing is retried until Reconnect or a settings change. |
| Error           | dialog-error       | The wallet, the settings, a rate limit, a lost workspace, or a connection that never succeeded. The menu and tooltip give the text.                                      |

- Left click, Space or Return pauses a running timer, resumes a paused one and
  starts a stopped one, and Stop is in the menu. While a session is active,
  in either mode, they act on the session instead (see [Pomodoro
  mode](#pomodoro-mode)). The accessible name says
  what a press does: "Pause the Tokkl timer", "Resume the Tokkl timer" or
  "Start the Tokkl timer". Tab focuses the item and a frame shows the focus.
- Right click, the Menu key or Shift+F10 opens the menu. It is a separate
  window, so the panel does not clip it. It shows the state, then Start or
  Stop, Project, Billable, Reconnect, Open Tokkl and Configure Tokkl. The
  arrow keys move, Right opens Project, Return or Space chooses and Escape
  closes.
- The menu's Stop, shown while running or paused, ends the timer and its
  pause chain, so the next start counts from `0:00`. While stopped the item
  reads Start, and a session hides it. Stop while paused asks the server to
  discard the chain (`POST /api/app/timer/discard`), so it needs a
  connection and the chain goes when the server answers.
- A timer action that another device beat to it shows "The timer changed on
  another device first." in the tooltip and the accessible description, and the
  panel shows the state the server answered with.
- While paused, the menu's state line and the tooltip say Paused with the
  chain total, and Project and Billable are disabled: a resume copies the
  paused entry's project and billable flag.
- Project lists No project and the active projects of the workspace, up to
  100 pages of 200; a longer list is cut short, with a note in the menu that
  points to Open Tokkl. The running or paused entry's archived project is
  shown, checked and disabled, but is never offered for new work. Project is
  disabled while an entry runs or is paused: its project stays fixed, and
  changing it means stopping and starting a new entry. The menu title names the current
  project.
- Choosing a project applies its billable default, or nonbillable for No
  project; changing Billable afterwards overrides it. The choices apply to
  the next start and belong to the validated instance and account: any change
  of instance, account or secret resets them to No project and nonbillable
  and closes the menu.
- The next start defaults to the last entry's project, with its billable
  default. After a stop from the panel, that is the project in the server's
  stop reply, so a project changed on the web since the last read wins. After
  a stop seen by polling, it is the project of the entry as last read. A stop
  that happens before the project list has arrived waits for the list and
  then checks the project against it. When the timer connects, or you choose
  Reconnect, with nothing running, it reads
  `GET /api/v9/me/time_entries?meta=true` and takes the newest entry's
  project. Only an active project of the workspace counts; an archived or
  deleted project, or none, gives No project. The API lists only the last 9
  days, so after a longer break the default is No project. A choice made
  while stopped (a project or Billable) wins until the next start, and
  Reconnect replaces only an automatic default, never a choice you made. A
  choice made before a stop does not carry over it.
- While an entry runs, Billable also changes that entry in place with
  `PUT /api/v9/workspaces/{wid}/time_entries/{id}`, sending only `billable`.
  The description, tags, start and the rest stay as they are, and the entry
  is not split.
- Project and Billable are disabled whenever the timer cannot write: not
  configured, loading, busy, offline before the entry is known, refused
  credentials, a lost workspace or a cooldown.
- Open Tokkl opens the configured address (`webUrl`) in the browser. It has
  no user name, password, query or fragment, and no token is added.

The menu's popup window placement on a real Plasma Wayland panel is checked by
hand; the tests run offscreen.

## Timer

`TokklTimer` (`desktop/core/src/timercontroller.h`) drives the timer for the widget. QML
sets its `stateClient` to the `client` of a `TokklTimerState`, which the widget
builds on its `TokklConnection`. The timer and the Pomodoro session share that
one client, which reads `GET /api/app/timer`, follows the event stream of
`GET /api/app/timer/events` and keeps the newest state; the running entry, the
pause chain and the session all come from it.

- The elapsed time (`elapsedText`, `H:MM` in whole minutes) is recomputed
  every second from the entry's server start time, so time spent asleep is
  not lost.
- The timer state arrives through the event stream. While no stream delivers
  it is read every 30 seconds; it is also read after every start or stop,
  after a resume (a clock tick more than 10 seconds late) and when the
  connection comes back. Projects are read on connect, resume and reconnection,
  200 a page with `page` and `per_page` until a page comes back short. When the
  chosen project (the running entry's, or the next start's while stopped) is
  not among the active ones it is read on its own
  (`GET /api/v9/workspaces/{wid}/projects/{id}`) so the menu can name it.
- `indicatorState` says what the panel can show for that project: `None`
  without a project or when the read answered 404, `Pending` while its
  details are still unknown, and `Project` once they are, archived projects
  included. `indicatorColor` is the project's colour as lowercase `#rrggbb`
  in the `Project` state when it has that form, and an empty string otherwise. `indicatorChanged`
  fires whenever either changes. The panel's project indicator draws it.
- Start sends `POST /api/v9/workspaces/{wid}/time_entries` with
  `duration: -1`, the current UTC time as `start`, `created_with: "tokkl-kde"`,
  an empty description and the selected project and billable choice. Stop
  sends `PATCH /api/v9/workspaces/{wid}/time_entries/{id}/stop` for the
  running entry.
- Pause (`POST /api/app/timer/pause`) asks the server to stop the running
  entry and keep a chain: the entry's description, project, task, tags and
  billable flag, and the seconds it stored. Resume (`POST
  /api/app/timer/resume`) starts a clone of that entry on the server, against
  the revision shown. The elapsed time is then the chain total, the seconds the
  server stored for the paused entries plus the clone's running time, and it
  stays frozen while paused. The server ends the chain on Stop, when another
  client stops the clone or starts another entry, and the next state shows it.
  A change of instance, account or secret drops it from the panel. The widget
  stores nothing of it.
- Start and stop stay disabled until a read of the timer state for the
  account and workspace has succeeded, so a start never splits a timer that
  is already running on the server. A failed first read keeps them disabled.
- One start, pause, resume or stop runs at a time and clicks meanwhile are
  ignored. A read sent before one cannot overwrite its result. When one gets
  no clear answer (no response, timeout, 5xx or an unreadable body)
  the timer stays busy until a read shows what the server did; it never sends
  the request again. A 409 on a timer action adopts the state the server sent
  and shows "The timer changed on another device first."; a 409 or 404 on stop
  just reads the entry again.
- Connection failures keep the last entry, marked stale. After a failed read
  of the entry the mark stays until the entry is read again, even if other
  requests succeed first. Refused credentials clear it. During a 429 cooldown nothing is sent.
- A 403 from a workspace request clears the entry, projects and choices,
  blocks writes and polling, and asks `GET /api/v9/me` once. If `/me` names
  another default workspace the widget switches to it; otherwise Reconnect
  lifts the block. The request that got the 403 is not sent again. A start or
  stop still waiting for its answer keeps the timer busy through the block and
  a reconnect, until it answers and a fresh read of the state arrives.
- A running entry from a workspace other than the discovered one is not shown.
- Changing the instance, account or secret clears the entry, projects and
  choices at once and ignores late answers, even if the new account uses the
  same ids.

## Pomodoro mode

The menu has a checkable Pomodoro mode item that switches the widget between Timer mode and Pomodoro mode. The widget remembers the choice on this device. While a timer runs or is paused, or a session is active, the item reads "Pomodoro mode (locked while running)" and is disabled. Stop the timer or end the session to change it.

The session belongs to the server (`POST /api/app/pomodoro`, `/next` and `/end`), so a session started, advanced or ended on any device shows here, in either mode. The widget keeps only the mode and the alarm. Start session sends the chosen project and billable flag; the server takes the account's lengths and times the phases on its own clock. Next phase and End session send the revision of the state shown, so a confirm that another device beat to it is refused and the panel shows the state that refused it.

A left click on the panel depends on the session and the mode:

- While a session is active, in either mode: while a phase rings after its planned end it confirms Next phase, and mid-phase it opens the menu.
- In Timer mode, and while a timer runs or is paused, it acts on the timer as described under [Timer](#timer).
- In Pomodoro mode with no session, it starts one.

Whenever a session is active the panel shows the phase, the countdown and "Pomodoro N of M", and the menu shows Next phase: followed by the phase it starts (Work, Short rest or Long rest), and End session. The timer's Start and Stop are hidden then, because the session owns its pomodoro, and Project and Billable are disabled. In Pomodoro mode with no session the menu drops Start and shows Start session, which waits until a timer state has been read and while an action waits for its answer. The server saves the pomodoro. A pomodoro too short to save is dropped, and the menu shows "This pomodoro was too short to save." until the next action. When an action cannot reach the instance, the menu, the tooltip and the accessible description show why, and no session action is sent again until a later read of the state settles the outcome. A timer started on another device ends the session on the server, and the panel follows. Records of the session that earlier versions kept in the widget's configuration are not read; they stay in the file.

Whenever Pomodoro mode is on, an hourglass follows the logo, in full colour or, with Use a monochrome panel icon on, in the panel's text colour. During a session the time counts down as `M:SS` to the phase's planned end, then up as `+M:SS` in overtime. The tooltip and the accessible description name the phase, the time left and the pomodoro, for example "Short rest · 4:10 left · Pomodoro 2 of 4". The widget posts no notification.

The Pomodoro page of Configure holds the account's four lengths: Work, Short rest and Long rest in minutes, and Long rest every so many pomodoros. They are the account's preferences, shared with the web app and Android. A session takes them when it starts. Changing them needs a connection to the Tokkl server; without one the page shows the cached values and they cannot be edited. Below them, each of the four transitions has the sound it plays, chosen from the four bundled sounds (see [docs/sounds](../../docs/sounds/README.md)), with a Preview button. The widget keeps the sound choices on this device.

When a phase reaches its planned end, the chosen sound plays over and over until you confirm Next phase or end the session. The widget plays it through Qt Multimedia (`QSoundEffect`). The package installs the four WAV files in the widget's `contents/sounds/`.

## Version

The version comes from the `version` field of the root `package.json`. A
release build passes the resolved Tokkl version instead:

```sh
cmake -S desktop/kde -B desktop/kde/build -DTOKKL_VERSION=1.2.0
```

`package/metadata.json` has no `Version` key. The build writes the version into
the copy it installs, and configuring fails if the source file has one.
Building outside the Tokkl checkout requires `-DTOKKL_VERSION`. `desktop/core`
reads its version the same way, from `TOKKL_VERSION` or the root
`package.json`; inside this build it uses the same cache entries. Both print
the version while configuring (`Tokkl KDE companion version` and `Tokkl
desktop core version`).

To build and test `desktop/core` on its own:

```sh
cmake -S desktop/core -B desktop/core/build
cmake --build desktop/core/build -j"$(nproc)"
ctest --test-dir desktop/core/build --output-on-failure
```

`desktop/core/ci/check.sh` does the same in a throwaway Fedora 44 container
with only the Qt base development packages, after removing the Qt Gui runtime.
It fails when the core needs Qt Gui, a KDE library or any Qt library other
than Core, Network and Test. It needs Docker, or another engine set in
`CONTAINER_ENGINE`.

## Icons

The panel button and the widget picker show the full-colour clock logo. Both
come from the icon pack's transparent logo,
`docs/brand/icon-pack/logo/color-1024.png`, through `npm run icons`
(`scripts/icons.ts`, which needs ImageMagick 7). It writes:

- `package/contents/images/tokkl.png`, 96 px, which the panel button shows.
- `package/contents/images/tokkl-mono-dark.png` and `tokkl-mono-light.png`,
  96 px, the monochrome panel logo in black and white ink, from the pack's
  outline logos.
- `package/icons/tokkl-<size>.png` at 32, 48, 64, 96, 128 and 256 px. The
  build installs each as
  `<icon dir>/hicolor/<size>x<size>/apps/com.github.e0ipso.tokkl.png`, where
  the widget picker finds it through `Icon` in `package/metadata.json`. The
  96 px file is a copy of `tokkl.png`. `icons/` is not part of the widget
  package. hicolor declares its `256x256/apps` directory scalable down to
  64 px, so a desktop may draw the 96 px picker icon from the 256 px file.

To change the icons, run `npm run icons` from the repository root and commit
the files it writes. A second run writes the same bytes. Plasma keeps the
widget it has loaded, so after installing new icons restart plasmashell or log
out and back in before checking them.

## Staged install

```sh
DESTDIR="$(mktemp -d)" cmake --install desktop/kde/build
```

With `CMAKE_INSTALL_PREFIX=/usr` the staged tree uses the standard paths:

| Part    | Debian                                                         | Fedora                                      |
| ------- | -------------------------------------------------------------- | ------------------------------------------- |
| Widget  | `/usr/share/plasma/plasmoids/com.github.e0ipso.tokkl/`         | same                                        |
| Backend | `/usr/lib/x86_64-linux-gnu/qt6/qml/com/github/e0ipso/tokkl/backend/` | `/usr/lib64/qt6/qml/com/github/e0ipso/tokkl/backend/` |
| Icons   | `/usr/share/icons/hicolor/<size>x<size>/apps/com.github.e0ipso.tokkl.png` | same                                        |

The backend goes to Qt's own QML directory (`KDE_INSTALL_QMLDIR`), so the
path follows the distribution's Qt layout.

## Packages

Three native packages, all named `tokkl-kde`, ship the widget, the compiled
backend and the widget picker icons at the paths above:

| Package | Target                     | Architecture | Built against                                       |
| ------- | -------------------------- | ------------ | --------------------------------------------------- |
| `.deb`  | Debian 13                  | amd64        | Qt 6.8.2, KDE Frameworks 6.13.0, Plasma 6.3.5       |
| `.deb`  | Kubuntu 26.04              | amd64        | Qt 6.10.2, KDE Frameworks 6.24.0, Plasma 6.6.6     |
| `.rpm`  | Fedora KDE 44 with updates | x86_64       | Qt 6.11.2, KDE Frameworks 6.31.0, Plasma 6.7.5      |

The Fedora column is what the Fedora 44 repositories held on 2026-10-16; a
later build uses whatever its updates hold then. The RPM depends on the Qt it
was built with, so it needs an updated Fedora 44, not the release media alone.
CI tests these three targets. Debian uses `libPlasma.so.6`; Ubuntu 26.04
uses `libPlasma.so.7`, so their DEBs are separate builds. Stock Ubuntu 24.04
has no KDE Frameworks 6 or Plasma 6. Derivatives need compatible versions of
every declared library and QML dependency; sharing a Debian package format
does not establish compatibility.

The Ubuntu 26.04 build was also checked on TUXEDO OS 24.04.4 with Qt
6.10.2, KDE Frameworks 6.24.0 and Plasma 6.6.6: APT's simulated install
needed only `tokkl-kde`, all backend library symbols resolved, and the
extracted widget and backend passed all ten smoke checks in the host's Qt
runtime with a virtual X display. Use the Ubuntu DEB for that stack.
TUXEDO has no separate CI target; a different or older stack
needs its own compatibility check.

The package version is the shared Tokkl version from the root `package.json`;
there is no separate companion version. The widget metadata carries it
unchanged. Packages take only versions that dpkg and rpm order the same way
as SemVer: `MAJOR.MINOR.PATCH`, optionally followed by `-<letters>` or
`-<letters>.<number>` (number 1 or more). `scripts/native-version.sh` turns the
pre-release into a `~` suffix without the dot, so `1.2.0-rc.1` becomes
`1.2.0~rc1` and sorts before `1.2.0`. Other forms, such as `1.2.0-alpha-1`,
`1.2.0-rc1`, `1.2.0-rc.0` or build metadata, are refused; the CMake build still
accepts them for development builds. The RPM release is always `1`.

Dependencies:

- Libraries (KF6 Wallet, Qt Core, Multimedia, Network and Qml) come from
  `dpkg-shlibdeps` and rpm's own scan.
- The QML modules the widget imports at run time are declared by hand, since
  no tool can see them: `org.kde.plasma.*` (in `plasma-desktoptheme` on
  Debian, `libplasma` on Fedora), Kirigami, KCMUtils and Qt Quick, Controls,
  Layouts and Templates. Floors follow the CMake minimums.
- Qt Multimedia plays the Pomodoro alarm: `libqt6multimedia6` on Debian and
  Ubuntu (which `dpkg-shlibdeps` adds), `qt6-qtmultimedia` on Fedora. Qt's SVG
  image plugin draws the Pomodoro hourglass: `qt6-svg-plugins` on Debian and
  Ubuntu, `qt6-qtsvg` on Fedora. Both packages declare them.
- The KDE Wallet daemon is recommended (`kwallet6`, `kf6-kwallet`). Without a
  working wallet the widget shows a KDE Wallet error and keeps no secret
  anywhere else.

None of the packages has maintainer scripts or files outside `/usr`. Removing or
purging one leaves each user's widget settings (in the Plasma applet
configuration) and the KDE Wallet entries untouched.

### Build and check

`scripts/container-check.sh` tests, builds and checks all three packages in
throwaway containers, so nothing is installed on the host. It needs Docker,
or another engine set in `CONTAINER_ENGINE`. Run it from the repository root
with the version from `package.json`:

```sh
version="$(node -p 'require("./package.json").version')"
desktop/kde/scripts/container-check.sh --version "$version" --output "$(mktemp -d)"
```

For each target it builds the three stages of `ci/Dockerfile` (Debian 13),
`ci/ubuntu.Dockerfile` (Kubuntu 26.04) or `ci/fedora.Dockerfile` (Fedora) as `tokkl-kde-ci:<format>-target`, `-build`
and `-test` (`TOKKL_KDE_CI_IMAGE` changes the name). The containers see
`desktop/` read-only at `/desktop`, so the build finds `desktop/core`.

The images are labelled with the identity that `ci/image-id.sh --format
deb|ubuntu-deb|rpm` prints: a SHA-256 over the Dockerfile (which pins the base image by
digest), each file it copies (`scripts/prepare-target.sh`, `debian/control`
or the RPM spec, `ci/baseline.sh`) and `TOKKL_KDE_CI_REFRESH`. Images that
carry the current identity are reused without a build, and the log says
`image hit` or `image miss`. The distribution archives move while those
files stay the same, so set `TOKKL_KDE_CI_REFRESH` to a new value (any
string; the build receives it too) to rebuild the images against the archives
as they are now. With `TOKKL_KDE_CI_IMAGE_CACHE=<dir>`, missing images are
loaded from `<dir>/<format>-<identity>.tar` when it exists, and images built
in the run are saved there. Each target container fetches the package lists
again before the checks, since its image may be days old. Then:

1. In the test image, configures and builds the project with the version and
   runs CTest under Xvfb and a DBus session. The `smokeload` and
   `realservertest` binaries go to `tests/<format>/` in the output directory,
   with `packages.txt`, the packages the load check installs.
2. In the build image, builds the package for the version and for the older
   `--previous-version` (default 0.0.0, a build of the same source), which
   the upgrade check starts from. With `--previous-package <file>` and a
   single `--format`, that file is the previous package instead, for
   example a published release, and nothing else is built for it.
3. In a fresh target container, runs `scripts/check-package.sh` with the
   load check.

`ci/previous-package.sh --format deb|ubuntu-deb|rpm --version <version> --output
<dir>` fetches such a file with `gh`: from the newest published release
older than `<version>` (by the package version order) that has exactly one
asset for the format with the name pattern above, the label
`.releaserc.json` gives that format, which names the target, and a SHA-256
digest. Releases built for another target, such as the DEBs labelled for
TUXEDO OS, are passed over. It checks the download against the asset's size
and digest and prints its path. Without `gh`, when the releases or their
assets cannot be read, with no matching asset, or when the download fails,
it says why and prints nothing, and the check falls back to the 0.0.0
build. A file that downloads but does not match its size and digest exits 1.
The download goes to a scratch directory first, so neither case leaves a
partial file behind.
`check-package.sh` then refuses the file before installing anything unless
it is `tokkl-kde` for the target's architecture (and, for an RPM, the
target's `%{dist}`, such as `.fc44`) and older than the new package. A run
on your own machine builds the 0.0.0 package unless you pass
`--previous-package`.

The output directory gets `tokkl-kde_<version>_amd64.deb`,
`tokkl-kde_<version>_amd64-ubuntu26.04.deb` and
`tokkl-kde-<version>-1.fc44.x86_64.rpm`, plus `previous/` and `tests/`.
`--format deb`, `--format ubuntu-deb` or `--format rpm` does one target. The images stay for
`ci/realserver.sh`; remove them with `docker image rm`.

The scripts it runs work on their own, for a prepared machine:

- `scripts/prepare-target.sh --format deb|rpm [--build-deps] [--refresh]`:
  fetches the Debian package lists if the system has none and, with
  `--build-deps`, installs the build dependencies from `debian/control` or
  `packaging/rpm/tokkl-kde.spec`. A second run keeps the lists it finds;
  `--refresh` fetches the package lists or the Fedora repository metadata
  again.
  Run it as root, only in a container.
- `scripts/package-release.sh --version <version> --format deb|ubuntu-deb|rpm --output
  <dir>`: builds one package with `dpkg-buildpackage` or `rpmbuild` from a
  copy of the source with `desktop/core` in `core/`, without the tests, and
  prints its path. The version is
  required; `debian/changelog` is written from it at build time.
- `scripts/check-package.sh --version <version> --package <file> [--previous
  <file>] [--load-test <dir>]`: inspects the package (name, version,
  architecture, MIT license, widget, backend and icon paths, dependencies, no
  maintainer scripts), installs it on a clean system, checks the stamped widget version,
  the backend's libraries and the package manager's verify, removes it, then
  installs the previous package, upgrades and removes again (purging on
  Debian). Removal takes only `tokkl-kde` away and keeps its dependencies
  (`dnf remove --no-autoremove` on Fedora; `apt-get remove` keeps them
  anyway), so the check does not cover dependency autoremove. Settings and
  wallet files in a test home directory must not change. With `--load-test`, after the clean install and after the upgrade
  it installs the packages in `<dir>/packages.txt` and runs `<dir>/smokeload`
  against the installed files, under Xvfb and `dbus-run-session`: the
  widget, its configuration schema and Configure page load through libplasma
  and the backend loads from Qt's QML directory. It installs packages, so
  run it as root in a container.

## CI and releases

The `kde` job in `.github/workflows/ci.yml` runs once per target, Debian 13
(DEB), Kubuntu 26.04 (Ubuntu DEB) and Fedora KDE 44 (RPM), on every pull request
and push to main:
`scripts/container-check.sh` for the version in `package.json`, then
`ci/realserver.sh`. The `core` job runs `desktop/core/ci/check.sh`, and the
`gnome` job runs `desktop/gnome/ci/check.sh` and builds and checks the GNOME
release files (see `desktop/gnome/README.md`). The release job needs the
`test` job (the server and web checks), all three `kde` targets and the `core`,
`gnome`, `gnome-extension` and `macos` jobs to pass.

The images are recorded in `ci/Dockerfile`, `ci/ubuntu.Dockerfile` and
`ci/fedora.Dockerfile`: base
images pinned by digest and the build and test packages. The distribution archives have no snapshots, so a build gets the
Qt, KDE Frameworks and Plasma packages they hold that day.

CI keeps the images between runners in the GitHub Actions cache, one entry
per format under the key `kde-images-<format>-<identity>`, holding the
`docker save` archive of the three images. Each `kde` job restores its entry,
runs `scripts/container-check.sh` with `TOKKL_KDE_CI_IMAGE_CACHE`, and saves
the entry when the restore missed. CI sets `TOKKL_KDE_CI_REFRESH` to the ISO
week of the commit (`<year>-W<week>`), so the images follow the archives at least
weekly and the jobs of one run agree on the identity. To rebuild sooner, for
example when a cached build environment falls behind the target, delete the
entries with `gh cache delete <key>` (`gh cache list --key kde-images-` lists
them); the next run builds and saves new ones. Actions caches are scoped by
branch: an entry saved by a pull request is visible only to that pull
request, and the release reads entries saved on main and never saves any, so
pull request code cannot change the images a release uses. `ci/baseline.sh`
prints those versions in every build and fails it when they are older than
the supported baseline (Debian 13: Qt 6.8.2, KDE Frameworks 6.13.0, Plasma
6.3.5; Ubuntu: Qt 6.10.2, KDE Frameworks 6.24.0, Plasma 6.6.4; Fedora:
Qt 6.10.2, KDE Frameworks 6.24.0, Plasma 6.6.0). On 2026-10-17
the Debian image had Qt 6.8.2, KDE Frameworks 6.13.0 and libplasma 6.3.5; on
2026-10-16 the Fedora image had Qt 6.11.2, KDE Frameworks 6.31.0 and
libplasma 6.7.5. To move a base image, update
its digest in the Dockerfile.

A push to main releases in three stages, after every check above has
passed:

1. `release-version` runs `ci/next-release.js`, a semantic-release dry run
   that prints the next version, or nothing when the pushed commits warrant
   no release. Then nothing else runs. The dry run checks that
   semantic-release could push, so this job has the same write token as the
   release.
2. `kde-release` runs once per format, each on its own runner, from the same
   commit: `ci/previous-package.sh` for the predecessor, then
   `scripts/container-check.sh` for the next version with it (or with the
   0.0.0 build when there is none, which the log says), with the image cache
   read-only. Each leg uploads the package and a manifest,
   `kde-<format>.json`, with the format, version, commit, file name and
   SHA-256, as the artifact `kde-release-<format>`. A re-run replaces it.
3. `release` starts only when all three legs passed. It downloads all artifacts
   into `dist/kde` and runs semantic-release, with the local plugin
   `ci/semantic-release.js` listed in `.releaserc.json` after
   `@semantic-release/npm` and before `@semantic-release/git`:
   - `verifyRelease` refuses a next version that `scripts/native-version.sh`
     cannot map and, in the release job, one other than the version the
     packages were built for (`TOKKL_KDE_RELEASE_VERSION`).
   - `prepare` fails unless `dist/kde` holds exactly the Debian DEB, Ubuntu
     DEB and RPM of that version and their three manifests, and each manifest names that
     version, the commit being released and the package's SHA-256. A failure
     stops the release before the tag is pushed.
   - `@semantic-release/github` attaches `dist/kde/tokkl-kde_*_amd64.deb`,
     `dist/kde/tokkl-kde_*_amd64-ubuntu26.04.deb` and `dist/kde/tokkl-kde-*.x86_64.rpm` to the `v<version>` release it
     creates.

A failed leg skips the `release` job, so nothing is tagged or published.
When another release moves main on between the stages, semantic-release in
the `release` job finds the branch behind and releases nothing.

There is no separate companion version, tag or workflow, and the packages
are published nowhere else: no app store, KDE Store, Flatpak or distribution
repository.

### One version, one release

Tokkl has one version, the `version` in the root `package.json`. One push to
main that semantic-release turns into a release produces, under that
version, the `v<version>` tag, the GitHub release with the Debian and Ubuntu DEBs and the RPM
attached, and the `ghcr.io/e0ipso/tokkl` Docker image (tagged `<version>`,
`<major>.<minor>`, `<major>` and `latest`). Later jobs attach the macOS
companion's DMG to the same release (see `desktop/macos/README.md`). A push
that cuts no release produces none of these. The image publishes in the
same `release` job, after semantic-release, only when it created a tag; it
does not contain the companion. The companion sends its version in the
User-Agent (`tokkl-kde/<version>`) and does not compare it with the
server's or refuse a server of another version.

### Real-server test

`tests/realserver.test.ts` runs the companion's `Connection` and
`TokklTimer`, with the real HTTP transport, against two Tokkl instances
started with the API's multi-user test fixtures (`packages/api/test/helpers.ts`)
on 127.0.0.1. The ids on the two instances collide by construction. A proxy
in front of each instance can hold a reply back, and the test binary
(`tests/realservertest.cpp`, built by CMake but not a CTest test) drives a
control server to hold and release replies, disable an account through the
admin API and remove a workspace membership. It checks:

- isolation: a user who is not an admin, in a workspace other than 1, sees
  only their own projects and timer; start, stop and update requests against
  another workspace get 403;
- account and instance switches: a late reply for the previous account or
  instance, a read or a start, changes nothing, and the start is not sent
  again; after the switch, a stop goes to the new instance only;
- membership loss: a stop refused with 403 leads to one `/me` request,
  blocked writes and polling, and no repeated stop, while the credentials
  stay accepted;
- disabled accounts, with a token and with email and password: the 403 is
  the same as for an unknown token, account data is cleared, writes are
  refused, and nothing is sent again until the user reconnects;
- pause and resume: the clone copies the paused entry's fields, and a resume
  after the task or the project was deleted is refused with 404, creates
  nothing and keeps the chain paused with the server's message.

Afterwards the script compares each instance's database with a snapshot
taken before the run: only the changes the companion was allowed to make are
there. Run it with:

```sh
npm ci
desktop/kde/scripts/container-check.sh --version "$version" --format deb --output "$out"
TOKKL_KDE_TEST_PORT=8170 desktop/kde/ci/realserver.sh --format deb --output "$out"
```

With a native build, set `TOKKL_KDE_REALSERVER_COMMAND` to a JSON array that
runs `<build>/tests/realservertest` and run
`node --test desktop/kde/tests/realserver.test.ts`.

### What CI does not cover

- No Plasma Wayland session. The load check uses libplasma in a test shell
  under Xvfb; it does not start `plasmashell` or KWin, add the widget to a
  real panel, or test clicks, keyboard focus, tooltips, popups or scaling on
  Wayland.
- No KDE Wallet. Every test uses a fake credential store; nothing checks
  that `kwalletd6` stores, unlocks or denies the secret on a real desktop.
- The packages are installed and loaded in containers, not on Debian or
  Fedora KDE desktop installations.

Check those by hand on each target before a release that changes the
widget, its packaging or the wallet code, with the checklist below. CI covers
everything else in the [CTest list](#configure-build-and-test), the package
checks and the [real-server test](#real-server-test).

## Real Plasma smoke checklist

Run this on a Plasma Wayland session of each target (Debian 13 with the
DEB, Kubuntu 26.04 with the Ubuntu DEB, Fedora KDE 44 with the RPM), with the release's packages and a Tokkl
instance you can break on purpose. Nothing here is automated, and no run has
been recorded yet.

Prepare:

- Two accounts, A and B, on the instance. Account A has a billable project,
  a nonbillable project, an archived project that has a stopped entry, and
  one entry from the last 9 days. B has one project with a different name.
- Both accounts' API tokens, and A's email and password.
- `echo $XDG_SESSION_TYPE` prints `wayland`, and KWalletManager shows the
  network wallet. Note the Plasma, KDE Frameworks and Qt versions.

Install and load:

- [ ] `sudo apt install ./<file>.deb` or `sudo dnf install ./<file>.rpm`
      succeeds; `dpkg -s tokkl-kde` or `rpm -q tokkl-kde` shows the release
      version.
- [ ] Add Widgets lists Tokkl, and the widget goes onto a horizontal panel.
      Record the menu path you used and whether a log out was needed.
- [ ] Restart plasmashell (`systemctl --user restart
      plasma-plasmashell.service`) or log out and back in. The panel button
      and the Tokkl entry in Add Widgets show the clock logo in full colour.
- [ ] The panel shows the Tokkl clock logo, a dashed square, `0:00` and the
      Not configured symbol. The tooltip reads "Tokkl:
      Stopped 0:00 · No project · Not configured · Set the instance URL and
      credentials in the widget settings." and shows the version.
- [ ] Configure opens on Connection. Test Connection is disabled until an
      address and a secret are on screen.

Wallet and connection:

- [ ] Enter the instance address and A's token. Test Connection says
      "Connected as" A. Apply. If KWallet asks for access, allow it. The widget
      reaches Connected.
- [ ] KWalletManager shows the secret in the network wallet, folder `Tokkl`,
      and no secret is in `~/.config/plasma-org.kde.plasma.desktop-appletsrc`.
- [ ] Close the wallet and log out and in, or restart the widget. The prompt
      returns; deny it. The widget and the Configure page say KDE Wallet is
      locked or denied access, and nothing is saved anywhere else.
- [ ] Disable the wallet in System Settings. The page and the widget say KDE
      Wallet is disabled. Enable it again.
- [ ] Switch to Email and password with A's email and password; Test
      Connection and Apply work. Switch back to the API token.

Timer:

- [ ] Left click starts the timer. The panel shows `0:00`, then `0:01` a
      minute later, and the web app shows the entry running.
- [ ] Left click again pauses it. The count stops, the web app shows a
      stopped entry, and the tooltip and the menu's state line say Paused
      with the same time.
- [ ] Left click again resumes it. The web app shows a new running entry
      with the paused entry's description, project, tags and billable flag,
      and the panel counts on from the paused time.
- [ ] Tab to the widget: a frame shows. Space and Return pause and resume it.
      With a screen reader, the button reads "Pause the Tokkl timer" while
      running, "Resume the Tokkl timer" while paused and "Start the Tokkl
      timer" while stopped.
- [ ] Choose Stop in the menu while running: the web app shows the entry
      stopped, the panel shows `0:00` and the item reads Start. The next
      click starts a new entry from `0:00`. Pause, then choose Stop: the web
      app no longer shows a paused timer, and the panel shows `0:00`.
- [ ] Pause, then restart plasmashell (`systemctl --user restart
      plasma-plasmashell.service`): the panel still says Paused with the
      same time, and a click resumes from it. Pause in the web app: the panel
      shows Paused with the same time.
- [ ] Start in the web app: the panel shows it running. Stop it in the web
      app: the panel stops.
- [ ] Start on a project: a dot in the project's colour pulses left of the
      time, and the tooltip names the project. Pause: the dot stays, still,
      in the same colour and ring. Stop: a still square stays. Check the dot
      against the panel in Breeze Light and Breeze Dark.
- [ ] Set the animation speed in System Settings to Instant: the dot stops
      pulsing and stays solid. Set it back: it pulses again.
- [ ] Suspend and resume with the timer running: the elapsed time matches the
      web app after the resume.

Pomodoro:

- [ ] Open the menu with a timer running: the Pomodoro mode item reads
      "Pomodoro mode (locked while running)" and is disabled. Stop the timer.
      The item is enabled and reads "Pomodoro mode". Check it. The panel shows
      an hourglass after the logo, and Start session replaces Start.
- [ ] Open Configure, then the Pomodoro page. Set Work to 1 minute and Short
      rest to 1 minute, and pick a different sound for Work → short rest.
      Preview plays each sound once. Apply, and the web app's Pomodoro
      preferences show the same lengths.
- [ ] Left click starts a session. The panel counts down from `1:00`, the
      tooltip reads "Work · 0:45 left · Pomodoro 1 of 4" (or the current
      time), and the menu shows Next phase: Short rest and End session.
- [ ] At the planned end the count turns into `+0:01`, `+0:02` and so on, and
      the sound chosen for Work → short rest loops until you act.
- [ ] Left click confirms Next phase: the alarm stops, the phase is a short
      rest and the web app shows the same phase. Let the rest reach its end
      and confirm Next phase again: the web app shows one stopped entry from
      the work start to now.
- [ ] Left click mid-phase opens the menu. End session stops the countdown
      and saves the open pomodoro. Start and end a session within the time
      resolution: the menu shows "This pomodoro was too short to save." and
      keeps it until the next action.
- [ ] Start a timer in the web app during a session: the session ends and the
      web app holds the partial pomodoro.
- [ ] With the widget in Timer mode, start a session in the web app: the
      panel shows the phase countdown, the menu shows Next phase and End
      session without Start or Stop, and the Pomodoro mode item is locked.
      Left click mid-phase opens the menu, and after the planned end it
      confirms Next phase. End the session in the web app: the panel is the
      timer's again.
- [ ] Uncheck Pomodoro mode: the hourglass goes and a left click acts on the
      timer again. Restart plasmashell: the mode stays as you left it.

Menu:

- [ ] Right click, the Menu key and Shift+F10 open the menu in a separate
      window that the panel does not clip. Try the panel at the top, bottom,
      left and right of the screen, and at 100% and 200% scaling.
- [ ] Arrow keys move, Right opens Project, Return and Space choose and
      Escape closes. The menu shows the state, then Start or Stop, Project,
      Billable, Reconnect, Open Tokkl and Configure Tokkl.
- [ ] While stopped, choosing the billable project turns Billable on, the
      nonbillable project turns it off, and toggling Billable afterwards
      sticks. Start: the web app shows that project and billable flag.
- [ ] While running, Project is disabled. Toggling Billable changes the same
      entry in the web app, with the same description, tags and start, and
      does not create another entry. While paused, Project and Billable are
      both disabled.
- [ ] Stop. The next start is preselected with the stopped entry's project.
      Repeat after changing the running entry's project in the web app
      first: the panel stop preselects the changed project.
- [ ] With nothing running, pick another project, then choose Reconnect: the
      pick stays. Pick nothing, change the newest entry's project in the web
      app, then choose Reconnect: the preselected project follows it.
- [ ] Log out and in with nothing running: the preselected project is the
      newest entry's from the last 9 days. With no entry in 9 days it is No
      project.
- [ ] Start an entry on the archived project in the web app, then open the
      menu: the project is shown checked and disabled, and is not offered
      for a new start.
- [ ] Open Tokkl opens the instance address in the browser.

States:

- [ ] Stop the server, or block it with the firewall. Within about a minute
      the panel shows Offline with the last state kept. Bring it back; it
      returns to Connected within about a minute.
- [ ] Rotate A's token in Tokkl. The panel shows Sign-in refused and the
      server log shows no repeated requests. Save the new token in
      Configure, or choose Reconnect: the panel recovers.
- [ ] Disable A on the Admin page. The panel shows Sign-in refused. Enable
      A and choose Reconnect.

Accounts:

- [ ] With the menu open and a timer running for A, change to B's token in
      Configure and Apply. The menu closes, nothing of A's projects or timer
      is visible, and Start works only after B's state loads. B's start
      appears in B's web app only.
- [ ] Switch back to A's token: the saved secret loads from the wallet and
      A's timer shows.

Packages:

- [ ] Install a newer package over the older one with the widget on the
      panel. The new version loads after a log out and in; settings and the
      wallet entry are still there.
- [ ] Remove the package. The widget is gone from Add Widgets, and the
      wallet folder `Tokkl` and the applet settings remain.

Write down the date, target, versions, package file name and any step that
failed. A failed step blocks a release that changes the widget, its
packaging or the wallet code.
