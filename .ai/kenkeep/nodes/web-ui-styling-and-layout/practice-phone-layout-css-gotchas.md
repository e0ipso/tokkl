---
type: practice
title: 'Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells'
description: >-
  Absolute children escape unpositioned scroll wrappers, grid or flex items
  without min-width: 0 stretch past a phone screen, and wide auto tables wrap
  every cell.
tags:
  - web
  - css
  - mobile
  - layout
kk_schema_version: 3
kk_id: practice-phone-layout-css-gotchas
kk_derived_from: []
kk_relates_to:
  - practice-playwright-gotchas-in-the-e2e-specs
  - practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break
kk_depends_on: []
kk_confidence: high
---
Three CSS rules keep pages within a 390 px phone screen. The phone e2e specs catch a regression through `expectNoPageOverflow`, except for the table rule, which has its own row-height check.

- A horizontally scrolling wrapper must be positioned. An absolutely positioned child, such as a `.visually-hidden` table header (defined in `packages/web/src/styles.css`, used for the Actions column of the list and admin tables), is clipped by the nearest positioned ancestor, not by an `overflow` wrapper that is static. Without `position: relative` on the wrapper it widens the whole page. `.table-wrap` in `packages/web/src/styles.css` has `position: relative` for this reason.
- Grid and flex items default to `min-width: auto`, so wide content or an input's intrinsic width stretches the track past the screen. `.modal` is a grid item of `.modal-backdrop` and sets `min-width: 0`. Flexible inputs inside it need the same, as `.project-tasks .inline-controls input` and `.inline-input` (`packages/web/src/pages/manage/manage.css`) have.
- An auto-layout table wider than its `.table-wrap` shrinks every column that can wrap to its minimum content width, so on a phone cells wrap one word (or one chip) per line and rows double in height. Keep short identity columns on one line: the detailed report's `.detailed-client` is `white-space: nowrap` with `max-width: 180px`, ellipsis, and a `title` holding the full name, and its tag chips do not wrap (`packages/web/src/pages/reports/reports.css`). `e2e/mobile-reports.spec.ts` asserts detailed rows stay under 56px at 390x844. The admin users and invites tables take the other route: `.admin-table td` is `white-space: nowrap` (`packages/web/src/pages/manage/manage.css`), so the table scrolls sideways inside `.table-wrap` and `e2e/admin-page.spec.ts` checks the page itself does not overflow.

<!-- kk:related:start -->
# Related

- Related: [practice-playwright-gotchas-in-the-e2e-specs](../tooling-and-project/testing/e2e-suite/practice-playwright-gotchas-in-the-e2e-specs.md)
- Related: [practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break](practice-report-totals-wrap-as-a-flex-row-amount-figures-never-break.md)
<!-- kk:related:end -->
