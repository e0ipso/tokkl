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
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
The web app refetches on focus and polls, and other devices edit the same data, so components that hold local edits must not lose them when fresh data arrives.

- Entry list rows (`rowsForDay` in `web/src/components/EntryList.tsx`) are keyed by their oldest member's id, not by the fields they are grouped on. An edit from another device then does not remount the row someone is typing in, and a group keeps its key when a newer entry joins it.
- Bulk and group deletes run one request per entry with `Promise.allSettled`. The toast reports partial failures, and Undo restores only the entries that were actually deleted.
- `TimerBar` (`web/src/components/TimerBar.tsx`) resyncs its draft when any mirrored field of the running entry changes (id, `at`, description, project, task, billable, tags), not only `at`. The server's `at` has whole-second resolution, so two writes in the same second leave it unchanged. A timer started from the bar is remembered by its start second until it first loads as the current entry, so text typed right after Start is kept and saved to the new entry.
- `web/src/main.tsx` replaces TanStack Query's focus listener: it listens on `window` for both `visibilitychange` and `focus`, debounced to one refresh per second. Clicking back into a window that stayed visible fires only `focus`, and the timer must refresh then too.
