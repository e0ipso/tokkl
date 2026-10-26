---
id: 12
group: "gnome-pomodoro"
dependencies: [9]
status: "pending"
created: 2026-10-26
skills:
  - gjs
  - libadwaita
complexity_score: 4
execution_profile: "standard-implementation"
---
# GNOME preferences: Pomodoro group

## Objective
Add a "Pomodoro" group to the extension's preferences window. It edits the four shared lengths and the sound for each transition through `tokkl-timerd`, with a Preview button for each sound.

## Skills Required
GJS with libadwaita (`Adw.PreferencesGroup`, `Adw.SpinRow`, `Adw.ComboRow`) and Gio D-Bus calls.

## Acceptance Criteria
- [ ] `desktop/gnome/extension/prefs.js` has an `Adw.PreferencesGroup` titled "Pomodoro" with four `Adw.SpinRow`s, "Work", "Short rest", "Long rest" (minutes) and "Long rest every" (pomodoros), with ranges 1–180, 1–60, 1–60 and 1–12. They are filled from `PomodoroLengths` and refreshed with `RefreshPreferences` when the window opens.
- [ ] A "Save lengths" button calls `SetPomodoroLengths`. Errors from `PomodoroLengthErrors` appear on the matching row (subtitle and the `error` style class), and the typed values stay.
- [ ] While `PomodoroLengthsEditable` is false, the spin rows are insensitive, show the cached values, and the group description says the lengths need a connection to the Tokkl server.
- [ ] Four `Adw.ComboRow`s, "Work → short rest", "Short rest → work", "Work → long rest" and "Long rest → work", list the labels from `SoundChoices`, show the choice from `Sounds`, and call `SetSound` on change. Each row has a Preview button suffix that calls `PreviewSound` with the selected id.
- [ ] `desktop/gnome/extension/ci/prefs-check.js` covers: values loaded; Save calling `SetPomodoroLengths` with the edited values; an error shown on its row; the read-only state; a sound change calling `SetSound`; and Preview calling `PreviewSound`. `desktop/gnome/extension/ci/mock-timer.js` supports these calls.
- [ ] `desktop/gnome/extension/ci/check.sh 49` exits 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Preferences already talk to `tokkl-timerd` over D-Bus for `Configure`. Reuse that proxy setup.
- Keep the existing connection group as it is; add the new group after it on the same page.
- Never put plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 9: the length, sound and preview members of `org.tokkl.Timer1`.
- Task 10: actual playback, so Preview makes sound (soft dependency; the D-Bus call works without it).

## Output Artifacts
- The GNOME settings pane for Pomodoro.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `prefs.js` and `ci/prefs-check.js` in full.
2. Build the group in a helper function that takes the proxy, so `prefs-check.js` can drive it with the mock.
3. Subscribe to `g-properties-changed` on the proxy to refresh values, errors and the editable state.
4. For each combo row, use a `Gtk.StringList` of labels and keep a parallel array of ids. Add the Preview button with `row.add_suffix(button)` and give it `valign: Gtk.Align.CENTER`.
5. Run `desktop/gnome/extension/ci/check.sh 49`.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once.
</details>
