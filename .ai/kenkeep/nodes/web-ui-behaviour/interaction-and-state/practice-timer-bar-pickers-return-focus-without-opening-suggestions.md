---
type: practice
title: Timer bar pickers return focus to the description without opening suggestions
description: >-
  Closing the project or tag picker focuses the description through the
  combobox's focusQuietly; every focus clears the pending 150 ms blur hide;
  typing or a click reopens suggestions.
tags:
  - web
  - timer
  - focus
  - a11y
kk_schema_version: 3
kk_id: practice-timer-bar-pickers-return-focus-without-opening-suggestions
kk_derived_from: []
kk_relates_to:
  - practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows
  - practice-web-ui-survives-background-refetches
  - map-web-entry-fields-entryfields-tsx-and-useentryfields-ts
kk_depends_on: []
kk_confidence: high
---
The description field is `packages/web/src/components/DescriptionCombobox.tsx`, rendered by `EntryFields.tsx` in the timer bar (see `map-web-entry-fields-entryfields-tsx-and-useentryfields-ts`). It shows suggestions while it has focus. Its blur hides them after 150 ms (`hideSuggestionsTimer`), so a click on a suggestion still lands before they disappear.

Closing the project or tag picker returns focus to the description, and that focus must not open the suggestions: the user did not ask for them. `EntryFields` calls `focusQuietly()` on the `DescriptionComboboxHandle`, which sets the `quietFocus` ref around the `focus()` call. The field's `onFocus` opens the suggestions only when the focus is not quiet. The `quietFirstFocus` prop does the same for the first focus after mount, which the `EntryEditor` dialog uses for `Modal`'s autofocus. Every focus also clears the stored blur timeout, so a hide scheduled by an earlier blur cannot fire after the user is back in the field. Typing (`onChange`) reopens the suggestions, and so does a click on a field that holds a quiet focus (a click on an already focused input fires no focus event).

Use the handle's `focusQuietly()` for any new picker or popover that hands focus back to the description. A plain `focus()`, including the `focus()` of the `EntryFieldsHandle` that `TimerBar` calls, opens the list.

<!-- kk:related:start -->
# Related

- Related: [practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md)
- Related: [practice-web-ui-survives-background-refetches](practice-web-ui-survives-background-refetches.md)
- Related: [map-web-entry-fields-entryfields-tsx-and-useentryfields-ts](map-web-entry-fields-entryfields-tsx-and-useentryfields-ts.md)
<!-- kk:related:end -->
