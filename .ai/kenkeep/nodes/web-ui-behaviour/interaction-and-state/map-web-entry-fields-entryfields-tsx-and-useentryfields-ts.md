---
type: map
title: 'Entry fields: EntryFields.tsx, DescriptionCombobox.tsx and useEntryFields.ts'
description: >-
  Draft-driven description, project/task and tag pickers and billable toggle;
  the shared DescriptionCombobox gives the timer bar, editor and rows the same
  suggestions; the owner decides what an edit or pick writes.
tags:
  - web
  - timer
  - components
  - react
  - focus
kk_schema_version: 3
kk_id: map-web-entry-fields-entryfields-tsx-and-useentryfields-ts
kk_derived_from: []
kk_relates_to:
  - practice-timer-bar-pickers-return-focus-without-opening-suggestions
  - practice-web-ui-survives-background-refetches
  - map-test-and-static-analysis-layout
kk_depends_on: []
kk_confidence: high
---
`packages/web/src/components/EntryFields.tsx` renders the description field, the project and task picker, the tag picker and the billable toggle. It is driven by an `EntryDraft` (`description`, `project_id`, `task_id`, `tags`, `billable`; `EMPTY_DRAFT` in `useEntryFields.ts`) and reports changes through props: `onType` for typed description text, `onEdit` for any other change (a partial draft), `onDescriptionBlur` and `onEnter`. It writes nothing itself. `TimerBar.tsx`, `AllDayEntryDialog` and the Pomodoro forms use it. `TimerBar` keeps the draft (`useRunningDraft.ts`) and, inside those callbacks, patches the running entry with `patchRunning` when one runs, so with no running entry an edit only changes the draft until Start. The ref handle `EntryFieldsHandle` exposes `focus`, `hasFocus` and `hideSuggestions`. Only `EntryFields` has the `@` and `#` shortcuts, which open the pickers from an empty description.

The description field is `packages/web/src/components/DescriptionCombobox.tsx`, which every description input that edits an entry shares: `EntryFields`, the `EntryEditor` dialog and the entry list rows (`EntryLine`). It owns the input, the suggestion listbox, the ARIA combobox attributes, the 150 ms blur delay, quiet focus and the Arrow/Enter/Escape keys. The owner keeps the value and decides what a pick writes: `EntryFields` calls `onEdit(suggestedDraft(s))`, the editor replaces its draft (Save still writes it), and a row sends one bulk PATCH built by `entryPatch.suggestion` in `lib/entryPatches.ts` (description, project_id, task_id, tags, then billable, because a project change resets billable on the server). Escape with the list open closes only the list and stops propagation, so an enclosing `Modal` stays open. The suggestion buttons have `tabIndex={-1}`, and only a primary-button press picks.

`packages/web/src/components/useEntryFields.ts` holds the logic, with node:test coverage in `useEntryFields.test.ts`. `suggestionsFrom` matches recent entries on description, project or client, newest first, keeps one suggestion per description, project and task, drops entries with neither a description nor a project, and returns at most `MAX_SUGGESTIONS` (8). `suggestedDraft` fills every field from a picked suggestion, not only the description. `useDescriptionSuggestions` holds the list state for the combobox. `projectChanges` is the billable rule: picking a billable project turns billable on, and any other project leaves billable as it was. The key decisions (`comboboxKeyAction`, `nextHighlight`, `previousHighlight`) are pure functions in `components/descriptionCombobox.ts`, tested in `descriptionCombobox.test.ts`.

Component behaviour (pickers, focus, the idle draft, suggestions in the editor and rows) is checked in Playwright, in `e2e/timer-metadata.spec.ts`, `e2e/editor-suggestions.spec.ts` and `e2e/row-suggestions.spec.ts`, because the web unit tests cannot load `.tsx`. Put new logic for these fields in `.ts` modules so it stays unit-testable.

<!-- kk:related:start -->
# Related

- Related: [practice-timer-bar-pickers-return-focus-without-opening-suggestions](practice-timer-bar-pickers-return-focus-without-opening-suggestions.md)
- Related: [practice-web-ui-survives-background-refetches](practice-web-ui-survives-background-refetches.md)
- Related: [map-test-and-static-analysis-layout](../../tooling-and-project/testing/map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
