---
type: practice
title: 'Section hues: data-section maps each NAV section to a hue and its text colour'
description: >-
  Timer orange, Pomodoro cyan, Reports sky, Projects violet, Settings yellow,
  More pink. Text on a hue is on-section-hue; fills draw an edge.
tags:
  - web
  - css
  - navigation
  - contrast
  - tokens
  - calendar
kk_schema_version: 3
kk_id: practice-section-hues-data-section-maps-each-nav-section-to-a-hue
kk_derived_from:
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:practice:0'
kk_relates_to:
  - map-app-shell-brand-and-navigation
  - practice-contrast-tables-and-project-colours
  - map-shared-list-controls-in-manage-ui
  - practice-week-calendar-hour-height-agrees-in-three-places
kk_depends_on: []
kk_confidence: high
---
Each `NAV` item in `packages/web/src/App.tsx` names a `section`: `timer`, `pomodoro`, `reports`, `projects`, `settings`, and `more` for Clients, Tags, Trash and Admin. App.tsx puts `data-section` on every nav link, on the phone More button (the open More page's section, else `more`) and on `main.content`, which takes the open page's section from `NAV` (`timer` when no item matches). The `[data-section=…]` rules after the Shell heading in `packages/web/src/styles.css` map a section to `--section-hue` and `--on-section-hue`: Timer orange, Pomodoro cyan, Reports sky, Projects violet, Settings yellow, More pink. The hue tokens (`--hue-orange`, `--hue-cyan`, `--hue-sky`, `--hue-violet`, `--hue-yellow`, `--hue-pink`) are the wordmark's colours and the same in both themes. Rules read `--section-hue` and `--on-section-hue`, not a hue token by name.

Reports sits inside the phone More sheet but keeps its sky. The other pages inside More (Clients, Tags, Trash, Admin) take More's pink, in the desktop sidebar too. On a phone the More button carries the active fill, in the open page's hue, while a page inside More is open, so the page, its nav item and that button agree. Hues of their own would need four more, and the wordmark has only magenta left. styles.css keeps this reason above the section rules.

Text and icons on a hue use `--on-hue`, the ink, except on violet, which takes `--on-hue-violet` (white) because the ink reaches only 3.50:1 there. Some fills are under the 3:1 non-text bar against what lies behind them (light sky, cyan and yellow on surface, dark violet on the sidebar and on surface-2), so every hue fill draws an edge. The active `.nav-link` has a 2px inset ring in `--border` in both themes; `--border` is the ink in light. `e2e/pages.spec.ts` checks the active Pomodoro link in light and dark: its text at least 4.5:1 on the fill, and the fill or the ring at least 3:1 against the sidebar surface. A day sticker has a 2px inset ring in `--sticker-outline`, the ink in light and transparent in dark, where every hue clears 3:1 on surface. Hue stickers sit on surface, never surface-2, which is why the week calendar's day-head band is surface. The hue, on-hue and outline pairs are rows in the styles.css contrast table; add rows when a section or a hue changes.

The active nav item, in the sidebar, the phone bar and the More sheet, fills with its hue, sets weight 800 and a 2.6 icon stroke, and keeps `aria-current="page"`, so colour is not the only sign. Day stickers are the entry list's `.day-header` and the week calendar's `.calendar-day-head`: the page's section hue with `--on-section-hue` text. Every day on a page takes the same hue, because a hue means where you are and a hue per day would suggest the days differ in kind. Today's day head on the week calendar shows its label as the sticker inverted (`--on-section-hue` fill, `--section-hue` text). The phone day strip's today weekday (`.calendar-strip-day.today`) still fills with `--primary`.

`expectSectionHue(page, item, section)` in `e2e/helpers.ts` checks a nav item's fill and weight and the `data-section` on main. Its `SECTION_HUES` map repeats the section-to-hue mapping, so change it with the styles.css rules.

<!-- kk:related:start -->
# Related

- Related: [map-app-shell-brand-and-navigation](../shell-and-layout/map-app-shell-brand-and-navigation.md)
- Related: [practice-contrast-tables-and-project-colours](practice-contrast-tables-and-project-colours.md)
- Related: [map-shared-list-controls-in-manage-ui](../shell-and-layout/map-shared-list-controls-in-manage-ui.md)
- Related: [practice-week-calendar-hour-height-agrees-in-three-places](../calendar/practice-week-calendar-hour-height-agrees-in-three-places.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:practice:0
<!-- kk:citations:end -->
