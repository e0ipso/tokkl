---
type: practice
title: Calendar lanes follow stored spans; zero-length markers draw on top
description: >-
  assignLanes clusters on stored spans, shorter first; thin blocks, markers and
  drags stack 3, 4, 5; blocks under a marker are drawn taller.
tags:
  - web
  - calendar
  - css
kk_schema_version: 3
kk_id: >-
  practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top
kk_derived_from: []
kk_relates_to:
  - map-web-calendar-day-view-and-touch-gestures-in-weekcalendar
  - practice-ui-time-math-uses-wall-clock-helpers
  - practice-week-calendar-hour-height-agrees-in-three-places
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
kk_depends_on: []
kk_confidence: high
---
`assignLanes` in `packages/web/src/lib/calendarLanes.ts` clusters a day's blocks and gives each a lane by their stored spans in clock minutes, never by their drawn heights, so a zero-length or very short entry that only touches the entry starting where it ends stays in that entry's lane. Blocks are sorted by start, then by end, so at the same start the shorter span comes first and closes its cluster before the longer one opens the next. Blocks that only touch at an end do not overlap, and neither do zero-length entries at different instants. A zero-length entry inside another entry's span overlaps it and takes a lane beside it, and zero-length entries at the same instant overlap each other, so neither hides the other.

`WeekCalendar.tsx` draws every block at least `MIN_BLOCK_HEIGHT` (6 px) tall, so a zero-length entry (a switch within half a step; see `practice-stopped-entries-snap-to-the-time-resolution-on-write`) is a thin bar at its start. A block whose stored span is shorter than that gets `.thin`, and a zero-length one also gets `.marker`. `styles.css` stacks `.calendar-block` at z-index 2, `.thin` at 3, `.marker` at 4 and `.dragging` at 5, so a block drawn taller than its span stays clickable over the block it touches, and a marker sits above both. A marker would hide the start of a block beneath it, so `heightClearingMarkers` draws such a block tall enough to show `MIN_BLOCK_HEIGHT` px below every marker over its start. Keep the lane rules, the classes and the z-index order together when changing any of them.

`clockSpanOnDay` in `packages/common/time.ts` puts an empty range (start equals stop) on the day that contains its instant, so a zero-length entry at midnight sits at 0 on the day that starts there. A non-empty range that ends at midnight still misses the next day.

<!-- kk:related:start -->
# Related

- Related: [map-web-calendar-day-view-and-touch-gestures-in-weekcalendar](map-web-calendar-day-view-and-touch-gestures-in-weekcalendar.md)
- Related: [practice-ui-time-math-uses-wall-clock-helpers](../web-ui-behaviour/practice-ui-time-math-uses-wall-clock-helpers.md)
- Related: [practice-week-calendar-hour-height-agrees-in-three-places](practice-week-calendar-hour-height-agrees-in-three-places.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write](../api-and-data/time-handling/practice-stopped-entries-snap-to-the-time-resolution-on-write.md)
<!-- kk:related:end -->
