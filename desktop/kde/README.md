# Tokkl KDE companion

A Plasma 6 panel widget for Tokkl. It shows the running timer in the panel,
starts and stops it with a click, and sets the project and billable flag. It
is a client of the Toggl-compatible API of one Tokkl instance and keeps
nothing locally except its settings; the API token or password is in KDE
Wallet.

It has two parts:

- `package/`: the widget, a QML package with plugin id `com.github.e0ipso.tokkl`.
  Its entry point is `contents/ui/main.qml`; the panel item and its menu are
  `PanelButton.qml` (with its project indicator, `ProjectIndicator.qml`) and
  `PanelMenu.qml`.
- `src/`: the backend, a Qt/C++ QML module imported as `com.github.e0ipso.tokkl.backend`.
  The API client, credential storage, connection state and timer controller are
  in the `tokklcore` static library, which the module and the tests link.

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

The companion is for two systems, each with one package:

| System                      | Architecture | Package                                 |
| --------------------------- | ------------ | --------------------------------------- |
| TUXEDO OS 24.04             | amd64        | `tokkl-kde_<version>_amd64.deb`         |
| Fedora KDE 44, with updates | x86_64       | `tokkl-kde-<version>-1.fc44.x86_64.rpm` |

Both need Plasma 6.6 or newer, KDE Frameworks 6.24 and Qt 6.10; the exact
bounds are under [Requirements](#requirements) and [Packages](#packages).
Other distributions, releases and architectures are not supported. The manual
checks cover a Plasma Wayland session; X11 sessions are not checked.

A Tokkl release at <https://github.com/e0ipso/tokkl/releases> that includes
the companion has both files attached. The two releases so far, v1.0.0 and
v1.0.1, have no assets (checked 2026-10-16). Until a later release carries
the packages, build them as [Build and check](#build-and-check) describes.

In the directory with the downloaded file:

```sh
# TUXEDO OS 24.04
sudo apt install ./tokkl-kde_<version>_amd64.deb      # install or upgrade
sudo apt remove tokkl-kde                             # remove

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

The packages are published without a declared license, because the
repository has none yet (`License: NOASSERTION` in both).

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

| Dependency                                                  | Minimum |
| ----------------------------------------------------------- | ------- |
| CMake                                                       | 3.27    |
| Qt 6: Core, Network, Qml, Quick (Test, QuickTest for tests) | 6.10    |
| Extra CMake Modules; KF6 Wallet, Package, Config            | 6.24    |
| KF6 I18n with I18nQml (tests only)                          | 6.24    |
| QML modules: Kirigami, KCMUtils                             | 6.24    |
| Plasma: libplasma, PlasmaQuick                              | 6.6     |

The minimums cover the two supported targets: TUXEDO OS 24.04 (Qt 6.10.2, KDE
Frameworks 6.24.0, Plasma 6.6.6) and Fedora KDE 44 (released with Qt 6.10.2,
KDE Frameworks 6.25.0 and libplasma 6.6.4; see [Packages](#packages) for the
versions its updates bring). Older Plasma 6 releases are not supported.

Packages on TUXEDO OS 24.04: `cmake extra-cmake-modules qt6-base-dev
qt6-declarative-dev libplasma-dev libkf6wallet-dev libkf6i18n-dev
qml6-module-org-kde-kirigami qml6-module-org-kde-kcmutils`, and for the tests
`qml6-module-qttest` and `plasma-desktoptheme` (Plasma's QML components).
The CI images in `ci/` hold the complete lists for both targets (see
[CI and releases](#ci-and-releases)).

## Configure, build and test

Run from the repository root. The examples build in `desktop/kde/build`, which
git ignores; any other directory works too.

```sh
cmake -S desktop/kde -B desktop/kde/build -DCMAKE_INSTALL_PREFIX=/usr
cmake --build desktop/kde/build -j"$(nproc)"
ctest --test-dir desktop/kde/build --output-on-failure
```

CTest runs these checks:

- `api`: instance URL parsing, Basic credentials and decoding of the API's
  bare JSON objects, arrays, `null` and error strings.
- `connection`: the connection state machine and the Configure page helper,
  against a scripted transport and credential store. It never opens KDE
  Wallet or the network.
- `timer`: the timer controller (`TokklTimer`) against a fake clock, transport
  and credential store: ticking, sleep gaps, polling, start and stop requests,
  repeated clicks, conflicts, late replies, failures and account switches.
- `panel`: the panel item, its project indicator and its menu
  (`PanelButton.qml`, `ProjectIndicator.qml`, `PanelMenu.qml`) in QtQuickTest, from the QML tests in `autotests/qml/`, offscreen. The
  backend types come from `tokklcore` wired to the fake clock, transport and
  credential store; the test never loads `main.qml`, the real connection or a
  copy of the backend plugin. It covers clicks and keys, the menu and its
  focus, billable defaults, edits of a running entry, paging, archived
  projects, every state, disabled controls and account switches.
- `networktransport`: the real HTTP transport against an in-process server on
  127.0.0.1: headers, no cookies, redirects not followed, timeouts.
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
  offscreen Plasma session. The test uses its own XDG directories, so widgets
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

Token sign-in is the default. Use it unless you want the widget to follow the
account's password: rotating the token under Settings → API token in Tokkl
makes the saved one fail, and the widget shows Sign-in refused until you
save the new token. A password reset through an admin's link does not change
the token, but it does change the password that email sign-in sends.

The page loads the saved token or password of the address, sign-in method and
email on screen. Changing any of them clears a loaded or saved secret, so it
is never tested against or saved for another account. A secret you typed stays
and Apply saves it for the account on screen.

The address, sign-in method and email are ordinary widget settings, in the
Plasma applet configuration. The token or password is saved only in KDE Wallet,
in the network wallet under the folder `Tokkl`, one entry per instance (and
email, for password sign-in). If the wallet is disabled, locked or denies
access, the page and the widget say so and nothing is saved elsewhere.

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

The panel shows the Tokkl icon, a running (playing) or stopped symbol, the
project indicator, the elapsed time and, unless everything is ready, a symbol
for the state. Each state also has its own words in the tooltip, the menu and
the accessible description, so none relies on color: Not configured, Loading,
Connected, Saving, Offline (the last known state), Sign-in refused and Error.

The project indicator shows the running entry's project, or the next start's
while stopped. A dot pulses while an entry runs and a still square shows while
stopped. The project's colour fills it inside a thin ring in the theme's text
colour, which keeps well over 3:1 against the panel in Breeze Light and
Breeze Dark whatever the project colour. A project whose colour is not `#rrggbb` is filled
with the text colour. No project draws a dashed outline of the dot or the
square, and while the project is still being read the slot stays empty. The
slot has the same width in every state. With Plasma's Animation speed set to
Instant the dot does not pulse. The tooltip and the accessible description
name the project, or say No project, so the colour is never the only sign.

| State           | Symbol             | Meaning                                                                                                                                                                  |
| --------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Not configured  | configure          | No address or no saved secret. Open Configure.                                                                                                                           |
| Loading         | network-connect    | Reading the secret, validating the account or making the first current-entry read.                                                                                       |
| Connected       | none               | Ready. Start, stop, Project and Billable work.                                                                                                                           |
| Saving          | view-refresh       | A start, stop or edit is on its way, or its outcome is not known yet. Clicks are ignored.                                                                                |
| Offline         | network-disconnect | The instance cannot be reached after a successful connection. The last entry stays, marked stale, and reads are retried.                                                 |
| Sign-in refused | dialog-password    | The instance answered 403 to the credentials: a wrong or rotated token, a wrong password or a disabled account. Nothing is retried until Reconnect or a settings change. |
| Error           | dialog-error       | The wallet, the settings, a rate limit, a lost workspace, or a connection that never succeeded. The menu and tooltip give the text.                                      |

- Left click, Space or Return starts or stops the timer. Tab focuses the item
  and a frame shows the focus.
- Right click, the Menu key or Shift+F10 opens the menu. It is a separate
  window, so the panel does not clip it. It shows the state, then Project,
  Billable, Reconnect, Open Tokkl and Configure Tokkl. The arrow keys move,
  Right opens Project, Return or Space chooses and Escape closes.
- Project lists No project and the active projects of the workspace, up to
  100 pages of 200; a longer list is cut short, with a note in the menu that
  points to Open Tokkl. The running entry's archived project is shown,
  checked and disabled, but is never offered for new work. Project is
  disabled while an entry runs: its project stays fixed, and changing it
  means stopping and starting a new entry. The menu title names the current
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

`TokklTimer` (`src/timercontroller.h`) drives the timer for the widget. QML
sets its `connection` to the widget's `TokklConnection`.

- The elapsed time (`elapsedText`, `H:MM:SS`) is recomputed every second from
  the entry's server start time, so time spent asleep is not lost.
- The current entry is read every 30 seconds, after every start or stop,
  after a resume (a clock tick more than 10 seconds late) and when the
  connection comes back. Projects are read on connect, resume and reconnection,
  200 a page with `page` and `per_page` until a page comes back short. When the
  chosen project (the running entry's, or the next start's while stopped) is
  not among the active ones it is read on its own
  (`GET /api/v9/workspaces/{wid}/projects/{id}`) so the menu can name it.
- `indicatorState` says what the panel can show for that project: `None`
  without a project or when the read answered 404, `Pending` while its
  details are still unknown, and `Project` once they are, archived projects
  included. `indicatorColor` is the project's colour in the `Project` state
  when it is `#rrggbb`, and an invalid colour otherwise. `indicatorChanged`
  fires whenever either changes. The panel's project indicator draws it.
- Start sends `POST /api/v9/workspaces/{wid}/time_entries` with
  `duration: -1`, the current UTC time as `start`, `created_with: "tokkl-kde"`,
  an empty description and the selected project and billable choice. Stop
  sends `PATCH /api/v9/workspaces/{wid}/time_entries/{id}/stop` for the
  running entry.
- Start and stop stay disabled until a read of the current entry for the
  account and workspace has succeeded, so a start never splits a timer that
  is already running on the server. A failed first read keeps them disabled.
- One start or stop runs at a time and clicks meanwhile are ignored. A read
  sent before a start or stop cannot overwrite its result. When a start or
  stop gets no clear answer (no response, timeout, 5xx or an unreadable body)
  the timer stays busy until a read shows what the server did; it never sends
  the request again. A 409 or 404 on stop just reads the entry again.
- Connection failures keep the last entry, marked stale. After a failed read
  of the entry the mark stays until the entry is read again, even if other
  requests succeed first. Refused credentials clear it. During a 429 cooldown nothing is sent.
- A 403 from a workspace request clears the entry, projects and choices,
  blocks writes and polling, and asks `GET /api/v9/me` once. If `/me` names
  another default workspace the widget switches to it; otherwise Reconnect
  lifts the block. The request that got the 403 is not sent again. A start or
  stop still waiting for its answer keeps the timer busy through the block and
  a reconnect, until it answers and a fresh read of the entry arrives.
- A running entry from a workspace other than the discovered one is not shown.
- Changing the instance, account or secret clears the entry, projects and
  choices at once and ignores late answers, even if the new account uses the
  same ids.

## Version

The version comes from the `version` field of the root `package.json`. A
release build passes the resolved Tokkl version instead:

```sh
cmake -S desktop/kde -B desktop/kde/build -DTOKKL_VERSION=1.2.0
```

`package/metadata.json` has no `Version` key. The build writes the version into
the copy it installs, and configuring fails if the source file has one.
Building outside the Tokkl checkout requires `-DTOKKL_VERSION`.

## Staged install

```sh
DESTDIR="$(mktemp -d)" cmake --install desktop/kde/build
```

With `CMAKE_INSTALL_PREFIX=/usr` the staged tree uses the standard paths:

| Part    | Debian/TUXEDO                                                  | Fedora                                      |
| ------- | -------------------------------------------------------------- | ------------------------------------------- |
| Widget  | `/usr/share/plasma/plasmoids/com.github.e0ipso.tokkl/`         | same                                        |
| Backend | `/usr/lib/x86_64-linux-gnu/qt6/qml/com/github/e0ipso/tokkl/backend/` | `/usr/lib64/qt6/qml/com/github/e0ipso/tokkl/backend/` |

The backend goes to Qt's own QML directory (`KDE_INSTALL_QMLDIR`), so the
path follows the distribution's Qt layout.

## Packages

Two native packages, both named `tokkl-kde`, ship the widget and the compiled
backend at the paths above:

| Package | Target                     | Architecture | Built against                                       |
| ------- | -------------------------- | ------------ | --------------------------------------------------- |
| `.deb`  | TUXEDO OS 24.04            | amd64        | Qt 6.10.2, KDE Frameworks 6.24.0, Plasma 6.6.6      |
| `.rpm`  | Fedora KDE 44 with updates | x86_64       | Qt 6.11.2, KDE Frameworks 6.31.0, Plasma 6.7.5      |

The Fedora column is what the Fedora 44 repositories held on 2026-10-16; a
later build uses whatever its updates hold then. The RPM depends on the Qt it
was built with, so it needs an updated Fedora 44, not the release media alone.
These are the only tested targets. Other Ubuntu or Debian releases, other
Fedora releases, other RPM distributions and other architectures are not
supported. Stock Ubuntu 24.04 has no KDE Frameworks 6 or Plasma 6, so the
`.deb` does not install there.

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

- Libraries (KF6 Wallet, Qt Core, Network and Qml) come from
  `dpkg-shlibdeps` and rpm's own scan.
- The QML modules the widget imports at run time are declared by hand, since
  no tool can see them: `org.kde.plasma.*` (in `plasma-desktoptheme` on TUXEDO
  OS, `libplasma` on Fedora), Kirigami, KCMUtils and Qt Quick, Controls,
  Layouts and Templates. Floors follow the CMake minimums.
- The KDE Wallet daemon is recommended (`kwallet6`, `kf6-kwallet`). Without a
  working wallet the widget shows a KDE Wallet error and keeps no secret
  anywhere else.

Neither package has maintainer scripts or files outside `/usr`. Removing or
purging one leaves each user's widget settings (in the Plasma applet
configuration) and the KDE Wallet entries untouched.

### Build and check

`scripts/container-check.sh` tests, builds and checks both packages in
throwaway containers, so nothing is installed on the host. It needs Docker,
or another engine set in `CONTAINER_ENGINE`. Run it from the repository root
with the version from `package.json`:

```sh
version="$(node -p 'require("./package.json").version')"
desktop/kde/scripts/container-check.sh --version "$version" --output "$(mktemp -d)"
```

For each format it builds the three stages of `ci/Dockerfile` (TUXEDO OS) or
`ci/fedora.Dockerfile` (Fedora) as `tokkl-kde-ci:<format>-target`, `-build`
and `-test` (`TOKKL_KDE_CI_IMAGE` changes the name), then:

1. In the test image, configures and builds the project with the version and
   runs CTest under Xvfb and a DBus session. The `smokeload` and
   `realservertest` binaries go to `tests/<format>/` in the output directory,
   with `packages.txt`, the packages the load check installs.
2. In the build image, builds the package for the version and for the older
   `--previous-version` (default 0.0.0, a build of the same source).
3. In a fresh target container, runs `scripts/check-package.sh` with the
   load check.

The output directory gets `tokkl-kde_<version>_amd64.deb` and
`tokkl-kde-<version>-1.fc44.x86_64.rpm`, plus `previous/` and `tests/`.
`--format deb` or `--format rpm` does one target. The images stay for
`ci/realserver.sh`; remove them with `docker image rm`.

The scripts it runs work on their own, for a prepared machine:

- `scripts/prepare-target.sh --format deb|rpm [--build-deps]`: adds the TUXEDO
  OS repositories on Ubuntu 24.04 (the key fingerprint is checked) and, with
  `--build-deps`, installs the build dependencies from `debian/control` or
  `packaging/rpm/tokkl-kde.spec`. A second run keeps repositories it finds.
  Run it as root, only in a container.
- `scripts/package-release.sh --version <version> --format deb|rpm --output
  <dir>`: builds one package with `dpkg-buildpackage` or `rpmbuild` from a
  copy of the source, without the tests, and prints its path. The version is
  required; `debian/changelog` is written from it at build time.
- `scripts/check-package.sh --version <version> --package <file> [--previous
  <file>] [--load-test <dir>]`: inspects the package (name, version,
  architecture, widget and backend paths, dependencies, no maintainer
  scripts), installs it on a clean system, checks the stamped widget version,
  the backend's libraries and the package manager's verify, removes it, then
  installs the previous package, upgrades and removes again (purging on
  Debian). Settings and wallet files in a test home directory must not
  change. With `--load-test`, after the clean install and after the upgrade
  it installs the packages in `<dir>/packages.txt` and runs `<dir>/smokeload`
  against the installed files, under Xvfb and `dbus-run-session`: the
  widget, its configuration schema and Configure page load through libplasma
  and the backend loads from Qt's QML directory. It installs packages, so
  run it as root in a container.

## CI and releases

The `kde` job in `.github/workflows/ci.yml` runs once per target, TUXEDO OS
24.04 (DEB) and Fedora KDE 44 (RPM), on every pull request and push to main:
`scripts/container-check.sh` for the version in `package.json`, then
`ci/realserver.sh`. The release job needs both targets and the server and
web checks to pass.

The images are recorded in `ci/Dockerfile` and `ci/fedora.Dockerfile`: base
images pinned by digest, the TUXEDO OS repositories, and the build and test
packages. The distribution archives have no snapshots, so a build gets the
Qt, KDE Frameworks and Plasma packages they hold that day. `ci/baseline.sh`
prints those versions in every build and fails it when they are older than
the supported baseline (TUXEDO OS: Qt 6.10.2, KDE Frameworks 6.24.0, Plasma
6.6.6; Fedora: the CMake minimums). On 2026-10-16 the images had Qt 6.10.2,
KDE Frameworks 6.24.0 and libplasma 6.6.6 (TUXEDO OS) and Qt 6.11.2, KDE
Frameworks 6.31.0 and libplasma 6.7.5 (Fedora). To move a base image, update
its digest in the Dockerfile.

semantic-release builds the release packages through the local plugin
`ci/semantic-release.js`, listed in `.releaserc.json` after
`@semantic-release/npm` and before `@semantic-release/git`:

- `verifyRelease` refuses a next version that `scripts/native-version.sh`
  cannot map, before anything is written.
- `prepare` runs `scripts/container-check.sh` with the next version, so the
  packages and widget metadata carry it, into `dist/kde`, and fails unless
  exactly one DEB and one RPM of that version are there. A failure stops the
  release before the tag is pushed.
- `@semantic-release/github` attaches `dist/kde/tokkl-kde_*_amd64.deb` and
  `dist/kde/tokkl-kde-*.x86_64.rpm` to the `v<version>` release it creates.

There is no separate companion version, tag or workflow, and the packages
are published nowhere else: no app store, KDE Store, Flatpak or distribution
repository.

### One version, one release

Tokkl has one version, the `version` in the root `package.json`. One push to
main that semantic-release turns into a release produces, under that
version, the `v<version>` tag, the GitHub release with the DEB and RPM
attached, and the `ghcr.io/e0ipso/tokkl` Docker image (tagged `<version>`,
`<major>.<minor>`, `<major>` and `latest`). A push that cuts no release
produces none of the three. The image publishes in the same `release` job,
after semantic-release, only when it created a tag; it does not contain the
companion. The companion sends its version in the User-Agent (`tokkl-kde/<version>`)
and does not compare it with the server's or refuse a server of another
version.

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
  refused, and nothing is sent again until the user reconnects.

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
- The packages are installed and loaded in containers, not on TUXEDO OS or
  Fedora KDE desktop installations.

Check those by hand on both targets before a release that changes the
widget, its packaging or the wallet code, with the checklist below. CI covers
everything else in the [CTest list](#configure-build-and-test), the package
checks and the [real-server test](#real-server-test).

## Real Plasma smoke checklist

Run this on a Plasma Wayland session of each target (TUXEDO OS 24.04 with the
DEB, Fedora KDE 44 with the RPM), with the release's packages and a Tokkl
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
- [ ] The panel shows the Tokkl icon, the stopped symbol, a dashed square,
      `0:00:00` and the Not configured symbol. The tooltip reads "Tokkl:
      Stopped 0:00:00 · No project · Not configured · Set the instance URL and
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

- [ ] Left click starts the timer. The panel counts up once a second for 10
      seconds, and the web app shows the entry running.
- [ ] Left click again stops it. The count stops and the web app shows a
      stopped entry.
- [ ] Tab to the widget: a frame shows. Space and Return start and stop it.
- [ ] Start in the web app: the panel shows it running within 30 seconds.
      Stop it in the web app: the panel stops.
- [ ] Start on a project: a dot in the project's colour pulses left of the
      time, and the tooltip names the project. Stop: a still square stays.
      Check the dot against the panel in Breeze Light and Breeze Dark.
- [ ] Set the animation speed in System Settings to Instant: the dot stops
      pulsing and stays solid. Set it back: it pulses again.
- [ ] Suspend and resume with the timer running: the elapsed time matches the
      web app after the resume.

Menu:

- [ ] Right click, the Menu key and Shift+F10 open the menu in a separate
      window that the panel does not clip. Try the panel at the top, bottom,
      left and right of the screen, and at 100% and 200% scaling.
- [ ] Arrow keys move, Right opens Project, Return and Space choose and
      Escape closes. The menu shows the state, then Project, Billable,
      Reconnect, Open Tokkl and Configure Tokkl.
- [ ] While stopped, choosing the billable project turns Billable on, the
      nonbillable project turns it off, and toggling Billable afterwards
      sticks. Start: the web app shows that project and billable flag.
- [ ] While running, Project is disabled. Toggling Billable changes the same
      entry in the web app, with the same description, tags and start, and
      does not create another entry.
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

The packages declare `License: NOASSERTION`, because the repository has no
license yet. They are published without a declared license until it has one.
