---
type: map
title: Phone e2e navigation helpers tapNav and openMore
description: >-
  Phone e2e specs navigate with tapNav and openMore; MORE_PAGES repeats the
  inMore items and omits Admin.
tags:
  - web
  - navigation
  - mobile
kk_schema_version: 3
kk_id: map-phone-e2e-navigation-helpers-tapnav-and-openmore
kk_derived_from:
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:0'
kk_relates_to:
  - practice-playwright-gotchas-in-the-e2e-specs
  - map-nav-list-phone-more-sheet-and-nav-running-dots
kk_depends_on: []
kk_confidence: high
---
Phone e2e specs navigate with `tapNav(page, name)` and `openMore(page)` from `e2e/mobile-tests-helpers.ts`. `tapNav` opens the More sheet first for names in its `MORE_PAGES` set, which repeats the `inMore` items, so update `MORE_PAGES` whenever an `inMore` flag changes. `MORE_PAGES` lists Reports, Clients, Tags and Trash but not Admin, so a phone spec that taps Admin through `tapNav` must add it.

<!-- Verified against the current code on 2026-10-19. -->

<!-- kk:related:start -->
# Related

- Related: [practice-playwright-gotchas-in-the-e2e-specs](../../../tooling-and-project/testing/e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md)
- Related: [map-nav-list-phone-more-sheet-and-nav-running-dots](map-nav-list-phone-more-sheet-and-nav-running-dots.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:0
<!-- kk:citations:end -->
