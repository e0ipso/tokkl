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
- **GNOME** (`desktop/gnome/src/pulsealarmbackend.h`, behind `AlarmBackend`): libpulse's simple API, which PipeWire serves through pipewire-pulse. Qt Multimedia is ruled out because it links Qt Gui, and `tokkl-timerd` may load only Qt Core, Network and DBus (`ci/check.sh` fails the build otherwise); GStreamer needs several plugin sets for one buffer of samples. The alarm loop and the preview are separate streams that connect only while a sound plays. A missing sound server is logged and the service keeps running silent.
- **macOS** (`desktop/macos/src/macalarmplayer.mm`): AppKit `NSSound` with `loops`. Qt Multimedia is not used because it would add a backend plugin and FFmpeg dylibs to the DMG and its dev files are not on the Linux hosts where the portable tests run.

When changing this, verify the KDE `alarmplayertest` cases that check a stopped ring or preview releases its effect, and that no stream from the process remains in `pactl list sink-inputs` after Next phase or a finished preview.

<!-- kk:related:start -->
# Related

- Related: [map-gnome-timerd-d-bus-timer-service](map-gnome-timerd-d-bus-timer-service.md)
- Related: [map-macos-menu-bar-app → map-macos-app-layout-portable-qt-library-and-native-shims](macos-menu-bar-app/map-macos-app-layout-portable-qt-library-and-native-shims.md)
- Related: [map-macos-menu-bar-app → map-macos-bundle-icon-and-nsstatusitem-status-image](macos-menu-bar-app/map-macos-bundle-icon-and-nsstatusitem-status-image.md)
- Related: [map-macos-menu-bar-app → map-macos-ci-job-and-dmg-release-publishing](macos-menu-bar-app/map-macos-ci-job-and-dmg-release-publishing.md)
- Related: [map-macos-menu-bar-app → map-macos-menu-bar-timer-actions-and-settings-window-save](macos-menu-bar-app/map-macos-menu-bar-timer-actions-and-settings-window-save.md)
- Related: [map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types](kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md)
- Related: [map-kde-native-packaging](kde-companion/map-kde-native-packaging.md)
- Related: [practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav](../web-ui-behaviour/pomodoro/practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 379941d5-dedc-4c27-8c6e-544c94d411c6:map:0
<!-- kk:citations:end -->
