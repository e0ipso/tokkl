# Tokkl for the macOS menu bar

A menu bar app for Tokkl. It shows the running timer's elapsed time in the menu bar, and a click starts or stops the timer. It is built on the shared desktop core in `desktop/core`, the same timer and API client the KDE companion uses.

## Installing

Each GitHub release that includes the app has `Tokkl-<version>-arm64.dmg` attached, under the same version as the server and the Docker image. It runs on Macs with Apple silicon and macOS 13 or later. The DMG holds the Qt and QtKeychain libraries the app needs, so you install nothing else.

1. Download the DMG from the [releases page](https://github.com/e0ipso/tokkl/releases) and open it.
2. Drag `Tokkl.app` onto the `Applications` link.
3. Remove the quarantine flag that macOS put on the download:

   ```sh
   xattr -cr /Applications/Tokkl.app
   ```

4. Open Tokkl from `/Applications`. The settings window opens on first start.

The app is signed ad hoc, not with an Apple Developer ID, and is not notarized. Without step 3, macOS refuses to open it and says it is damaged or cannot be checked for malicious software. `xattr -cr` removes the extended attributes from the bundle, the quarantine flag among them, so macOS opens it like an app you built yourself. Repeat it after you install a new version.

## Using it

Click the time to start a stopped timer or stop a running one. A new entry goes on the project selected in the menu.

Right-click or Control-click for the menu. It shows the timer state and has Start or Stop, Project, Billable, Reconnect, Open Tokkl, Settings and Quit.

- Project sets the project of the next start. It defaults to the project of your last entry, and a project you pick while the timer is stopped wins. The project of a running entry is locked. To switch, stop the entry and start a new one.
- Billable sets the next start too. While an entry runs, it changes that entry.

A small shape before the time shows the project: the running entry's, or the one the next start will use. A dot pulses while the timer runs, and a still square shows while it is stopped. The project colour fills it inside a ring in the menu bar's text colour. A dashed outline means no project, and the space stays empty while the project is still loading. With Reduce Motion on, the dot does not pulse. The tooltip and VoiceOver name the project, so the colour is never the only clue.

While the timer is loading or saving, the time ends with `…`. When it is offline, refused or failing, the time ends with `!`, and the tooltip and the first menu line say why.

The app sets `LSUIElement`, so it has no Dock icon. Quit it from its menu.

## Settings

The settings window opens on first start. Enter the instance URL, for example `https://tokkl.example.com`, and either an API token or your email and password. The API token is the default; Tokkl shows it under Settings → API token. A path prefix such as `/tokkl` in the URL is kept.

Test Connection checks the values against the instance without saving them. Save keeps them. The address, sign-in method and email go to `~/Library/Preferences/com.github.e0ipso.Tokkl.plist`. The token or password goes only to the macOS Keychain, as a password of the service `Tokkl`. Settings closes once the Keychain has it. If the Keychain refuses it, Settings stays open with what you typed and shows why, nothing is saved, and Tokkl does not keep the secret anywhere else.

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

To install it, copy `Tokkl.app` to `/Applications`. The bundle links Qt from Homebrew. To make a DMG that runs without Homebrew, like the one the release publishes, run `scripts/package-dmg.sh`:

```sh
desktop/macos/scripts/package-dmg.sh --app desktop/macos/build/src/Tokkl.app \
  --version "$(node -p 'require("./package.json").version')" \
  --output desktop/macos/dist --libpath "$(brew --prefix)/lib"
desktop/macos/scripts/check-dmg.sh desktop/macos/dist/Tokkl-*.dmg "$(node -p 'require("./package.json").version')"
```

It copies the bundle, adds Qt and QtKeychain with `macdeployqt`, signs every binary ad hoc, checks that the copy loads no library from outside the bundle or the system, and packages it with a link to `/Applications`. `check-dmg.sh` mounts the DMG, checks the version and signature, and starts the app from it for ten seconds. `--identity <identity>` signs with a certificate instead.

The build signs the bundle ad hoc. An ad hoc signature changes with every build, so the Keychain may ask for access again after a rebuild. Pass `-DTOKKL_CODESIGN_IDENTITY=<identity>` to sign with a certificate from your keychain instead.

## Layout and tests

- `src/menubarapp.*`, `statusmenu.*`, `statuswords.*`, `projectindicator.*` and `settingswindow.*` are the app without its platform layer. They need only Qt Widgets and the core, so they build and are tested on Linux as well.
- `src/keychaincredentialstore.*` stores secrets through QtKeychain. It builds wherever QtKeychain is installed.
- `src/macstatusitem.mm`, `macloginitem.mm` and `main.mm` are the macOS layer. They hold the NSStatusItem and the drawing of the project indicator, the SMAppService login item and the wiring. The app does not use `QSystemTrayIcon` because it cannot show text. Its API has an icon and a tooltip only, and Qt's Cocoa backend sets only the status button's image.

On a machine without macOS, the same commands build no app but run the tests: `menubarapp`, `infoplist`, the core's tests, and `keychaincredentialstore` when QtKeychain is installed. The `macos` CI job builds and tests the app on `macos-latest` with a pinned Qt from the Qt installer and a pinned QtKeychain built from source, both set up by `.github/actions/macos-build`. It then packages and checks a DMG with the two scripts. The release waits for it.

## Releases

semantic-release decides the version on the Linux runner of the `release` job, and the app builds only on macOS. After the release job has tagged `v<version>` and created the GitHub release, the `macos-release` job builds the app from that tag with `-DTOKKL_VERSION=<version>`. It checks that the tag's `package.json` has that version, so the bundle's `CFBundleVersion` is the release version. It then runs `package-dmg.sh` and `check-dmg.sh`. The `macos-publish` job attaches `Tokkl-<version>-arm64.dmg` to the release with `gh release upload`. It is a separate Linux job so that the job that builds QtKeychain and the app never holds a token that can write to the repository. The release needs no Apple certificate, password or other secret.

Until `macos-publish` finishes, the release has no DMG. If either job fails, re-run the failed jobs of that workflow run. The upload uses `--clobber`, so it replaces a DMG of the same name.

Apple silicon runs no native code without a signature, but an ad hoc one is enough ([macOS Big Sur 11.0.1 Universal Apps Release Notes](https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes), Code Signing). `macdeployqt` changes the binaries it copies and links, which breaks the signature the linker made, so it signs them again, ad hoc by default ([Qt for macOS - Deployment](https://doc.qt.io/qt-6/macos-deployment.html)). Gatekeeper still rejects an ad hoc signature on a downloaded app, hence the `xattr` step.
