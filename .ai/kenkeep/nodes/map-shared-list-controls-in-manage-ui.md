---
type: map
title: Shared list controls live in web/src/pages/manage/ui.tsx
description: >-
  Reuse SearchBox, Segmented, RowMenu, ConfirmModal and StatusBadge from
  manage/ui.tsx and the .search-box, .inline-input, .card classes.
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
`web/src/pages/manage/ui.tsx` holds the controls that the Projects, Clients and Tags pages and the reports share: `SearchBox`, `Segmented`, `RowMenu`, `ConfirmModal`, `StatusBadge` with `STATUS_OPTIONS` and `matchesStatus`, and `plural`. The report filters (`web/src/pages/reports/Filters.tsx`) import `SearchBox` and `Segmented` from there rather than keeping copies.

Shared classes: `.search-box` (the `SearchBox` wrapper), `.select-button` and `.card` in `web/src/styles.css`, and `.inline-input` in `web/src/pages/manage/manage.css` for the inline rename inputs of tags and tasks. Reuse these before adding a page-specific variant.

<!-- kk:related:start -->
# Related

- Related: [practice-phone-layout-css-gotchas](practice-phone-layout-css-gotchas.md)
<!-- kk:related:end -->
