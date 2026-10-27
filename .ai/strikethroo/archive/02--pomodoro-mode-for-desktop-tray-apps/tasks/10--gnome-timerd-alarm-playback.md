---
id: 10
group: "gnome-pomodoro"
dependencies: [2, 9]
status: "completed"
created: 2026-10-26
skills:
  - cpp-qt
  - linux-packaging
complexity_score: 5
execution_profile: "complex-architecture"
---
# tokkl-timerd: alarm playback and packaging

## Objective
Play the alarm from `tokkl-timerd`, so it works whatever state the Shell extension is in. Loop the chosen sound while `Ringing` is true, play a sound once on `PreviewSound`, install the four WAVs, and add the audio dependency to the DEB, the RPM and the GNOME CI container.

## Skills Required
C++ with Qt 6 for the player in a headless service, and Linux packaging (CMake install rules, `debian/control`, the RPM spec, the container scripts).

## Acceptance Criteria
- [ ] A player class in `desktop/gnome/src` connects to `TimerService`'s ringing state and preview signal from task 9. It loops the sound chosen for `RingingTransition` while ringing, stops when ringing ends, and plays a preview once.
- [ ] The backend behind the player is chosen, with evidence, among Qt Multimedia `QSoundEffect` under `QCoreApplication`, a GStreamer pipeline, or a PipeWire or PulseAudio client, and the choice is explained in the class comment. It must loop without an audible gap and must work from the user service with no display.
- [ ] If no backend works in the service, stop and report. The plan's fallback moves playback into the Shell extension, which is a change of scope for the user to approve.
- [ ] The player sits behind a small interface, so `timerservicetest` or a new test can use a fake. A test checks: start on ringing with the right file per transition and per sound choice; stop on Next phase and on End session; preview once.
- [ ] The four WAVs from `TOKKL_POMODORO_SOUND_FILES` are installed under the service's data directory (for example `${CMAKE_INSTALL_DATADIR}/tokkl-timerd/sounds`), and the player finds them there.
- [ ] `desktop/gnome/debian/control`, `desktop/gnome/packaging/rpm/tokkl-timerd.spec` and the container used by `desktop/gnome/ci/check.sh` and `desktop/gnome/scripts/container-check.sh` carry the new build and runtime dependencies. `desktop/gnome/scripts/check-package.sh` checks that the sounds are in the package.
- [ ] `desktop/gnome/ci/check.sh` exits 0, and `desktop/gnome/scripts/container-check.sh --version "$(jq -r .version package.json)" --output <dir>` builds and checks both packages.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- The service is activated by D-Bus and runs as a systemd user unit (`desktop/gnome/dbus/tokkl-timerd.service.in`). It has no display, so no Qt Gui platform plugin may be required at runtime.
- Target stock Debian and Fedora 44 package names.
- Manual check, recorded in the task's output: run the service against a local server, let a phase ring, run `pactl list sink-inputs`, and see a stream from `tokkl-timerd`, which goes away after `NextPhase`.
- Never put plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 2: `TOKKL_POMODORO_SOUND_FILES` and the catalogue.
- Task 9: `TimerService`'s ringing state, sound choices and preview signal.

## Output Artifacts
- Audible alarms and previews on GNOME. The prefs Preview button (task 12) depends on this.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Prototype first. Write a ten-line test program in the GNOME CI container that loops one WAV with each candidate backend under `QCoreApplication`, and listen on the host (or check `pactl list sink-inputs`). `QSoundEffect` needs `Qt6::Multimedia`. Check whether loading it without a `QGuiApplication` works and whether it pulls Qt Gui as a hard runtime need.
2. Pick the backend that works with the fewest new packages. If you use GStreamer, `playbin` with `about-to-finish` re-queueing the same URI gives a seamless loop.
3. Interface, for example `class AlarmBackend { virtual void loop(const QString &file) = 0; virtual void playOnce(const QString &file) = 0; virtual void stop() = 0; }`. The player maps transition to sound id to file through the catalogue and the service's `Sounds` choices.
4. Install the WAVs in `desktop/gnome/src/CMakeLists.txt` or the top-level `CMakeLists.txt`. Give the player the install path through a compile definition with `CMAKE_INSTALL_FULL_DATADIR`, and let tests override it.
5. Packaging: add build and runtime dependencies to both formats and the CI images. Read `desktop/gnome/scripts/check-package.sh` and add the sound file checks next to its existing file checks.
6. Run both scripts and the manual `pactl` check.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once. Do not test that the backend makes sound in CI; test what the player asks the backend to do.
</details>

## Output

Backend: libpulse's simple API (`libpulse-simple`), in `desktop/gnome/src/pulsealarmbackend.cpp` behind `AlarmBackend` (`alarmbackend.h`), driven by `AlarmPlayer` (`alarmplayer.cpp`). Packages: Debian 13 `libpulse-dev` + `pkgconf` to build, `libpulse0` at runtime through shlibs; Fedora 44 `pkgconfig(libpulse-simple)` (`pulseaudio-libs-devel`) to build, `pulseaudio-libs` at runtime through the automatic soname requires. PipeWire serves the protocol on GNOME (`pipewire-pulse`).

Ruled out: Qt Multimedia links Qt Gui on both targets (Fedora 44 `readelf -d libQt6Multimedia.so.6` lists libQt6Gui; Debian 13 `libqt6multimedia6` depends on libqt6gui6, libqt6quick6, libegl1, libx11-6), which `ci/check.sh` forbids for the headless service. GStreamer would need the core plus the base and good plugin sets for one buffer of PCM.

Manual check (Fedora 44 container, `pulseaudio` with `module-null-sink`, the built `tokkl-timerd` on a private bus against a stand-in instance with one-minute lengths, 2026-10-26):

- `PreviewSound work-to-short-rest`: `pactl list sink-inputs` shows one input, `media.name = "Sound preview"`, `application.name = "tokkl-timerd"`, `s16le 1ch 22050Hz`; none five seconds later.
- At the planned end `Ringing` is true and `pactl` shows `media.name = "Pomodoro alarm"` from `tokkl-timerd`; six seconds later (the clip is two seconds) it is still there, so the loop holds.
- After `NextPhase`, `Ringing` is false and the sink input is gone within one second.
- With `PULSE_SERVER` pointing at a missing socket the service keeps running and reports `Connection refused` (the `pulsebackend` test).
