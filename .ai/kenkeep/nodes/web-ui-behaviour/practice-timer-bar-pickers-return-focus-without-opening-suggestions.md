---
type: practice
title: Timer bar pickers return focus to the description without opening suggestions
description: >-
  Closing the project or tag picker focuses the description through quietFocus;
  every focus clears the pending 150 ms blur hide; typing reopens suggestions.
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
The description field in `packages/web/src/components/EntryFields.tsx` (rendered by `TimerBar.tsx`, see `map-web-entry-fields-entryfields-tsx-and-useentryfields-ts`) shows suggestions while it has focus. Its blur hides them after 150 ms (`hideSuggestionsTimer`), so a click on a suggestion still lands before they disappear.

Closing the project or tag picker returns focus to the description, and that focus must not open the suggestions: the user did not ask for them. `focusDescriptionQuietly` sets the `quietFocus` ref around the `focus()` call, and the field's `onFocus` sets the suggestions open exactly when `quietFocus` is false. Every focus also clears the stored blur timeout, so a hide scheduled by an earlier blur cannot fire after the user is back in the field. Typing (`onChange`) reopens the suggestions.

Reuse `focusDescriptionQuietly` for any new picker or popover inside `EntryFields` that hands focus back to the description. Calling `descriptionRef.current.focus()` directly would reopen the list, and so does the `focus()` of the `EntryFieldsHandle` that `TimerBar` calls, which is a plain focus.

<!-- kk:related:start -->
# Related

- Related: [practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows](practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md)
- Related: [practice-web-ui-survives-background-refetches](practice-web-ui-survives-background-refetches.md)
- Related: [map-web-entry-fields-entryfields-tsx-and-useentryfields-ts](map-web-entry-fields-entryfields-tsx-and-useentryfields-ts.md)
<!-- kk:related:end -->
