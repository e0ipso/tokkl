---
type: practice
title: "Week calendar hour height lives in three places"
description: "HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match."
tags:
  - web
  - calendar
  - css
  - e2e
kk_schema_version: 3
kk_id: practice-week-calendar-hour-height-agrees-in-three-places
kk_derived_from: []
kk_relates_to:
  - practice-ui-time-math-uses-wall-clock-helpers
  - practice-contrast-tables-and-project-colours
kk_depends_on: []
kk_confidence: high
---
An hour is 48px tall in the week calendar. The number lives in three places that must change together: `HOUR_HEIGHT` in `packages/web/src/components/WeekCalendar.tsx` (block positions and drag snapping), the `background-size: 100% 48px` that draws the hour lines in the week calendar block of `styles.css`, and `HOUR` in `e2e/history-calendar-tests-helpers.ts` (scroll offsets and drag distances in specs). A mismatch puts blocks off their hour lines or makes drag specs land on the wrong time.

Colours: the running block and the now line use `--state-running`. Today's column has the `--calendar-today` background, and today's day head inverts its sticker for the label: an `--on-section-hue` badge with `--section-hue` text. Their pairs are in the `styles.css` contrast table.

<!-- kk:related:start -->
# Related

- Related: [practice-ui-time-math-uses-wall-clock-helpers](../web-ui-behaviour/practice-ui-time-math-uses-wall-clock-helpers.md)
- Related: [practice-contrast-tables-and-project-colours](practice-contrast-tables-and-project-colours.md)
<!-- kk:related:end -->
