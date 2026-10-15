---
type: map
title: 'App shell: Brand.tsx, the SVG wordmark and the NAV list'
description: >-
  One Brand component (icon plus paths-only Tokkl wordmark); one NAV list whose
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
`packages/web/src/components/Brand.tsx` renders the app icon (`/icon.svg`, empty alt) beside `Wordmark`, in sizes `sm`, `md` and `lg`. The sidebar, the phone header strip, the auth page and the splash all use it; show the brand anywhere else through this component. `Wordmark.tsx` draws the graffiti "Tokkl" as SVG paths, so it needs no font and fetches nothing. The `<svg>` has `role="img"` and `aria-label="Tokkl"`, and its colours come from the `--wordmark-*` tokens in `styles.css`, which have rows in the contrast table. `e2e/typography.spec.ts` checks that the brand image is named Tokkl, has paths, and has no `text`, `image`, `use` or `foreignObject` elements. `docs/brand/tokkl-wordmark.svg` is the README copy with the light-theme colours written in; change it together with `Wordmark.tsx`.

`NAV` in `packages/web/src/App.tsx` is the only list of pages. Desktop shows every item in the sidebar. On phones the bottom bar shows the items without `inMore` (Timer, Reports, Projects, Settings) plus a More button. The `inMore: true` items (Clients, Tags, Trash) and the logout button open in `MoreSheet`, a modal dialog (`role="dialog"`, `aria-modal`, label "More") rendered inside `nav[aria-label="Main"]`; the More button carries the active state while one of its pages is open. Add a page with a `NAV` entry, flagged `inMore` if it should leave the phone bar, never a second list.

Phone e2e specs navigate with `tapNav(page, name)` and `openMore(page)` from `e2e/mobile-tests-helpers.ts`. `tapNav` opens the More sheet first for names in its `MORE_PAGES` set, which repeats the `inMore` items, so update `MORE_PAGES` whenever an `inMore` flag changes.

<!-- kk:related:start -->
# Related

- Related: [practice-e2e-test-workflow](practice-e2e-test-workflow.md)
- Related: [practice-contrast-tables-and-project-colours](practice-contrast-tables-and-project-colours.md)
- Related: [practice-phone-layout-css-gotchas](practice-phone-layout-css-gotchas.md)
<!-- kk:related:end -->
