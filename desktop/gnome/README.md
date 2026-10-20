# Tokkl for GNOME

GNOME has no system tray, so Tokkl comes to GNOME in two parts:

- `tokkl-timerd` (`src/`, `dbus/`): a headless service on the session bus. It runs the shared desktop core in `desktop/core`, the same timer and API client as the KDE and macOS apps, and owns `org.tokkl.Timer1` at `/org/tokkl/Timer1`. The interface is described in `dbus/org.tokkl.Timer1.xml`. The token or password goes to the keyring (GNOME Keyring through libsecret).
- The GNOME Shell extension (`extension/`): a top bar button for that timer. It shows what the service publishes and calls its methods. The timer, the connection and the credentials stay in the service.

Both are standalone. The npm workspaces, `npm run build` and the server image do not build or ship anything from this directory.

## Install the service

Each GitHub release carries `tokkl-timerd` as a DEB for Debian 13 (amd64) and an RPM for Fedora 44 (x86_64), under the same version as the server, the Docker image and the other desktop apps. v1.2.0 was the first release with them, and its DEB was built for Ubuntu 26.04 LTS (checked 2026-10-17); the first DEB built for Debian 13 comes with the next release. Download the one for your system from the release and install it with its dependencies:

```sh
sudo apt install ./tokkl-timerd_<version>_amd64.deb            # Debian 13
sudo dnf install ./tokkl-timerd-<version>-1.fc44.x86_64.rpm     # Fedora 44
```

The RPM depends on the Qt it was built with, so it needs an updated Fedora 44, not the release media. A pre-release version such as `1.2.0-rc.1` is packaged as `1.2.0~rc1`, which sorts before `1.2.0`.

The package installs `tokkl-timerd`, the D-Bus activation file `org.tokkl.Timer1.service`, the systemd user unit `tokkl-timerd.service` and the interface description, and runs no scripts. Nothing has to be started by hand: the first call to `org.tokkl.Timer1`, which the extension makes when it is enabled, starts the service. Its log is in `journalctl --user -u tokkl-timerd`. To remove it, remove the `tokkl-timerd` package.

### Build the service from source

You need CMake 3.27 or later, a C++ compiler, Qt 6.8 or later (Core, Network, DBus) and QtKeychain for Qt 6. On Debian 13 that is `cmake g++ qt6-base-dev qtkeychain-qt6-dev`, on Fedora `cmake gcc-c++ qt6-qtbase-devel qtkeychain-qt6-devel`.

```sh
cmake -S desktop/gnome -B desktop/gnome/build -DCMAKE_INSTALL_PREFIX=/usr
cmake --build desktop/gnome/build
ctest --test-dir desktop/gnome/build --output-on-failure
sudo cmake --install desktop/gnome/build
```

The install adds the same files as the package.

## Install the extension

The extension needs GNOME Shell 46, 47, 48, 49, 50 or 51. Each GitHub release carries it as `tokkl-gnome-extension-<version>.zip`. Install it for your user:

```sh
gnome-extensions install --force tokkl-gnome-extension-<version>.zip
```

To use the extension from a checkout instead, pack it first:

```sh
gnome-extensions pack desktop/gnome/extension --force --out-dir=/tmp \
    --extra-source=indicator.js --extra-source=projectindicator.js --extra-source=timer1.js \
    --extra-source=tokkl.png
gnome-extensions install --force /tmp/tokkl@e0ipso.github.com.shell-extension.zip
```

On Wayland, GNOME Shell only finds a newly installed extension after a restart: log out and back in. Then enable it:

```sh
gnome-extensions enable tokkl@e0ipso.github.com
```

To upgrade, install the new zip, then log out and in. To remove it, run `gnome-extensions uninstall tokkl@e0ipso.github.com`.

## Connect to Tokkl

Open the extension's settings from its menu (Settings), from the Extensions app, or with `gnome-extensions prefs tokkl@e0ipso.github.com`. Enter the instance URL, for example `https://tokkl.example.com`, choose API token or email and password, enter the secret and press Connect. The values go to the service's `Configure` method. The service checks them, saves the secret in the keyring and connects; the Timer service row then shows the result.

The extension keeps the instance URL, sign-in method and email that the service last accepted, so the form opens filled in. It never keeps the token or password. Leave that field empty to keep the secret the keyring already holds for the account.

## Use it

The button shows the timer's elapsed time, or `0:00` while stopped. After a pause it is the total of the whole chain: the time of the entries each pause stopped plus the running entry's, held still while paused. The time is in hours and whole minutes, `H:MM`. While the service is loading or saving, the time ends with `…`. When the service is not configured, offline, refused or failing, or not running at all, the time ends with `!` and the first menu lines say why.

The button starts with the full-colour Tokkl clock logo, `extension/tokkl.png`, at the top bar's icon size. `npm run icons` renders it from the icon pack's master. Between the logo and the time sits the project indicator, for the running entry's project or the next start's while stopped, drawn as the KDE panel draws it. A dot pulses while an entry runs and a still square shows while stopped. The project's colour fills it inside a thin ring in the top bar's text colour, which keeps the ring at the top bar's own text contrast whatever the project colour. The extension's Shell check requires at least 3:1 between the ring and the top bar in each colour scheme. A project whose colour is not `#rrggbb` is filled with the text colour. No project draws a dashed outline of the dot or the square, and while the project is still being read the slot stays empty. The slot has the same size in every state, so the time never moves. Only the dot's fill pulses; the ring and the dashed outline stay solid. The pulse stops when animations are off: the Reduce Animation setting (`org.gnome.desktop.interface enable-animations`), or GNOME Shell turning them off itself, for example when it renders in software. The indicator's accessible name, and the button's, name the project or say No project, so the colour is never the only sign.

