# Tokkl for GNOME

GNOME has no system tray, so Tokkl comes to GNOME in two parts:

- `tokkl-timerd` (`src/`, `dbus/`): a headless service on the session bus. It runs the shared desktop core in `desktop/core`, the same timer and API client as the KDE and macOS apps, and owns `org.tokkl.Timer1` at `/org/tokkl/Timer1`. The interface is described in `dbus/org.tokkl.Timer1.xml`. The token or password goes to the keyring (GNOME Keyring through libsecret).
- The GNOME Shell extension (`extension/`): a top bar button for that timer. It shows what the service publishes and calls its methods. The timer, the connection and the credentials stay in the service.

Both are standalone. The npm workspaces, `npm run build` and the server image do not build or ship anything from this directory.

## Install the service

You need CMake 3.27 or later, a C++ compiler, Qt 6.10 or later (Core, Network, DBus) and QtKeychain for Qt 6. On Fedora that is `cmake gcc-c++ qt6-qtbase-devel qtkeychain-qt6-devel`.

```sh
cmake -S desktop/gnome -B desktop/gnome/build -DCMAKE_INSTALL_PREFIX=/usr
cmake --build desktop/gnome/build
ctest --test-dir desktop/gnome/build --output-on-failure
sudo cmake --install desktop/gnome/build
```

The install adds `tokkl-timerd`, the D-Bus activation file `org.tokkl.Timer1.service`, the systemd user unit `tokkl-timerd.service` and the interface description. Nothing has to be started by hand: the first call to `org.tokkl.Timer1`, which the extension makes when it is enabled, starts the service. Its log is in `journalctl --user -u tokkl-timerd`.

## Install the extension

The extension needs GNOME Shell 46, 47, 48, 49, 50 or 51. Pack it, install the package for your user and enable it:

```sh
gnome-extensions pack desktop/gnome/extension --force --out-dir=/tmp \
    --extra-source=indicator.js --extra-source=projectindicator.js --extra-source=timer1.js
gnome-extensions install --force /tmp/tokkl@e0ipso.github.com.shell-extension.zip
```

On Wayland, GNOME Shell only finds a newly installed extension after a restart: log out and back in. Then enable it:

```sh
gnome-extensions enable tokkl@e0ipso.github.com
```

To upgrade, pack and install again, then log out and in. To remove it, run `gnome-extensions uninstall tokkl@e0ipso.github.com`.

## Connect to Tokkl

Open the extension's settings from its menu (Settings), from the Extensions app, or with `gnome-extensions prefs tokkl@e0ipso.github.com`. Enter the instance URL, for example `https://tokkl.example.com`, choose API token or email and password, enter the secret and press Connect. The values go to the service's `Configure` method. The service checks them, saves the secret in the keyring and connects; the Timer service row then shows the result.

The extension keeps the instance URL, sign-in method and email that the service last accepted, so the form opens filled in. It never keeps the token or password. Leave that field empty to keep the secret the keyring already holds for the account.

## Use it

The button shows the running entry's elapsed time, or `0:00:00` while stopped. While the service is loading or saving, the time ends with `…`. When the service is not configured, offline, refused or failing, or not running at all, the time ends with `!` and the first menu lines say why.

Before the time sits the project indicator, for the running entry's project or the next start's while stopped, drawn as the KDE panel draws it. A dot pulses while an entry runs and a still square shows while stopped. The project's colour fills it inside a thin ring in the top bar's text colour, which keeps the ring at the top bar's own text contrast whatever the project colour: 21:1 on the dark top bar and at least 13.5:1 on the light one in GNOME Shell 46 to 51. A project whose colour is not `#rrggbb` is filled with the text colour. No project draws a dashed outline of the dot or the square, and while the project is still being read the slot stays empty. The slot has the same size in every state, so the time never moves. Only the dot's fill pulses; the ring and the dashed outline stay solid. The pulse stops when animations are off: the Reduce Animation setting (`org.gnome.desktop.interface enable-animations`), or GNOME Shell turning them off itself, for example when it renders in software. The indicator's accessible name, and the button's, name the project or say No project, so the colour is never the only sign.

Click the time to start a stopped timer or stop a running one. Right-click, or tap on a touch screen, for the menu. From the keyboard, focus the top bar (Ctrl+Alt+Tab) and press Space, Return or Down on the button: the menu opens, and Start or Stop is its first item.

- Project sets the project of the next start. It is locked while an entry runs, because the service refuses to change it then: stop the entry and start a new one.
- Billable sets the next start too. While an entry runs, it changes that entry.
- Start, Stop, Project and Billable are available only while the service reports it is connected.

## Supported GNOME Shell versions

`metadata.json` lists 46 to 51. The extension is an ES module, which GNOME Shell requires from 45 on. 45 is left out because the releases that shipped it, Fedora 39 and Ubuntu 23.10, have reached their end of life. 46 is the version of Ubuntu 24.04 LTS, 48 that of Debian 13, and 50 that of Fedora 44 and Ubuntu 26.04 LTS. 51 is the current release.

Two Shell differences matter to the button. From 50 on, the panel button opens its menu from a click gesture; before 50, from its event handler. The extension handles primary clicks in both. From 50 on, setting the Billable switch from code also reports it as toggled, so the extension ignores toggles it caused itself.

## Check it

`extension/timer1.js` and `extension/projectindicator.js` hold the parts that need no GNOME Shell: the interface the extension expects, elapsed time, the status words and what the project indicator draws. Node runs its tests, and `npm test` includes them:

```sh
node --test 'desktop/gnome/extension/**/*.test.js'
```

One test compares the extension's copy of the interface with `dbus/org.tokkl.Timer1.xml`, so a change to the service's interface fails until the extension follows it.

`extension/ci/check.sh` runs the extension in a real GNOME Shell, one container per listed version (Ubuntu 24.04 for 46, Fedora 41 to 45 for 47 to 51). In each, it packs and installs the extension, starts a headless GNOME Shell and drives the button with a virtual pointer and keyboard against `ci/mock-timer.js`, a stand-in for `tokkl-timerd` that keeps a timer in memory. It then opens the settings in the Extensions app's own window and checks what reaches `Configure`. It needs Docker (or `CONTAINER_ENGINE=podman`) and takes a few minutes per version:

```sh
desktop/gnome/extension/ci/check.sh        # every version in metadata.json
desktop/gnome/extension/ci/check.sh 50 51  # some of them
```

`extension/ci/realservice.sh` checks the same panel end to end on GNOME Shell 50: `ci/realservice.test.ts` serves a Tokkl server on 127.0.0.1 with the API's test fixtures, a Fedora 44 container on the host's network builds the real `tokkl-timerd`, configures it with a token kept in a GNOME Keyring of its own, and `ci/realservice-check.js` starts and stops an entry from the panel. The script then checks that the server holds that one entry, with the chosen project, billable switched on while it ran, and the stop snapped to the time resolution. It needs Docker, Node.js 24 and `npm ci` on the host. CI does not run it.

`ci/check.sh` builds and tests the service in a Fedora 44 container and checks its install and D-Bus activation. The `gnome` CI job runs it.
