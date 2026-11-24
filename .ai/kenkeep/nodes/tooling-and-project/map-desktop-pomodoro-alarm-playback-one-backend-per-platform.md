---
type: map
title: 'Desktop Pomodoro alarm playback: one backend per platform'
description: >-
  KDE plays the alarm with QSoundEffect, tokkl-timerd with libpulse-simple,
  macOS with NSSound; the four WAVs come from desktop/core/sounds.
tags:
  - desktop
  - pomodoro
  - audio
  - kde
  - gnome
kk_schema_version: 3
kk_id: map-desktop-pomodoro-alarm-playback-one-backend-per-platform
kk_derived_from:
  - '379941d5-dedc-4c27-8c6e-544c94d411c6:map:0'
kk_relates_to:
  - map-gnome-timerd-d-bus-timer-service
  - map-macos-menu-bar-app
  - map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types
  - map-kde-native-packaging
  - >-
    practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav
kk_depends_on: []
kk_confidence: high
---
The desktop apps play the Pomodoro alarm and sound previews themselves, each with its own backend. The four transition WAVs live in `desktop/core/sounds/`; `desktop/core/CMakeLists.txt` sets `TOKKL_POMODORO_SOUND_FILES` in the parent scope, and each platform installs or bundles that list (the KDE package's `contents/sounds/`, `/usr/share/tokkl-timerd/sounds` for GNOME, `Contents/Resources/sounds` in the macOS bundle). Which file plays, loop versus stop, and previews are decided in portable code that the tests drive through a fake.

- **KDE** (`desktop/kde/src/alarmplayer.{h,cpp}`): Qt Multimedia `QSoundEffect`. Each ring and each preview gets its own effect, which is stopped and `deleteLater()`-ed when it ends. In Qt 6.10 a stopped `QSoundEffect` leaves a paused (corked) stream on the sound server until the last effect sharing the audio engine is destroyed, so a long-lived effect keeps a stream open after Next phase or a preview.
- **GNOME** (`desktop/gnome/src/pulsealarmbackend.h`, behind the core's `AlarmOutput` in `desktop/core/src/alarmoutput.h`): libpulse's simple API, which PipeWire serves through pipewire-pulse. Qt Multimedia is ruled out because it links Qt Gui, and `tokkl-timerd` may load only Qt Core, Network and DBus (`ci/check.sh` fails the build otherwise); GStreamer needs several plugin sets for one buffer of samples. The alarm loop and the preview are separate streams that connect only while a sound plays. A missing sound server is logged and the service keeps running silent.
- **macOS** (`desktop/macos/src/macalarmplayer.mm`): AppKit `NSSound` with `loops`. Qt Multimedia is not used because it would add a backend plugin and FFmpeg dylibs to the DMG and its dev files are not on the Linux hosts where the portable tests run.

A silent alarm reaches the user. The core's `AlarmOutput` takes a failure handler, and its implementations call `reportFailure()`; `PomodoroAlarm` sets the handler and keeps `failure()` ("No alarm sound: ..."), also for a sound file missing from the directory, until the next ring or preview starts. macOS shows it as the menu's message line and under the sounds in Settings; `MacAlarmPlayer` reports a file `NSSound` cannot open and a `play` that returns NO. `PulseAlarmBackend` reports what it sends through `errorOccurred`, and `tokkl-timerd` publishes it as `AlarmError`. The KDE `AlarmPlayer` is not an `AlarmOutput`; it keeps its own `error` (a missing file, or a `QSoundEffect` Error status), which `StatusText.messageText` shows after the other messages and `configPomodoro.qml` shows under the sounds.

When changing this, verify the KDE `alarmplayertest` cases that check a stopped ring or preview releases its effect, and that no stream from the process remains in `pactl list sink-inputs` after Next phase or a finished preview.

<!-- kk:related:start -->
# Related

- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-activation-and-packaging](gnome-timer-service/map-gnome-timer-service-activation-and-packaging.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-org-tokkl-timer1-interface-file-members-and-interfaceversion](gnome-timer-service/timer1-d-bus-contract/map-org-tokkl-timer1-interface-file-members-and-interfaceversion.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-actions-presentation-status-and-alarmerror-properties](gnome-timer-service/timer1-d-bus-contract/map-timer1-actions-presentation-status-and-alarmerror-properties.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-methods-requests-refreshprojects-configure-and-activate](gnome-timer-service/timer1-d-bus-contract/map-timer1-methods-requests-refreshprojects-configure-and-activate.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-propertieschanged-publication-from-timerservice](gnome-timer-service/timer1-d-bus-contract/map-timer1-propertieschanged-publication-from-timerservice.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-timer-project-and-pomodoro-limit-properties](gnome-timer-service/timer1-d-bus-contract/map-timer1-timer-project-and-pomodoro-limit-properties.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-tokkl-timerd-daemon-composition-root-and-secret-storage](gnome-timer-service/timer1-d-bus-contract/map-tokkl-timerd-daemon-composition-root-and-secret-storage.md)
- Related: [map-macos-menu-bar-app → map-macos-app-layout-portable-qt-library-and-native-shims](macos-menu-bar-app/map-macos-app-layout-portable-qt-library-and-native-shims.md)
- Related: [map-macos-menu-bar-app → map-macos-bundle-icon-and-nsstatusitem-status-image](macos-menu-bar-app/map-macos-bundle-icon-and-nsstatusitem-status-image.md)
- Related: [map-macos-menu-bar-app → map-macos-ci-job-and-dmg-release-publishing](macos-menu-bar-app/map-macos-ci-job-and-dmg-release-publishing.md)
- Related: [map-macos-menu-bar-app → map-macos-menu-bar-timer-actions-and-settings-window-save](macos-menu-bar-app/map-macos-menu-bar-timer-actions-and-settings-window-save.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types → map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions](kde-companion/plasma-companion/desktop-cmake-projects/map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types → map-desktop-kde-readme-guide-prd-scope-and-release-assets](kde-companion/plasma-companion/desktop-cmake-projects/map-desktop-kde-readme-guide-prd-scope-and-release-assets.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types → map-desktop-version-resolution-and-plasma-metadata-stamping](kde-companion/plasma-companion/desktop-cmake-projects/map-desktop-version-resolution-and-plasma-metadata-stamping.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types → map-kde-qml-foreign-types-and-backend-module-linking](kde-companion/plasma-companion/desktop-cmake-projects/map-kde-qml-foreign-types-and-backend-module-linking.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types → map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core](kde-companion/plasma-companion/desktop-cmake-projects/map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types → map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name](kde-companion/plasma-companion/desktop-cmake-projects/map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md)
- Related: [map-kde-native-packaging](kde-companion/map-kde-native-packaging.md)
- Related: [practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav](../web-ui-behaviour/pomodoro/practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 379941d5-dedc-4c27-8c6e-544c94d411c6:map:0
<!-- kk:citations:end -->
