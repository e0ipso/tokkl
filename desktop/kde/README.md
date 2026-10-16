# Tokkl KDE companion: build notes

A Plasma 6 panel widget for Tokkl. It has two parts:

- `package/`: the widget, a QML package with plugin id `com.github.e0ipso.tokkl`.
  Its entry point is `contents/ui/main.qml`.
- `src/`: the backend, a Qt/C++ QML module imported as `com.github.e0ipso.tokkl.backend`.
  The API client, credential storage, connection state and timer controller are
  in the `tokklcore` static library, which the module and the tests link.

This is a standalone CMake project. The npm workspaces, `npm run build` and the
server image do not build or ship it.

## Requirements

| Dependency                                        | Minimum |
| ------------------------------------------------- | ------- |
| CMake                                             | 3.27    |
| Qt 6: Core, Network, Qml, Quick (Test for tests)  | 6.10    |
| Extra CMake Modules; KF6 Wallet, Package, Config  | 6.24    |
| KF6 I18n (tests only)                             | 6.24    |
| QML modules: Kirigami, KCMUtils                   | 6.24    |
| Plasma: libplasma, PlasmaQuick                    | 6.6     |

The minimums cover the two supported targets: TUXEDO OS 24.04 (Qt 6.10.2, KDE
Frameworks 6.24.0, Plasma 6.6.6) and Fedora KDE 44 (Qt 6.11.2, KDE Frameworks
6.25.0 and libplasma 6.6.4 in October 2026). Older Plasma 6 releases are not
supported.

Packages on TUXEDO OS 24.04: `cmake extra-cmake-modules qt6-base-dev
qt6-declarative-dev libplasma-dev libkf6wallet-dev libkf6i18n-dev
qml6-module-org-kde-kirigami qml6-module-org-kde-kcmutils`.

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
- `networktransport`: the real HTTP transport against an in-process server on
  127.0.0.1: headers, no cookies, redirects not followed, timeouts.
- `version`: version resolution and metadata stamping.
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
  they are saved, and reports the account and its workspace.

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

## Timer

`TokklTimer` (`src/timercontroller.h`) drives the timer for the widget. QML
sets its `connection` to the widget's `TokklConnection`.

- The elapsed time (`elapsedText`, `H:MM:SS`) is recomputed every second from
  the entry's server start time, so time spent asleep is not lost.
- The current entry is read every 30 seconds, after every start or stop,
  after a resume (a clock tick more than 10 seconds late) and when the
  connection comes back. Projects are read on connect, resume and reconnection.
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
