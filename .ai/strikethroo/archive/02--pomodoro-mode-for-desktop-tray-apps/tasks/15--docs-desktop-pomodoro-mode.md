---
id: 15
group: "docs"
dependencies: [2, 7, 8, 10, 11, 12, 13, 14]
status: "completed"
created: 2026-10-26
skills:
  - technical-writing
complexity_score: 3
execution_profile: "docs-and-config"
---
# Document Pomodoro mode in the PRD and the desktop READMEs

## Objective
Update the product requirements and the three desktop READMEs so they describe Pomodoro mode as built, and record the desktop use of the sounds.

## Skills Required
Technical writing in Markdown.

## Acceptance Criteria
- [ ] `docs/PRD.md`: rows C6, C7 and C8 list Pomodoro mode. T13 notes that the desktop companions use the shared lengths with no per-session override and let the user pick a sound per transition.
- [ ] `desktop/kde/README.md`, `desktop/gnome/README.md` and `desktop/macos/README.md` each describe:
  - Pomodoro mode and how to switch it (the menu item and its lock);
  - left-click in each mode;
  - the hourglass and the countdown;
  - the settings for lengths and sounds;
  - any new runtime dependency.
  The KDE README's manual checklist gains the Pomodoro steps.
- [ ] `docs/sounds/README.md` records where the desktop apps use the sounds and, if copies were made in task 2, where they are and that their sums match.
- [ ] `AGENTS.md` and the kenkeep nodes are unchanged.
- [ ] `npm run check:tracker-refs` exits 0, and `git diff --stat` shows only the five files above.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- READMEs describe the current project, never its history: no "now supports", no "new in".
- No plan or ticket references in published docs.
- Match each README's heading levels and voice.

## Input Dependencies
- The built behaviour from tasks 7, 8 and 10–14, and the sound location decided in task 2.

## Output Artifacts
- Updated `docs/PRD.md`, three desktop READMEs and `docs/sounds/README.md`.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Read each target file in full, and the kenkeep node `.ai/kenkeep/nodes/tooling-and-project/repo-and-scripts/practice-readme-describes-the-current-project-never-its-history.md`.
2. Read the merged code of the platform tasks (menu labels, settings labels, dependency names) and copy names from it exactly. Do not describe behaviour from the plan that the code does not have.
3. In `docs/PRD.md`, find rows C6–C8 and T13 with `grep -n "^| C6\|^| C7\|^| C8\|T13" docs/PRD.md` and edit them in place.
4. Add the KDE checklist steps in the same form as the existing ones: switch to Pomodoro mode, start a session, see the glyph and countdown, hear the alarm at the planned end, Next phase, End session, change a length and a sound.
5. Run `npm run check:tracker-refs` and `git diff --stat`.
</details>
