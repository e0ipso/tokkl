# kenkeep Index: tooling-and-project

↑ Parent: [kenkeep](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`gnome-shell-extension/`](gnome-shell-extension/index.md) for more information on the GNOME Shell extension in desktop/gnome/extension: its panel button and menu across Shell 46 to 51, project indicator, packaging, preferences and the two headless Shell CI harnesses; read before changing the extension, its supported Shell versions or its CI checks.
- Load [`kde-companion/`](kde-companion/index.md) for more information on the KDE Plasma companion and desktop/core: layout, timer and connection rules, native packages, CI and release; read before changing anything under desktop/ or the kde release job.
- Load [`macos-menu-bar-app/`](macos-menu-bar-app/index.md) for more information on the macOS menu bar app: portable library and shims, timer actions and settings, icon and status image, CI and DMG release; read when changing desktop/macos or its CI jobs.
- Load [`repo-and-scripts/`](repo-and-scripts/index.md) for more information on npm workspace layout, commit message rules, the Tokkl rename fallbacks, and the screenshot and icon scripts; read before adding a package or script, committing, or regenerating images.
- Load [`testing/`](testing/index.md) for more information on the Playwright e2e suite, visual baselines, what npm test and typecheck run, and the history bench; read before adding, running or debugging a test, spec or benchmark.

## Conventions (how we build)
- Open [**Run the GNOME extension Shell harness locally on one version only**](practice-run-the-gnome-extension-shell-harness-locally-on-one-version-only.md) to learn about: Run desktop/gnome/extension/ci/check.sh locally on one Shell version (50); the PR's gnome-extension CI matrix covers 46 to 51. #gnome #testing #ci #desktop
- Open [**Desktop app identifiers use the canpicasoft.com domain**](practice-desktop-app-identifiers-use-the-canpicasoft-com-domain.md) to learn about: KDE, macOS and GNOME identifiers use com.canpicasoft.tokkl / tokkl@canpicasoft.com, never com.github.e0ipso or e0ipso.github.com. #desktop #kde #macos #gnome #packaging
- Open [**Target Debian for Debian-family desktop packages, not niche distros**](practice-target-debian-for-debian-family-desktop-packages-not-niche-distros.md) to learn about: DEB builds for the desktop companions target stock Debian; niche distros like TUXEDO OS are not targets. Ubuntu is the fallback. #packaging #desktop #debian #linux

## Components (what exists)
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](map-gnome-timerd-d-bus-timer-service.md) to learn about: tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container. #tooling #desktop #gnome #ci
- Open [**Container image ghcr.io/e0ipso/tokkl**](map-container-image-ghcr-io-e0ipso-tokkl.md) to learn about: Multi-arch image built from the root Dockerfile and pushed by the CI release job when semantic-release tags; writes only to /data. #docker #release #ci #deployment
- Open [**Desktop Pomodoro alarm playback: one backend per platform**](map-desktop-pomodoro-alarm-playback-one-backend-per-platform.md) to learn about: KDE plays the alarm with QSoundEffect, tokkl-timerd with libpulse-simple, macOS with NSSound; the four WAVs come from desktop/core/sounds. #desktop #pomodoro #audio #kde #gnome

## By topic

