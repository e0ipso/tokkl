---
id: 8
group: "kde-pomodoro"
dependencies: [6]
status: "completed"
created: 2026-10-26
skills:
  - qml
  - kirigami
complexity_score: 5
execution_profile: "standard-implementation"
---
# KDE Pomodoro settings page

## Objective
Add a "Pomodoro" page to the plasmoid's configuration dialog. It edits the four shared lengths, which are saved to the server, and the sound for each transition, which is saved in the widget's configuration, with a Preview button for each sound.

## Skills Required
QML with Kirigami and KCMUtils for the page, and Qt Quick Test for `autotests/qml/tst_configure.qml`.

## Acceptance Criteria
- [x] `desktop/kde/package/contents/config/config.qml` has a second `ConfigCategory` named "Pomodoro" with a fitting Breeze icon, whose source is a new `configPomodoro.qml`.
- [x] The page shows four number fields, "Work", "Short rest", "Long rest" (minutes) and "Long rest every" (pomodoros), with ranges 1–180, 1–60, 1–60 and 1–12. It loads them from `TokklPomodoroPreferences` and calls its `refresh()` when the page opens.
- [x] Apply posts the changed lengths through `save()`. A server error appears next to its field, and the dialog stays changed (`configurationChanged()`), as the page already does for a refused secret.
- [x] Without a validated account the four fields are read-only, show the cached values, and a note says the lengths need a connection to the Tokkl server.
- [x] Four sound pickers, one per transition ("Work → short rest", "Short rest → work", "Work → long rest", "Long rest → work"), list the catalogue's four labels and are bound to the four `cfg_` sound entries from task 6. Each has a Preview button that plays the selected sound once through the alarm player.
- [x] `desktop/kde/autotests/qml/tst_configure.qml` covers: values loaded from the server; Apply posting only a changed key; a 400 shown on its field; read-only fields when disconnected; a sound choice changing its `cfg_` property; and Preview calling the player.
- [x] `desktop/kde/scripts/container-check.sh` passes for the Debian 13 leg with the new tests passed.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Plasma saves every `cfg_` property on Apply and calls `saveConfig()` if the page defines it. See `configGeneral.qml`.
- A configuration page does not run inside the panel item. Find out whether it can reach the widget's live objects. If it cannot, create a `TokklConnection` from the saved instance URL, sign-in method and email (as `configGeneral.qml` builds `TokklConnectionSetup`), and a `TokklPomodoroPreferences` and `TokklPomodoroStore` on it, so the page has its own connection to the same account.
- Previews need a player in the page. Create one `TokklAlarm` in the page if it cannot reach the panel's.
- Never put plan or ticket references in code, comments or test names.

## Input Dependencies
- Task 6: `TokklPomodoroPreferences`, `TokklPomodoroStore`, `TokklAlarm`, the sound catalogue and the four sound entries in `main.xml`. The preferences client itself comes from task 3.

## Output Artifacts
- The KDE settings page that the plan's self-validation step 7 uses.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read `configGeneral.qml` and `tst_configure.qml` in full, and the `WalletFixture` in `desktop/kde/autotests/panelquicktest.cpp`.
2. Lay the page out with `Kirigami.FormLayout`: a section header "Lengths" with the four `QQC2.SpinBox` fields, then a header "Sounds" with four rows, each a `QQC2.ComboBox` and a `QQC2.Button` labelled "Preview".
3. Lengths are not `cfg_` properties, because they live on the server. Keep them in page properties loaded from the preferences object. Emit `configurationChanged()` when one changes so Apply turns on. In `saveConfig()`, call `save()` with the four values.
4. Show per-field errors with a `Kirigami.InlineMessage` or a small label under the field. Keep the field's typed value.
5. Sounds are plain `cfg_soundWorkToShortRest`-style string properties (use the names chosen in task 6). Map the combo index to the catalogue's sound id.
6. Extend `tst_configure.qml`, or add `tst_configurePomodoro.qml` registered the same way, with the fixture's scripted transport answering `/me/preferences`.
7. Run the Debian container check.

Test philosophy: write a few tests, mostly integration. Test custom logic, critical workflows, data transformations, edge cases and error conditions in core behaviour, and integration points. Do not test third-party library or framework behaviour, simple CRUD, trivial getters and setters, static configuration, or obvious behaviour that would break at once.
</details>

### Follow-up: cached lengths without a connection
Offline the page showed 25/5/15/4. Its own connection never learns the account, and the panel's cache is keyed by account, so the page had nothing to read.
- `package/contents/config/main.xml` has four Int entries, `cachedWorkMinutes`, `cachedShortRestMinutes`, `cachedLongRestMinutes` and `cachedLongRestEvery`, with the server's defaults.
- `package/contents/ui/PomodoroLengthsCache.qml`, created in `main.qml`, copies the panel's `TokklPomodoro.preferences` lengths into them and calls `writeConfig()`, but only while the panel's connection knows the account. An offline start therefore keeps what an earlier run stored.
- `configPomodoro.qml` reads them as `cfg_cached*` and shows them read-only until its own connection has answered `/me/preferences` (`lengthsRead`). Editing and Apply wait for that read too, so Apply never posts cached values measured against the defaults.
- Dirty state and feedback: The `AppletConfiguration.qml` of Debian 13's plasma-desktop 6.3.6 turns Apply on only for the page's `cfg_*Changed` signals and `configurationChanged`. The page never assigns its `cfg_cached*` and the panel writes only the settings, so neither marks the dialog dirty. Apply writes the page's opening values back; the cache sees the change, writes the panel's values once and stops, since it writes only values that differ.
- Tests: `test_unreachableServerShowsTheCachedLengths` and a reworked `test_loadsLengthsFromServer` in `tst_configure.qml`; `test_lengthsCacheKeepsTheAccountsLastKnownLengths` in `tst_panel.qml`; `smokeload` checks the four schema entries, that an offline panel keeps a stored value, and that a write to `Plasmoid.configuration` reaches the cache.
- Known limit: after switching to an account that never connects, the page shows the previous account's lengths until the new one connects.
