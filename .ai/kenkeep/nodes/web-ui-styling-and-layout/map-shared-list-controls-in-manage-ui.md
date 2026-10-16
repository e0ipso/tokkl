---
type: map
title: Shared list controls live in packages/web/src/pages/manage/ui.tsx
description: >-
  Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from manage/ui.tsx, and the Shared rules block at the top of styles.css.
tags:
  - web
  - components
  - css
  - reuse
kk_schema_version: 3
kk_id: map-shared-list-controls-in-manage-ui
kk_derived_from: []
kk_relates_to:
  - practice-phone-layout-css-gotchas
kk_depends_on: []
kk_confidence: high
---
`packages/web/src/pages/manage/ui.tsx` holds the controls that the Projects, Clients and Tags pages and the reports share: `SearchBox`, `Segmented`, `RowMenu`, `ConfirmModal`, `StatusBadge` with `STATUS_OPTIONS` and `matchesStatus`, and `plural`. The report filters (`packages/web/src/pages/reports/Filters.tsx`) import `SearchBox` and `Segmented` from there rather than keeping copies.

`RowMenu` focuses its button before it runs an item, because the menu unmounts with the item's click. A modal that item opens then remembers "More actions" as its opener and returns focus there (see the keyboard and focus node). Its button carries `data-row-action="menu"`, which `focusPastRow` and `keepFocusPastRow` in `packages/web/src/pages/manage/rowFocus.ts` use to move focus to the next row when this row leaves a list; the table rows need `data-id`.

Shared classes: `.search-box` (the `SearchBox` wrapper), `.select-button` and `.card` in `packages/web/src/styles.css`. Reuse these before adding a page-specific variant.

A "Shared rules" block near the top of `styles.css`, after the tokens, holds the looks that many components share: `.surface` (a panel on `--surface` with the standard border and radius), `.row-button` (a borderless full-width list or menu row, `--surface-2` on hover), the selected/active `--state-selected` tint with a primary bar on the left edge, a figures rule (tabular, semibold numbers for the running clock, durations and day totals) and `.inline-input` (a field that reads as plain text until hovered or focused). A component joins a rule by adding its selector to that rule's selector list, or by adding the shared class in markup; its own rule further down sets only what differs. `manage.css` keeps only layout for `.inline-input`, the tag and task rename fields. The figures rule names its selectors and takes no class: table cells use `.num`, which only aligns and stays regular weight.

<!-- kk:related:start -->
# Related

- Related: [practice-phone-layout-css-gotchas](practice-phone-layout-css-gotchas.md)
<!-- kk:related:end -->
