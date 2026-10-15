---
type: practice
title: 'Phone layout CSS: position scroll wrappers, min-width: 0 on grid/flex items'
description: >-
  Absolute children escape unpositioned scroll wrappers, and grid or flex items
  without min-width: 0 stretch past a phone screen.
tags:
  - web
  - css
  - mobile
  - layout
kk_schema_version: 3
kk_id: practice-phone-layout-css-gotchas
kk_derived_from: []
kk_relates_to:
  - practice-e2e-test-workflow
kk_depends_on: []
kk_confidence: high
---
Two CSS rules keep pages within a 390 px phone screen. The phone e2e specs catch a regression through `expectNoPageOverflow`.

- A horizontally scrolling wrapper must be positioned. An absolutely positioned child, such as a `.visually-hidden` table header (`web/src/pages/manage/manage.css`), is clipped by the nearest positioned ancestor, not by an `overflow` wrapper that is static. Without `position: relative` on the wrapper it widens the whole page. `.table-wrap` in `web/src/styles.css` has `position: relative` for this reason.
- Grid and flex items default to `min-width: auto`, so wide content or an input's intrinsic width stretches the track past the screen. `.modal` is a grid item of `.modal-backdrop` and sets `min-width: 0`. Flexible inputs inside it need the same, as `.project-tasks .inline-controls input` and `.inline-input` (`web/src/pages/manage/manage.css`) have.

<!-- kk:related:start -->
# Related

- Related: [practice-e2e-test-workflow](practice-e2e-test-workflow.md)
<!-- kk:related:end -->
