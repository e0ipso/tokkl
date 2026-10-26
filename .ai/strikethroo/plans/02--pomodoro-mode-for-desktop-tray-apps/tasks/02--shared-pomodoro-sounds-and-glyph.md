---
id: 2
group: "core-pomodoro"
dependencies: [1]
status: "completed"
created: 2026-10-26
skills:
  - cmake
  - cpp-qt
complexity_score: 4
execution_profile: "standard-implementation"
---
# Shared Pomodoro sounds, sound catalogue and hourglass glyph

## Objective
Give the KDE, GNOME and macOS builds one source for the four alarm sounds and the hourglass glyph, plus a core catalogue of the sound ids, their labels and the default sound for each transition. A test checks the sounds against the SHA-256 sums in `docs/sounds/README.md`.

## Skills Required
CMake to expose the sound files to the platform projects, and a small amount of Qt Core C++ for the catalogue and the checksum test. The glyph is a hand-written SVG plus ImageMagick renders.

## Acceptance Criteria
- [ ] A Qt-Core-only catalogue in `desktop/core/src` (for example `pomodorosounds.h/.cpp`) lists the four sound ids `work-to-short-rest`, `short-rest-to-work`, `work-to-long-rest` and `long-rest-to-work`, a label for each, and the file name `pomodoro-<id>.wav`. It has `defaultSound(TransitionKind)`, which returns the id with the same name, and `isSoundId(QString)`.
- [ ] The core CMake project sets a variable, for example `TOKKL_POMODORO_SOUND_FILES`, with the absolute paths of the four WAVs. The KDE, GNOME and macOS projects, which `add_subdirectory` the core, can install them from it.
- [ ] The WAVs are read from `packages/web/public/sounds` when every packaging build can reach that directory: the KDE DEB and RPM container builds, the GNOME DEB and RPM container builds, and the macOS DMG build. When one of them cannot, the four files are copied byte for byte into `desktop/core/sounds/` and the variable points there. Record the choice and the reason in a comment next to the variable.
- [ ] A new CTest test (for example `pomodorosounds`) reads `docs/sounds/README.md`, finds the SHA-256 sum given for each file name, and checks that the file the variable names has that sum and starts with `RIFF....WAVE`. It fails when the README, a file or a sum is missing.
- [ ] An hourglass glyph exists as one SVG master, for example `desktop/core/assets/hourglass.svg`, in a monochrome version and a colour version that sits well next to the colour logo. Each platform gets its copy where its package picks it up:
  - KDE: `desktop/kde/package/contents/images/` (colour, plus a single-colour version QML can tint).
  - GNOME: `desktop/gnome/extension/` (colour, plus `hourglass-symbolic.svg`, which GNOME Shell recolours).
  - macOS: `desktop/macos/resources/` as 16 pt PNGs at 1x and 2x, colour and template (black on transparent).
- [ ] A test checks that each platform's SVG copy is byte-identical to the master, and that the macOS PNGs are RGBA PNGs of 16×16 and 32×32.
- [ ] `desktop/core/ci/check.sh` exits 0 with the new tests listed as passed.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Sound labels describe the sound, using `docs/sounds/README.md`: "Two falling notes", "Three rising notes", "Four slow falling notes", "Fast high run". Keep the order of the ids above.
- `QCryptographicHash::Sha256` is in Qt Core, so the checksum test needs no new dependency.
- The SVG must render at 16 px without blur: whole-pixel geometry on a 16×16 viewBox, no text, no filters.
- Brand images come from `npm run icons` (`scripts/icons.ts`), and the brand packs in `docs/brand` are never edited. The glyph is not a brand image, so keep it out of `docs/brand` and out of `scripts/icons.ts`.
- Never put plan or ticket references in code, comments, file names or test names.

## Input Dependencies
- Task 1: `TransitionKind` for `defaultSound`.

## Output Artifacts
- The sound catalogue and `TOKKL_POMODORO_SOUND_FILES`, used by the KDE backend (task 6), tokkl-timerd playback (task 10) and the macOS alarm (task 14). The settings panes (tasks 8, 12, 14) list the catalogue's labels.
- The hourglass glyph files, used by the KDE panel (task 7), the GNOME indicator (task 11) and the macOS menu bar item (task 13).

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Find out whether packaging builds can reach `packages/web/public/sounds`.
   - Read `desktop/kde/scripts/container-check.sh`, `desktop/kde/debian/rules`, `desktop/kde/packaging/rpm/tokkl-kde.spec`, `desktop/gnome/scripts/container-check.sh`, `desktop/gnome/debian/rules`, `desktop/gnome/packaging/rpm/tokkl-timerd.spec` and `desktop/macos/scripts/package-dmg.sh`.
   - Check what each build copies or mounts. The macOS CMake project already finds the core through `TOKKL_CORE_DIR` (`desktop/macos/CMakeLists.txt`); see how the KDE and GNOME projects do the same.
   - If any build works from a source tree without `packages/`, copy the WAVs into `desktop/core/sounds/` (`cp packages/web/public/sounds/pomodoro-*.wav desktop/core/sounds/`) and point the variable there. `sha256sum` the copies and compare with the README.
2. Add the variable where the core's CMake runs, so `add_subdirectory(core)` callers see it. Use `PARENT_SCOPE` or a cache variable as the existing core CMake does for similar values.
3. Write the catalogue: a static table of `{id, label, fileName}` and the two functions. No QObject is needed. Add the files to `desktop/core/src/CMakeLists.txt`.
4. Checksum test: pass the README path and the file list to the test as compile definitions. In `docs/sounds/README.md`, each sound section names `packages/web/public/sounds/<file>` and then "SHA-256 \`<hex>\`". Match on the file name, not the directory, so the test also works for copies.
5. Glyph.
   - Draw a simple hourglass, two triangles meeting at the waist inside a top and a bottom bar, on a 16×16 viewBox.
   - For the colour version, sample the logo's main colour from `desktop/kde/package/contents/images/tokkl.png` (for example `magick tokkl.png -resize 1x1 txt:` or a histogram) and write the hex value into a comment in the SVG.
   - Render the macOS PNGs with ImageMagick (`magick -background none -density 384 hourglass.svg -resize 32x32 png32:hourglass@2x.png`, then 16×16). Name them after the existing `mono_16x16.png` pattern.
   - Put the byte-identity test in the same CTest test or a separate one. The repository is mounted at `/repo` in the core container.
6. Run `desktop/core/ci/check.sh` and confirm the tests pass.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once. The checksum and byte-identity checks guard against drift; do not test the catalogue table entry by entry.
</details>