Click the time to pause a running timer, to resume a paused one, or to start a stopped one. A pause stops the running entry on the server; a resume starts a copy of it with the same description, project, task, tags and billable flag, and the time counts on from the chain's total. Right-click, or tap on a touch screen, for the menu. Its first line says Connected, or what is wrong with the connection; while paused it starts with the chain total, as in `Paused 1:03 · Connected`. Its first item you can choose is Start while stopped and Stop while running or paused. Stop ends the chain, so the next click starts again from `0:00`; while paused nothing runs on the server, so it only clears the chain. From the keyboard, focus the top bar (Ctrl+Alt+Tab): Space or Return on the button does what a click does, and Down opens the menu. The button's accessible name says Running, Paused or Stopped with the time.

- Project sets the project of the next start. It defaults to the project of your last entry, and a project you pick while the timer is stopped wins. It is locked while an entry runs or the timer is paused, because the service refuses to change it then: Stop, then choose and start.
- Billable sets the next start too. While an entry runs, it changes that entry. While paused it shows the paused entry's flag and is locked.
- Start, Stop, Project and Billable are available only while the service reports it is connected. Until then the service refuses a click or key on the button too.

## Supported GNOME Shell versions

`metadata.json` lists 46 to 51. The extension is an ES module, which GNOME Shell requires from 45 on. 45 is left out because the releases that shipped it, Fedora 39 and Ubuntu 23.10, have reached their end of life. 46 is the version of Ubuntu 24.04 LTS, 48 that of Debian 13, and 50 that of Fedora 44 and Ubuntu 26.04 LTS. 51 is the current release.

Three Shell differences matter to the button. From 50 on, the panel button opens its menu from a click gesture; before 50, from its event handler. The extension handles primary clicks in both. From 51 on, the menu takes Space, Return and Down from a key controller on the button. The extension adds a key controller of its own that runs first and takes Space and Return. Before 51 it takes them in its event handler, before the menu sees them. From 50 on, setting the Billable switch from code also reports it as toggled, so the extension ignores toggles it caused itself.

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

The `gnome-extension` CI job runs it, one leg per Shell version, and the release waits for it. Its matrix repeats the versions of `metadata.json` and fails when the two differ, so a new version needs an image in `check.sh` and a leg in `.github/workflows/ci.yml`.

`extension/ci/realservice.sh` checks the same panel end to end on GNOME Shell 50: `ci/realservice.test.ts` serves a Tokkl server on 127.0.0.1 with the API's test fixtures, a Fedora 44 container on the host's network builds the real `tokkl-timerd`, configures it with a token kept in a GNOME Keyring of its own, and `ci/realservice-check.js` starts, pauses, resumes and stops an entry from the panel. The script then checks that the server holds the paused entry and its clone, with the chosen project and billable switched on while they ran. Each ran a few seconds, so each went to the trash at zero length on the time resolution grid. It needs Docker, Node.js 24 and `npm ci` on the host. CI does not run it.

`ci/check.sh` builds and tests the service in a Fedora 44 container and checks its install and D-Bus activation. The `gnome` CI job runs it.

## Releases

The release files are built by the scripts in `scripts/`, which run in throwaway containers so the host's packages are never touched:

```sh
desktop/gnome/scripts/container-check.sh --version 1.2.0 --output /var/tmp/gnome           # all three
desktop/gnome/scripts/container-check.sh --version 1.2.0 --output /var/tmp/gnome --format rpm
```

- `deb` and `rpm`: `scripts/package-release.sh` builds `tokkl-timerd` for the version in a pinned Debian 13 or Fedora 44 image, from `debian/` or `packaging/rpm/tokkl-timerd.spec`. The program reports the version unchanged; the package version comes from `desktop/kde/scripts/native-version.sh`, as for the KDE packages. `scripts/check-package.sh` then installs the package in a fresh container of the same image with only its declared dependencies, checks its version, files and libraries, and checks that the first call to `org.tokkl.Timer1` starts the service, on a plain `dbus-daemon` and through the systemd user unit with systemd booted in the container.
- `zip`: `scripts/pack-extension.sh` packs the extension with `gnome-extensions pack` in a Fedora 44 image with GNOME Shell. It sets `version-name` in `metadata.json` to the version, checks that the zip holds the extension's files and nothing else, and installs it into a throwaway home. extensions.gnome.org accepts a `version-name` of 1 to 16 letters, digits, dots and spaces, so the script refuses a pre-release version such as `1.2.0-rc.1`. The release branch (`main`) makes only plain versions.

The `gnome` CI job runs all three for the version in `package.json`, and the release waits for it. After semantic-release has made a release, the `gnome-release` job builds them again from the `v<version>` tag with that version, and `gnome-publish` attaches them to the GitHub release with `gh release upload --clobber`. The release is public without them until then, and re-running a failed job attaches them to the existing release. `gnome-release` holds no write token; only `gnome-publish` can write to the release.

### Publish on extensions.gnome.org

The upload is manual, and the release does not wait for it or for the review:

1. Download `tokkl-gnome-extension-<version>.zip` from the `v<version>` GitHub release.
2. Sign in at <https://extensions.gnome.org/> with the account that owns `tokkl@e0ipso.github.com`. The first upload creates the extension under the account that sends it.
3. Open <https://extensions.gnome.org/upload/>, choose the zip, accept the license terms and upload it. extensions.gnome.org gives it the next integer version and shows `version-name`.
4. Wait for the review. Reviewers read the code by hand, which can take days. The description says the extension needs the `tokkl-timerd` service; point the reviewers to the release's DEB and RPM if they ask how to run it.

Until the review passes, the zip on the GitHub release is the way to install the extension.
