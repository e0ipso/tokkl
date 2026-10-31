---
type: practice
title: Web UI state must survive background refetches
description: >-
  Entry rows keep a stable key, the timer bar syncs on every mirrored field, and
  focus or visibility triggers a refetch.
tags:
  - web
  - react-query
  - timer
  - entry-list
kk_schema_version: 3
kk_id: practice-web-ui-survives-background-refetches
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:0'
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
The web app refetches on focus and polls, and other devices edit the same data, so components that hold local edits must not lose them when fresh data arrives.

- Entry list rows (`rowsForDay` in `packages/web/src/components/EntryList.tsx`) are keyed by their oldest member's id, not by the fields they are grouped on. An edit from another device then does not remount the row someone is typing in, and a group keeps its key when a newer entry joins it.
- Bulk and group deletes run one request per entry with `Promise.allSettled`. The toast reports partial failures, and Undo restores only the entries that were actually deleted.
- `TimerBar` (`packages/web/src/components/TimerBar.tsx`) resyncs its draft when any mirrored field of the running entry changes (id, `at`, description, project, task, billable, tags), not only `at`. The server's `at` has whole-second resolution, so two writes in the same second leave it unchanged. A timer started from the bar is remembered by its start second until it first loads as the current entry, so text typed right after Start is kept and saved to the new entry.
- `InstanceSettingsSection` in `packages/web/src/pages/AdminPage.tsx` is not keyed by the server's values. It keeps only the fields the admin edited and shows the server value for the rest, so a refetch updates untouched fields and leaves typed text and focus alone. A value typed back to the server's value is not an edit and is dropped, except while a save is pending: then every typed value stays, because the server's value may still change. Save sends only the edited fields; with nothing edited it shows "No changes to save" and sends no request, because the API refuses an empty PUT (`readSettingChanges` in `packages/api/src/domain/accounts.ts` answers 400). When the save settles, `dropEditsEqualTo` drops the edits equal to the returned values on success, and equal to the cached server values on failure; anything else typed while the request ran stays, even a value equal to what the server had before the save. Apply the same pending-save rule to any form that keeps edits over server values.
- `PreferencesSection` in `packages/web/src/pages/manage/settings/PreferencesSection.tsx` follows that rule for the whole Preferences card, the Pomodoro group included. Its Pomodoro numbers are kept as the text in their inputs, so a half-typed value survives a refetch, and an edit equal to the stored number is not an edit whatever its text. Save sends only the edited fields, a typed number as a number; with nothing edited it shows "No changes to save" and sends nothing. A 400 that names a key ("Invalid pomodoro_long_break_every: ...") shows on that field, and a failed save rolls the cache back to the stored values.
- `packages/web/src/main.tsx` replaces TanStack Query's focus listener: it listens on `window` for both `visibilitychange` and `focus`, debounced to one refresh per second. Clicking back into a window that stayed visible fires only `focus`, and the timer must refresh then too.

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:0
<!-- kk:citations:end -->
