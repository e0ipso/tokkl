# Tokkl for the macOS menu bar

A menu bar app for Tokkl. It shows the running timer's elapsed time in the menu bar, and a click starts or stops the timer. It is built on the shared desktop core in `desktop/core`, the same timer and API client the KDE companion uses.

## Using it

Click the time to start a stopped timer or stop a running one. A new entry goes on the project selected in the menu.

Right-click or Control-click for the menu. It shows the timer state and has Start or Stop, Project, Billable, Reconnect, Open Tokkl, Settings and Quit.

- Project sets the project of the next start. It defaults to the project of your last entry, and a project you pick while the timer is stopped wins. The project of a running entry is locked. To switch, stop the entry and start a new one.
- Billable sets the next start too. While an entry runs, it changes that entry.

While the timer is loading or saving, the time ends with `…`. When it is offline, refused or failing, the time ends with `!`, and the tooltip and the first menu line say why.

The app sets `LSUIElement`, so it has no Dock icon. Quit it from its menu.

## Settings

The settings window opens on first start. Enter the instance URL, for example `https://tokkl.example.com`, and either an API token or your email and password. The API token is the default; Tokkl shows it under Settings → API token. A path prefix such as `/tokkl` in the URL is kept.

Test Connection checks the values against the instance without saving them. Save keeps them. The address, sign-in method and email go to `~/Library/Preferences/com.github.e0ipso.Tokkl.plist`. The token or password goes only to the macOS Keychain, as a password of the service `Tokkl`. If the Keychain refuses it, Tokkl does not keep it anywhere else.

Open Tokkl at login registers the app as a login item. macOS may ask you to allow it in System Settings → General → Login Items, and you can turn it off there too.

Requests carry the client name `tokkl-macos` in the `User-Agent` header and in the `created_with` field of the entries the app starts.

## Building

You need macOS 13 or later, Xcode or its command line tools, CMake 3.27 or later, Qt 6.10 or later and QtKeychain. With Homebrew:

```sh
brew install cmake qt qtkeychain
cmake -S desktop/macos -B desktop/macos/build -DCMAKE_PREFIX_PATH="$(brew --prefix)"
cmake --build desktop/macos/build
ctest --test-dir desktop/macos/build --output-on-failure
```

The version comes from the root `package.json`. Pass `-DTOKKL_VERSION=<semver>` to override it.

## Running

```sh
open desktop/macos/build/src/Tokkl.app
```

To install it, copy `Tokkl.app` to `/Applications`. The bundle links Qt from Homebrew. Run `macdeployqt` on it to make a copy that runs without Homebrew. The build signs the bundle ad hoc. An ad hoc signature changes with every build, so the Keychain may ask for access again after a rebuild. Pass `-DTOKKL_CODESIGN_IDENTITY=<identity>` to sign with a certificate from your keychain instead.

## Layout and tests

- `src/menubarapp.*`, `statusmenu.*`, `statuswords.*` and `settingswindow.*` are the app without its platform layer. They need only Qt Widgets and the core, so they build and are tested on Linux as well.
- `src/keychaincredentialstore.*` stores secrets through QtKeychain. It builds wherever QtKeychain is installed.
- `src/macstatusitem.mm`, `macloginitem.mm` and `main.mm` are the macOS layer. They hold the NSStatusItem, the SMAppService login item and the wiring. The app does not use `QSystemTrayIcon` because it cannot show text. Its API has an icon and a tooltip only, and Qt's Cocoa backend sets only the status button's image.

On a machine without macOS, the same commands build no app but run the tests: `menubarapp`, `infoplist`, the core's tests, and `keychaincredentialstore` when QtKeychain is installed. The `macos` CI job builds and tests the app on `macos-latest`.
