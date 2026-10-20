---
type: map
title: 'Entry fields: EntryFields.tsx and useEntryFields.ts'
description: >-
  Draft-driven description, suggestions, project/task and tag pickers and
  billable toggle; the parent decides what an edit writes.
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
`packages/web/src/components/EntryFields.tsx` renders the description field with its suggestions, the project and task picker, the tag picker and the billable toggle. It is driven by an `EntryDraft` (`description`, `project_id`, `task_id`, `tags`, `billable`; `EMPTY_DRAFT` in `useEntryFields.ts`) and reports changes through props: `onType` for typed description text, `onEdit` for any other change (a partial draft), `onDescriptionBlur` and `onEnter`. It writes nothing itself. `TimerBar.tsx` is its consumer: it keeps the draft and, inside those callbacks, patches the running entry with `patchRunning` when one runs, so with no running entry an edit only changes the draft until Start. The ref handle `EntryFieldsHandle` exposes `focus`, `hasFocus` and `hideSuggestions`.

`packages/web/src/components/useEntryFields.ts` holds the logic, with node:test coverage in `useEntryFields.test.ts`. `suggestionsFrom` matches recent entries on description, project or client, newest first, keeps one suggestion per description, project and task, drops entries with neither a description nor a project, and returns at most `MAX_SUGGESTIONS` (8). `suggestedDraft` fills every field from a picked suggestion, not only the description. `projectChanges` is the billable rule: picking a billable project turns billable on, and any other project leaves billable as it was.

Component behaviour (pickers, focus, the idle draft) is checked in Playwright, in `e2e/timer-metadata.spec.ts`, because the web unit tests cannot load `.tsx`. Put new logic for these fields in `useEntryFields.ts` so it stays unit-testable.

<!-- kk:related:start -->
# Related

- Related: [practice-timer-bar-pickers-return-focus-without-opening-suggestions](practice-timer-bar-pickers-return-focus-without-opening-suggestions.md)
- Related: [practice-web-ui-survives-background-refetches](practice-web-ui-survives-background-refetches.md)
- Related: [map-test-and-static-analysis-layout](../tooling-and-project/testing/map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
