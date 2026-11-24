---
type: map
title: 'NAV list, phone More sheet and nav running dots'
description: >-
  NAV in app/nav.ts is the only page list; inMore items move into the phone More
  dialog; adminOnly hides Admin; running dots.
tags:
  - web
  - navigation
  - mobile
kk_schema_version: 3
kk_id: map-nav-list-phone-more-sheet-and-nav-running-dots
kk_derived_from:
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:0'
kk_relates_to:
  - practice-section-hues-data-section-maps-each-nav-section-to-a-hue
  - practice-phone-layout-css-gotchas
  - map-lazy-page-chunks-and-failed-load-recovery
  - map-phone-e2e-navigation-helpers-tapnav-and-openmore
kk_depends_on: []
kk_confidence: high
---
`NAV` in `packages/web/src/app/nav.ts` is the only list of pages. Each item's `label` is a catalog key (`shell.navTimer` and so on) that `NavLink` renders with `t`. Desktop shows every item in the sidebar. Pomodoro follows Timer in both. On phones the bottom bar shows the items without `inMore` (Timer, Pomodoro, Projects, Settings) plus a More button. The `inMore: true` items (Reports, Clients, Tags, Trash, and Admin for admins) and the logout button open in `MoreSheet`, a modal dialog (`role="dialog"`, `aria-modal`, label "More") rendered inside `nav[aria-label="Main"]`, which traps Tab and makes the rest of the page `inert` while it is open; the More button carries the active state, in the open page's hue, while one of its pages is open. An `adminOnly: true` item (Admin, `/admin`, `AdminPage.tsx`) is filtered out unless `GET /api/v9/me` returns `role: 'admin'`; that only hides the entry, and the server's 403 on `/api/app/admin/*` is the protection. Each item also names a `section`, which picks the hue its active link and the page fill with; the `inMore` items other than Reports use `more` (see `practice-section-hues-data-section-maps-each-nav-section-to-a-hue`). Add a page with a `NAV` entry and a section, flagged `inMore` if it should leave the phone bar, never a second list. The Timer item shows a `.running-dot` while an entry runs, and the Pomodoro item shows one while a Pomodoro session exists (`usePomodoroSession().session` is non-null), on every page and after a reload, until End session. Each dot has its own visually hidden label (Timer running, Pomodoro session running), so the link's accessible name includes it; `e2e/timer-pomodoro-session.spec.ts` checks the Pomodoro dot's lifetime.

<!-- Verified against the current code on 2026-10-19. -->

<!-- kk:related:start -->
# Related

- Related: [practice-section-hues-data-section-maps-each-nav-section-to-a-hue](../../theme-and-tokens/practice-section-hues-data-section-maps-each-nav-section-to-a-hue.md)
- Related: [practice-phone-layout-css-gotchas](../practice-phone-layout-css-gotchas.md)
- Related: [map-lazy-page-chunks-and-failed-load-recovery](map-lazy-page-chunks-and-failed-load-recovery.md)
- Related: [map-phone-e2e-navigation-helpers-tapnav-and-openmore](map-phone-e2e-navigation-helpers-tapnav-and-openmore.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:0
<!-- kk:citations:end -->
