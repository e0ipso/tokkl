# Tokkl for the macOS menu bar

A menu bar app for Tokkl. It shows the Tokkl clock logo and the timer's elapsed time in the menu bar, and a click starts, pauses or resumes the timer. It is built on the shared desktop core in `desktop/core`, the same timer and API client the KDE companion uses.

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

Click the time to start a stopped timer. A new entry goes on the project selected in the menu. A click on a running timer pauses it, and the next click resumes it with a new entry that copies the paused entry's description, project, task, tags and billable flag. While paused, the time stands still. After a resume it counts on from that total, through every pause, until you stop the timer. Quitting and reopening the app keeps the total.

Right-click or Control-click for the menu. It shows the timer state (Running, Paused or Stopped) and has Start Timer or Stop Timer, Project, Billable, Reconnect, Open Tokkl, Settings and Quit. In Pomodoro mode it also has Start session, Next phase and End session, and the Pomodoro mode item (see [Pomodoro mode](#pomodoro-mode)).

- Start Timer starts a new entry while the timer is stopped. Stop Timer stops a running or paused timer, and the next start counts from 0:00. While paused, Stop sends nothing to the server, because the paused entry is already stopped.
- Project sets the project of the next start. It defaults to the project of your last entry, and a project you pick while the timer is stopped wins. The project of a running or paused entry is locked. To switch, stop the timer and start a new entry.
- Billable sets the next start too. While an entry runs, it changes that entry. While paused, it is locked.

The menu bar item shows the clock logo in full colour, then a small shape for the project, then the time. The shape shows the running or paused entry's project, or the one the next start will use. A dot shows while the timer runs or is paused, and it pulses only while the timer runs. A still square shows while it is stopped. The project colour fills it inside a ring in the menu bar's text colour. A dashed outline means no project, and the space stays empty while the project is still loading. With Reduce Motion on, the dot does not pulse. The tooltip and VoiceOver name the project, so the colour is never the only clue.

While the timer is loading or saving, the time ends with `…`. When it is offline, refused or failing, the time ends with `!`, and the tooltip and the first menu line say why.

The app sets `LSUIElement`, so it has no Dock icon. Quit it from its menu.

## Pomodoro mode

The Pomodoro mode item in the menu switches the app between Timer mode and Pomodoro mode. It is checked while Pomodoro mode is on, and the app remembers the choice on this Mac. While a timer runs or is paused, or a session is active, the item reads "Pomodoro mode (locked while running)" and is disabled. End the session, or stop the timer, to change it.

A click on the menu bar item depends on the mode:

- In Timer mode, and while a timer runs or is paused, it acts on the timer as above.
- In Pomodoro mode with no session, it starts one.
- While a phase rings after its planned end, it confirms Next phase.
- Mid-phase, it opens the menu.

In Pomodoro mode the menu drops Start Timer and shows Start session while no session is active. During a session it shows Next phase: followed by the phase it starts (Work, Short rest or Long rest), and End session. Start Timer and Stop Timer show only in Timer mode or while a timer runs. Next phase ends the current phase. Ending a work phase starts a rest and saves nothing. Ending a rest saves the pomodoro, the work phase plus the rest, as one stopped entry. End session saves the open pomodoro at once. Starting a timer on another device ends the session at that timer's start and saves the partial pomodoro. A pomodoro too short to save is dropped, and the menu says "This pomodoro was too short to save." until the next session starts.

Whenever Pomodoro mode is on, an hourglass follows the project indicator in the menu bar, in full colour or, with Use a monochrome menu bar icon on, in the menu bar's text colour. During a session the time counts down as `M:SS` to the phase's planned end, then up as `+M:SS` in overtime. The tooltip and VoiceOver read, for example, "Short rest · 4:10 left · Pomodoro 2 of 4". The app posts no notification.

When a phase reaches its planned end, the sound chosen for that transition plays over and over until you confirm Next phase or end the session. The sounds are the four the web app plays, bundled in `Contents/Resources/sounds` and played through AppKit's `NSSound`.

## Settings

The settings window opens on first start. Enter the instance URL, for example `https://tokkl.example.com`, and either an API token or your email and password. The API token is the default; Tokkl shows it under Settings → API token. A path prefix such as `/tokkl` in the URL is kept.

Test Connection checks the values against the instance without saving them. Save keeps them. The address, sign-in method and email go to `~/Library/Preferences/com.github.e0ipso.Tokkl.plist`. The token or password goes only to the macOS Keychain, as a password of the service `Tokkl`. Settings closes once the Keychain has it. If the Keychain refuses it, Settings stays open with what you typed and shows why, nothing is saved, and Tokkl does not keep the secret anywhere else.

Open Tokkl at login registers the app as a login item. macOS may ask you to allow it in System Settings → General → Login Items, and you can turn it off there too.

Use a monochrome menu bar icon switches the clock logo to the menu bar's text colour automatically, including after appearance changes. Save keeps this preference. Full colour is the default; the project indicator keeps its own colour in either mode.

The Pomodoro section shows the account's four lengths: Work, Short rest and Long rest in minutes, and Long rest every so many pomodoros. They are the same preferences the web app and Android use, read again each time the window opens. With a connected account you can edit them, and Save posts the ones that changed; a length the server refuses shows its message next to the field, and the window stays open. Without a connection the last lengths read show and cannot be edited, and a note says so. Below them, each of the four transitions has the sound it plays, chosen from the same four sounds, with a Preview button that plays the selection once. Save keeps the choices in the preferences file next to the address; they never go to the server. A session has no lengths of its own: it uses the account's lengths.

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

The app icon is the Tokkl clock logo. `npm run icons` renders it from the icon pack's centred logo into the ten PNGs of `resources/Tokkl.iconset`, which are committed. The build packs them into `Tokkl.icns` with `iconutil` and puts it in `Contents/Resources`, and `Info.plist` names it in `CFBundleIconFile`. The menu bar shows the same icon at 16 points. The build compiles `icon_16x16.png` and `icon_16x16@2x.png` into the app as Qt resources. The monochrome menu bar icon is the pack's outline logo, `resources/mono_16x16.png` and `mono_16x16@2x.png`, which the build also compiles in and the menu bar tints with its text colour.

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

It copies the bundle, adds Qt and QtKeychain with `macdeployqt`, signs every binary ad hoc, checks that the copy loads no library from outside the bundle or the system, and packages it with a link to `/Applications`. `check-dmg.sh` mounts the DMG, checks the version, the icon, the four alarm sounds and the signature, and starts the app from it for ten seconds. `--identity <identity>` signs with a certificate instead.

The build signs the bundle ad hoc. An ad hoc signature changes with every build, so the Keychain may ask for access again after a rebuild. Pass `-DTOKKL_CODESIGN_IDENTITY=<identity>` to sign with a certificate from your keychain instead.

## Layout and tests

- `src/menubarapp.*`, `statusmenu.*`, `statuswords.*`, `projectindicator.*`, `statusimage.*` and `settingswindow.*` are the app without its platform layer. They need only Qt Widgets and the core, so they build and are tested on Linux as well. `statusimage.*` puts the logo and then the project indicator in the menu bar item's image and sets their sizes.
- `src/keychaincredentialstore.*` stores secrets through QtKeychain. It builds wherever QtKeychain is installed.
- `src/pomodoroalarm.*` decides what the alarm plays: the sound chosen for the ringing transition, from the WAVs in the bundle, looped on an `AlarmPlayer` (`alarmplayer.h`) while the session rings. The settings window previews through the same player. The tests use a fake player and point the alarm at `desktop/core/sounds`.
- `src/macstatusitem.mm`, `macloginitem.mm`, `macalarmplayer.mm` and `main.mm` are the macOS layer. They hold the NSStatusItem and the drawing of its logo and project indicator, the SMAppService login item, the NSSound alarm player and the wiring. The app does not use `QSystemTrayIcon` because it cannot show text. Its API has an icon and a tooltip only, and Qt's Cocoa backend sets only the status button's image. The alarm uses NSSound rather than Qt Multimedia so the DMG and the CI job need no further module or plugins; `alarmplayer.h` gives the reasons.

On a machine without macOS, the same commands build no app but run the tests: `menubarapp`, `infoplist`, the core's tests, and `keychaincredentialstore` when QtKeychain is installed. The `macos` CI job builds and tests the app on `macos-latest` with a pinned Qt from the Qt installer and a pinned QtKeychain built from source, both set up by `.github/actions/macos-build`. It then packages and checks a DMG with the two scripts. The release waits for it.

## Releases

semantic-release decides the version on the Linux runner of the `release` job, and the app builds only on macOS. After the release job has tagged `v<version>` and created the GitHub release, the `macos-release` job builds the app from that tag with `-DTOKKL_VERSION=<version>`. It checks that the tag's `package.json` has that version, so the bundle's `CFBundleVersion` is the release version. It then runs `package-dmg.sh` and `check-dmg.sh`. The `macos-publish` job attaches `Tokkl-<version>-arm64.dmg` to the release with `gh release upload`. It is a separate Linux job so that the job that builds QtKeychain and the app never holds a token that can write to the repository. The release needs no Apple certificate, password or other secret.

Until `macos-publish` finishes, the release has no DMG. If either job fails, re-run the failed jobs of that workflow run. The upload uses `--clobber`, so it replaces a DMG of the same name.

Apple silicon runs no native code without a signature, but an ad hoc one is enough ([macOS Big Sur 11.0.1 Universal Apps Release Notes](https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes), Code Signing). `macdeployqt` changes the binaries it copies and links, which breaks the signature the linker made, so it signs them again, ad hoc by default ([Qt for macOS - Deployment](https://doc.qt.io/qt-6/macos-deployment.html)). Gatekeeper still rejects an ad hoc signature on a downloaded app, hence the `xattr` step.
