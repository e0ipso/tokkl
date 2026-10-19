---
type: map
title: 'App shell: Brand.tsx, the wordmark image and the NAV list'
description: >-
  One Brand component (the PNG Tokkl wordmark alone); one NAV list whose
  inMore pages move into the phone More dialog.
tags:
  - web
  - navigation
  - brand
  - mobile
  - wordmark
kk_schema_version: 3
kk_id: map-app-shell-brand-and-navigation
kk_derived_from: []
kk_relates_to:
  - practice-playwright-gotchas-in-the-e2e-specs
  - practice-contrast-tables-and-project-colours
  - practice-phone-layout-css-gotchas
  - practice-visual-screenshot-baselines
  - map-app-icons-script
  - practice-section-hues-data-section-maps-each-nav-section-to-a-hue
kk_depends_on: []
kk_confidence: high
---
`packages/web/src/components/Brand.tsx` renders only the wordmark, in sizes `sm` (phone header strip), `md` (sidebar) and `lg` (auth pages and the splash), with the width from `WORDMARK_WIDTH` (84, 130 and 260 CSS px) and the height from `WORDMARK_RATIO`, which is `769 / 2059`, the height over width of the crop in `scripts/icons.ts`. The app icon appears only as the browser and OS icon. Show the brand anywhere else through this component. The wordmark is an `<img alt="Tokkl">` with a `srcset` of `/brand/wordmark-260.png` and `wordmark-520.png`, so screen readers still hear the name. `.brand` stays `display: inline-flex` so its box is as tall as the image, with no line-box gap under it; the `brand-${size}` classes have no CSS rules. There is no `Wordmark.tsx` and no SVG; `scripts/icons.ts` makes the images from `docs/brand` (see `map-app-icons-script`).

The art has a near-black navy outline, `#000013`, that matches the dark `--bg` (`#08061f`, 1.04:1). It is part of the image, so it is not a token. In dark the `.brand .wordmark` rule adds four 1px `drop-shadow`s in `--wordmark-halo` (`#b9b5d6`, the dark `--muted`; transparent in light) to trace the edge. `--wordmark-halo` is the only wordmark token left in `styles.css`. The outline's and the halo's contrast rows are in the table there; recompute them when the art changes. Light still computes four `drop-shadow`s, in `rgba(0, 0, 0, 0)`, so a test for "no halo" looks for the halo colour, not for `filter: none`. `e2e/typography.spec.ts` checks that the wordmark is an `IMG` named Tokkl whose `src` matches `/brand/wordmark-<n>.png` and that it decodes. At `deviceScaleFactor` 1 and 2 it checks that each size is drawn at its width and at the served file's ratio within 1 px, and that `lg` picks `wordmark-260.png` at 1x and `wordmark-520.png` at 2x. It also checks for four halo shadows in `rgb(185, 181, 214)` in dark and none in light. Its helper `expectWordmarkAlone` checks that every `.brand` holds exactly one img, named Tokkl, in the sidebar, on the login page and in the phone header, because an extra small image would slip past the visual baselines' threshold.

`NAV` in `packages/web/src/App.tsx` is the only list of pages. Desktop shows every item in the sidebar. On phones the bottom bar shows the items without `inMore` (Timer, Reports, Projects, Settings) plus a More button. The `inMore: true` items (Clients, Tags, Trash, and Admin for admins) and the logout button open in `MoreSheet`, a modal dialog (`role="dialog"`, `aria-modal`, label "More") rendered inside `nav[aria-label="Main"]`; the More button carries the active state while one of its pages is open. An `adminOnly: true` item (Admin, `/admin`, `AdminPage.tsx`) is filtered out unless `GET /api/v9/me` returns `role: 'admin'`; that only hides the entry, and the server's 403 on `/api/app/admin/*` is the protection. `MORE_PAGES` currently lists only Clients, Tags and Trash, so a phone spec that taps Admin through `tapNav` must add it. Each item also names a `section`, which picks the hue its active link and the page fill with; the `inMore` items use `more` (see `practice-section-hues-data-section-maps-each-nav-section-to-a-hue`). Add a page with a `NAV` entry and a section, flagged `inMore` if it should leave the phone bar, never a second list.

Phone e2e specs navigate with `tapNav(page, name)` and `openMore(page)` from `e2e/mobile-tests-helpers.ts`. `tapNav` opens the More sheet first for names in its `MORE_PAGES` set, which repeats the `inMore` items, so update `MORE_PAGES` whenever an `inMore` flag changes.

<!-- Verified against the current code on 2026-10-19. -->

<!-- kk:related:start -->
# Related

- Related: [practice-playwright-gotchas-in-the-e2e-specs](../tooling-and-project/testing/e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md)
- Related: [practice-contrast-tables-and-project-colours](practice-contrast-tables-and-project-colours.md)
- Related: [practice-phone-layout-css-gotchas](practice-phone-layout-css-gotchas.md)
- Related: [practice-visual-screenshot-baselines](../tooling-and-project/testing/practice-visual-screenshot-baselines.md)
- Related: [map-app-icons-script](../tooling-and-project/repo-and-scripts/map-app-icons-script.md)
- Related: [practice-section-hues-data-section-maps-each-nav-section-to-a-hue](practice-section-hues-data-section-maps-each-nav-section-to-a-hue.md)
<!-- kk:related:end -->
