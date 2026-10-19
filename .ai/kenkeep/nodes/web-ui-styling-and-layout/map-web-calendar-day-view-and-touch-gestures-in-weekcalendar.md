---
type: map
title: Web calendar day view and touch gestures in WeekCalendar
description: >-
  Below 760px WeekCalendar shows one day under a week strip; touch drags start
  after a 500 ms long press, mouse drags at once.
tags:
  - web
  - calendar
  - touch
  - mobile
  - e2e
kk_schema_version: 3
kk_id: map-web-calendar-day-view-and-touch-gestures-in-weekcalendar
kk_derived_from:
  - '935c3ad4-996d-4ce0-b165-4aaf8e23c62e:map:0'
kk_relates_to:
  - practice-week-calendar-hour-height-agrees-in-three-places
  - practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top
  - practice-ui-time-math-uses-wall-clock-helpers
  - practice-phone-layout-css-gotchas
  - practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard
kk_depends_on: []
kk_confidence: medium
---
`packages/web/src/components/WeekCalendar.tsx` has two layouts. When `DAY_MODE_QUERY` (`(max-width: 759.98px)`, in `packages/web/src/lib/calendarDay.ts`) matches, the root gets `.calendar.day-mode` and renders one column for `selectedDay` under a `.calendar-strip` group ("Days of the week") of seven buttons with each day's total. Exactly 760px stays in week mode, while `PHONE_QUERY` in `App.tsx` includes 760. Arrows and sideways swipes step one day and cross weeks (`stepDay`, ±1 in day mode, ±7 in week mode). `T` jumps to today in day mode and to this week in week mode. `classifySwipe` needs at least 50px sideways travel and 1.5 times the vertical travel; anything else stays a scroll. A day-mode move goes through `clampDayMove` and `fitMoveInDay`, so the block stays on the shown day, also on the 25-hour autumn day. The week view lets a block cross midnight.

Input: mouse and pen drags start at once. A touch drag starts only after a 500 ms hold (`LONG_PRESS_MS`) that a move over 10px, a lift or a pointercancel aborts. `.calendar-column` has `touch-action: pan-y`, so a finger scrolls the grid. A quick tap on a block still opens its editor, like a click. A non-passive `touchmove` listener on the root calls `preventDefault()` only while a drag is active and `event.cancelable` is true.

When changing this, verify:
- The `touchmove` `preventDefault` is load-bearing. Without it Chromium treats a vertical touch drag as a pan and fires `pointercancel`.
- The `cancelable` check matters too. Cancelling an uncancelable touchmove logs a Chromium warning, and the e2e runtime-error guard fails on it.
- Tap-to-edit on touch must keep working.
- Phone touch cases are in `e2e/calendar.spec.ts` and `e2e/history-calendar-drag.spec.ts`. They use the CDP helpers `calendarBodyBox`, `touchSwipe` and `touchLongPressDrag` in `e2e/history-calendar-tests-helpers.ts`.

<!-- kk:related:start -->
# Related

- Related: [practice-week-calendar-hour-height-agrees-in-three-places](practice-week-calendar-hour-height-agrees-in-three-places.md)
- Related: [practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top](practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md)
- Related: [practice-ui-time-math-uses-wall-clock-helpers](../web-ui-behaviour/practice-ui-time-math-uses-wall-clock-helpers.md)
- Related: [practice-phone-layout-css-gotchas](practice-phone-layout-css-gotchas.md)
- Related: [practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard](../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 935c3ad4-996d-4ce0-b165-4aaf8e23c62e:map:0
<!-- kk:citations:end -->
