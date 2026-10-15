---
type: map
title: 'App shell: Brand.tsx, the wordmark image and the NAV list'
description: >-
  One Brand component (icon image plus PNG Tokkl wordmark); one NAV list whose
  inMore pages move into the phone More dialog.
tags:
  - web
  - navigation
  - brand
  - mobile
kk_schema_version: 3
kk_id: map-app-shell-brand-and-navigation
kk_derived_from: []
kk_relates_to:
  - practice-e2e-test-workflow
  - practice-contrast-tables-and-project-colours
  - practice-phone-layout-css-gotchas
kk_depends_on: []
kk_confidence: high
---
`packages/web/src/components/Brand.tsx` renders the app icon (`/brand/icon-96.png`, empty alt) beside the wordmark, in sizes `sm`, `md` and `lg`. The sidebar, the phone header strip, the auth page and the splash all use it; show the brand anywhere else through this component. The wordmark is an `<img alt="Tokkl">` with a `srcset` of `/brand/wordmark-260.png` and `wordmark-520.png`, so screen readers still hear the name. There is no `Wordmark.tsx` and no SVG; `scripts/icons.ts` makes the images from `docs/brand` (see `map-app-icons-script`).

The art has a navy outline that matches the dark `--bg`, so in dark the `.brand .wordmark` rule adds four 1px `drop-shadow`s in `--wordmark-halo` (transparent in light) to trace the edge. `--wordmark-halo` is the only wordmark token left in `styles.css`, and its contrast rows are in the table there. `e2e/typography.spec.ts` checks that the wordmark is an `IMG` named Tokkl whose `src` matches `/brand/wordmark-<n>.png` and that it decodes. It also decodes the 30px icon and expects a 96px width: that icon is too small for the visual baselines to notice if it breaks.

`NAV` in `packages/web/src/App.tsx` is the only list of pages. Desktop shows every item in the sidebar. On phones the bottom bar shows the items without `inMore` (Timer, Reports, Projects, Settings) plus a More button. The `inMore: true` items (Clients, Tags, Trash) and the logout button open in `MoreSheet`, a modal dialog (`role="dialog"`, `aria-modal`, label "More") rendered inside `nav[aria-label="Main"]`; the More button carries the active state while one of its pages is open. Add a page with a `NAV` entry, flagged `inMore` if it should leave the phone bar, never a second list.

Phone e2e specs navigate with `tapNav(page, name)` and `openMore(page)` from `e2e/mobile-tests-helpers.ts`. `tapNav` opens the More sheet first for names in its `MORE_PAGES` set, which repeats the `inMore` items, so update `MORE_PAGES` whenever an `inMore` flag changes.

<!-- kk:related:start -->
# Related

- Related: [practice-e2e-test-workflow](../tooling-and-project/practice-e2e-test-workflow.md)
- Related: [practice-contrast-tables-and-project-colours](practice-contrast-tables-and-project-colours.md)
- Related: [practice-phone-layout-css-gotchas](practice-phone-layout-css-gotchas.md)
<!-- kk:related:end -->