### #desktop
- Open [**KDE panel: button, menu and project indicator**](kde-companion/plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](kde-companion/practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet, the applet Pomodoro store and the KDE wiring; QML_FOREIGN types; version and README.
### #gnome
- Open [**GNOME Shell extension panel button and menu**](gnome-shell-extension/map-gnome-shell-extension-panel-button-and-menu.md) — desktop/gnome/extension drives tokkl-timerd; Shell 46-51; click and key activation; Shell 50 click gesture; Shell 51 key controller
- Open [**GNOME Shell extension project indicator and chosen project label**](gnome-shell-extension/map-gnome-shell-extension-project-indicator-and-chosen-project-label.md) — projectindicator.js decides, indicator.js draws; pulse check lifts enable-animations; chosenProjectLabel falls back to ChosenProjectName
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
### #ci
- Open [**KDE real-server test**](kde-companion/kde-ci-and-release-pipeline/map-kde-real-server-test.md) — realservertest.cpp, driven by realserver.test.ts, runs the companion against fixture Tokkl servers behind proxies and checks the data.
- Open [**Release stages, KDE semantic-release plugin and GNOME assets**](kde-companion/kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md) — A push to main runs release-version, two kde-release legs, then release; the plugin gates on the manifests; GNOME assets upload after.
- Open [**Tests for release-only CI steps**](kde-companion/kde-ci-and-release-pipeline/map-tests-for-release-only-ci-steps.md) — release-publish.test.ts runs ci.yml's publish and version-check steps with a stub gh; other release-only KDE code has node:test files.
### #kde
- Open [**KDE panel: button, menu and project indicator**](kde-companion/plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](kde-companion/practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet, the applet Pomodoro store and the KDE wiring; QML_FOREIGN types; version and README.
### #packaging
- Open [**KDE native packaging: DEB, RPM and the version mapping**](kde-companion/map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](kde-companion/map-kde-release-upgrade-check-from-the-published-predecessor.md) — Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable.
- Open [**KDE and core CI jobs**](kde-companion/kde-ci-and-release-pipeline/map-kde-and-core-ci-jobs.md) — The kde job builds, tests and checks the DEB and RPM in pinned containers; core checks Qt Core-only links; baseline floors; manual checks.
### #audio
- Open [**Pomodoro sounds: FFmpeg recipes, same-origin files, WAV for loops**](../web-ui-behaviour/pomodoro/practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav.md) — Sounds in public/sounds are FFmpeg-generated with recipe and SHA-256 in docs/sounds; looping alarms are WAV, since MP3 padding breaks loops.
- Open [**Desktop Pomodoro alarm playback: one backend per platform**](map-desktop-pomodoro-alarm-playback-one-backend-per-platform.md) — KDE plays the alarm with QSoundEffect, tokkl-timerd with libpulse-simple, macOS with NSSound; the four WAVs come from desktop/core/sounds.
### #debian
- Open [**Target Debian for Debian-family desktop packages, not niche distros**](practice-target-debian-for-debian-family-desktop-packages-not-niche-distros.md) — DEB builds for the desktop companions target stock Debian; niche distros like TUXEDO OS are not targets. Ubuntu is the fallback.
### #deployment
- Open [**Container image ghcr.io/e0ipso/tokkl**](map-container-image-ghcr-io-e0ipso-tokkl.md) — Multi-arch image built from the root Dockerfile and pushed by the CI release job when semantic-release tags; writes only to /data.
- Open [**Keep TrueNAS install steps out of the repo README**](repo-and-scripts/practice-keep-truenas-install-steps-out-of-the-repo-readme.md) — The README documents generic Docker use only. Install steps for TrueNAS or other NAS admin screens stay out of the repo.
### #docker
- Open [**KDE CI dependency images: image-id.sh identity, Actions cache, weekly refresh**](kde-companion/map-kde-ci-dependency-image-cache.md) — container-check.sh reuses images labelled with image-id.sh's hash; CI caches them per format and rebuilds them weekly or after gh cache delete.
- Open [**Container image ghcr.io/e0ipso/tokkl**](map-container-image-ghcr-io-e0ipso-tokkl.md) — Multi-arch image built from the root Dockerfile and pushed by the CI release job when semantic-release tags; writes only to /data.
### #linux
- Open [**Target Debian for Debian-family desktop packages, not niche distros**](practice-target-debian-for-debian-family-desktop-packages-not-niche-distros.md) — DEB builds for the desktop companions target stock Debian; niche distros like TUXEDO OS are not targets. Ubuntu is the fallback.
### #macos
- Open [**macOS bundle icon and NSStatusItem status image**](macos-menu-bar-app/map-macos-bundle-icon-and-nsstatusitem-status-image.md) — Tokkl.iconset to Tokkl.icns via iconutil; ProjectIndicator, StatusImage and macstatusitem.mm drawing; why NSStatusItem
- Open [**macOS menu bar timer actions and Settings window save**](macos-menu-bar-app/map-macos-menu-bar-timer-actions-and-settings-window-save.md) — click toggles, Start/Stop Timer menu action, server-owned pause and Pomodoro state, two-step Keychain save in Settings
- Open [**macOS app layout: portable Qt library and native shims**](macos-menu-bar-app/map-macos-app-layout-portable-qt-library-and-native-shims.md) — Tokkl.app on tokklcore: standalone CMake, LSUIElement, macOS 13; Linux-testable src/ library and the three .mm shims
### #pomodoro
- Open [**Web timer actions: send the seen revision, adopt the reply, fields read-only while paused**](../web-ui-behaviour/time-and-timers/practice-web-timer-actions-send-the-seen-revision-and-pause-fields-are-read-only.md) — Pause, Resume, Stop while paused and session actions post to the server; a 409 carries the current state; the bar edits nothing while paused.
- Open [**Web timer state: one stream per tab, server-corrected clock and Pomodoro views**](../web-ui-behaviour/pomodoro/map-web-timer-state-stream-and-pomodoro-session-views.md) — TimerStateProvider opens the SSE stream; PomodoroSessionProvider only views the server's session, rings and notifies; nothing is kept in localStorage.
- Open [**Web notifications: phaseNotification.ts and the Allow notifications button**](../web-ui-behaviour/pomodoro/map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md) — notificationAccess and AllowNotifications; notifyInBackground for long-timer reminders, notifySessionPhaseEnd for Pomodoro sessions.
### #release
- Open [**Release stages, KDE semantic-release plugin and GNOME assets**](kde-companion/kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md) — A push to main runs release-version, two kde-release legs, then release; the plugin gates on the manifests; GNOME assets upload after.
- Open [**KDE native packaging: DEB, RPM and the version mapping**](kde-companion/map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**KDE release upgrade check: previous-package.sh and --previous-package**](kde-companion/map-kde-release-upgrade-check-from-the-published-predecessor.md) — Release legs upgrade from the newest older published tokkl-kde asset, checked by size and SHA-256, or from a 0.0.0 build when none is usable.
### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #tooling
- Open [**Release stages, KDE semantic-release plugin and GNOME assets**](kde-companion/kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md) — A push to main runs release-version, two kde-release legs, then release; the plugin gates on the manifests; GNOME assets upload after.
- Open [**KDE and core CI jobs**](kde-companion/kde-ci-and-release-pipeline/map-kde-and-core-ci-jobs.md) — The kde job builds, tests and checks the DEB and RPM in pinned containers; core checks Qt Core-only links; baseline floors; manual checks.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet, the applet Pomodoro store and the KDE wiring; QML_FOREIGN types; version and README.