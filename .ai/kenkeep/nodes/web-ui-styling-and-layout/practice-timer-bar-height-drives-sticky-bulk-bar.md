---
type: practice
title: Bulk bar sticks under the timer bar through --timer-bar-height
description: "TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected."
tags:
  - web
  - css
  - timer
  - mobile
kk_schema_version: 3
kk_id: practice-timer-bar-height-drives-sticky-bulk-bar
kk_derived_from: []
kk_relates_to:
  - practice-phone-layout-css-gotchas
  - practice-web-ui-survives-background-refetches
kk_depends_on: []
kk_confidence: high
---
The bulk bar is not inside the timer bar, so it cannot measure it. `useHeightProperty` in `packages/web/src/components/TimerBar.tsx` watches the bar with a `ResizeObserver` and writes its `offsetHeight` to `--timer-bar-height` on `<html>`, and removes the property on unmount. `.bulk-bar` in `styles.css` is `position: sticky; top: var(--timer-bar-height, 0px)`, so it stays flush under the timer bar however tall that wraps. Do not hard-code the timer bar's height anywhere.

On phones (the `max-width: 760px` block) both bars stuck together take too much of the screen. `.page:has(.bulk-bar)` sets `--timer-bar-height: 0px` and makes the timer bar `position: relative`, so while entries are selected the timer bar scrolls away and the bulk bar sticks at the top.

<!-- kk:related:start -->
# Related

- Related: [practice-phone-layout-css-gotchas](practice-phone-layout-css-gotchas.md)
- Related: [practice-web-ui-survives-background-refetches](../web-ui-behaviour/practice-web-ui-survives-background-refetches.md)
<!-- kk:related:end -->
