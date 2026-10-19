---
id: 2
group: "calendar-day-mode"
dependencies: [1]
status: "completed"
created: 2026-10-18
skills:
  - react
  - css
complexity_score: 6
complexity_notes: "Touches one component and its CSS block, but combines selected-day state, strip, toolbar, swipe, T and clamp. Touch long-press is split into task 3 to keep this below 7."
execution_profile: "complex-architecture"
---
# WeekCalendar day mode: selected day, strip, navigation, swipe, T and move clamp

## Objective
Make `WeekCalendar` render one day below 760px (today selected by default) with a strip of the week's seven days and totals, day-stepping toolbar arrows and swipes that cross week boundaries, a per-mode `T` shortcut, and day-mode moves clamped to the selected day. At 760px and wider the week view stays byte-identical in labels, classes and behaviour.

## Skills Required
React with TypeScript (state, memo, effects, native listeners) and CSS grid/responsive styling with WCAG contrast.

## Acceptance Criteria
- [ ] State is a selected-day key (default `today(settings.timeZone)`); `weekStart = startOfWeek(selectedDay, settings.beginningOfWeek)`; `useEntries(addDays(weekStart,-1), addDays(weekStart,7))` unchanged, so leaving the week shows `Loading week…`.
- [ ] `dayMode = useMediaQuery(DAY_MODE_QUERY)`; `days` is `[selectedDay]` in day mode and the seven week days otherwise; `layout()` gets that list. The root gets a modifier class (e.g. `calendar day-mode`) and all day-mode CSS keys off it.
- [ ] Week mode: buttons "Previous week", "Next week", "This week" (title "This week (T)"), the `.calendar-range` text `X to Y`, `.calendar-head`/`.calendar-day-head` markup and the week total are unchanged.
- [ ] Day mode: arrows step one day with accessible names that don't contain "Calendar", "List", "Today" or "week" (e.g. "Previous day", "Next day"); the jump button is labelled for the day (e.g. "Go to current day" / visible text without the substring "Today"); `.calendar-range` shows the selected date.
- [ ] Day strip (day mode only): a labelled group (e.g. `role="group" aria-label="Days of the week"`) of seven buttons, each with weekday + short date and the day total (same `localDay(entry.start)` total logic as the head), `aria-pressed` on the selected one, a non-colour mark (underline/border/weight), today's existing filled-badge treatment, and roving tabindex driven by `arrowTarget` (as in `ColorField.tsx`/`RangeControl.tsx`). Accessible names avoid "Today", "Calendar", "List" (use `weekdayName` + `shortDate`, not `dayLabel`). Tapping selects.
- [ ] Horizontal swipe on the grid (day mode only) uses `classifySwipe`: left → next day, right → previous day. Any transition uses `--duration-*` tokens.
- [ ] `T` (existing guards unchanged) selects today in both modes; in week mode that shows this week as before.
- [ ] Day-mode moves go through `clampDayMove` (block clipped at the top can't move earlier, clipped at the bottom can't move later); week-mode moves stay unclamped; create and resize unchanged.
- [ ] CSS: one-column grid template for `.day-mode` (keeps 48px rows, `background-size: 100% 48px`), strip styles, and a contrast-table row in `styles.css` for any new colour pair. Existing `max-width: 760px` calendar rules stay for week mode.
- [ ] `npm run typecheck -w @tokkl/web` and `npm run build` exit 0; `npx playwright test e2e/calendar.spec.ts e2e/history-calendar-drag.spec.ts e2e/history-timezone-totals.spec.ts e2e/page-states.spec.ts` passes unchanged (desktop).

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- File: `packages/web/src/components/WeekCalendar.tsx` (single component; no second calendar component, no second drag implementation). CSS: `packages/web/src/styles.css` calendar block (~:913–991).
- Helpers from task 1: `useMediaQuery` (`lib/useMediaQuery.ts`), `DAY_MODE_QUERY`, `classifySwipe`, `clampDayMove`, `stepDay` (`lib/calendarDay.ts`).
- Wall-clock maths only via `@tokkl/common/time` (`addDays`, `startOfWeek`, `addClockMinutes`) and `instantAt`/`localDay` (`lib/entryTime.ts`).
- Do NOT implement touch long-press, `touch-action` changes, contextmenu suppression or the double-finish guard here: task 3 owns them. For the swipe, listen to pointer down/up (or touch start/end) on the grid in day mode and classify dx/dy; ignore it while a drag is active.

## Input Dependencies
Task 1: `lib/useMediaQuery.ts`, `lib/calendarDay.ts`.

## Output Artifacts
Updated `WeekCalendar.tsx` with `dayMode`, `selectedDay`, strip, toolbar and swipe; updated `styles.css`. Task 3 builds touch handling on top of this; tasks 4–6 test it.

## Implementation Notes
<details>
<summary>Detailed guidance</summary>

1. State: replace `const [weekStart, setWeekStart] = useState(...)` with `const [selectedDay, setSelectedDay] = useState(todayKey)` and `const weekStart = startOfWeek(selectedDay, settings.beginningOfWeek)`. `weekDays` = the existing 7-day memo keyed on `weekStart`; `days = dayMode ? [selectedDay] : weekDays`. Week total and the week-mode range use `weekDays`.
2. Navigation: `const step = (direction: 1 | -1) => setSelectedDay((d) => stepDay(d, dayMode ? direction : direction * 7));`. Week-mode "This week" and `T` call `setSelectedDay(todayKey)`. Note: in week mode, stepping the selected day by 7 keeps the shown week identical to the old `weekStart ± 7`.
3. Toolbar: render week-mode buttons exactly as today when `!dayMode`. In day mode render "Previous day" / "Next day" icon buttons, a ghost button for the current day whose accessible name avoids "Today" (e.g. visible "Now" or "Current day", title "Current day (T)"), and `.calendar-range` with `dayLabel`-free text such as `${weekdayName(selectedDay)}, ${shortDate(selectedDay)}`. Keep the spacer and the week total.
4. Strip: replace `.calendar-head` in day mode with `<div className="calendar-strip" role="group" aria-label="Days of the week">`. Each item: `<button type="button" className={`calendar-strip-day${day===todayKey?' today':''}`} aria-pressed={day===selectedDay} aria-label={`${weekdayName(day)} ${shortDate(day)}, ${duration(total, settings)}`} tabIndex={day===selectedDay?0:-1} onKeyDown={...arrowTarget(event.key, index, 7)...} onClick={() => setSelectedDay(day)}>`. On arrow key, set the selection and focus the target button (use refs array). Extract the per-day total into a small function shared by the head and the strip.
5. Swipe: on the `.calendar-body` in day mode, record the start point on `pointerdown` (or `touchstart`) and on `pointerup`/`touchend` call `classifySwipe(dx, dy)`; skip when a drag was active. If the browser emits `pointercancel` because it started a pan, use touch events (`touchstart`/`touchend` via React props are fine since you don't preventDefault) for the swipe instead. Optional transition: a short `transform`/`opacity` animation on `.calendar-grid` with `transition: ... var(--duration-base)`; reduced-motion zeroes it.
6. Clamp: task 1 shipped `clampDayMove(delta, top, bottom)` with no clipped flags: `clockSpanOnDay` already puts a block that started the day before at top 0 and one that runs into the next day at bottom 1440, so the clamp covers both midnight rules. In the column `onPointerMove` move branch, when `dayMode && drag.kind === 'move'`, use `clampDayMove(delta, drag.startMinute, drag.endMinute)`. Week mode keeps the unclamped delta.
7. CSS (inside the calendar block): `.calendar.day-mode .calendar-grid { grid-template-columns: 40px minmax(0, 1fr); }`; strip `display: grid; grid-template-columns: repeat(7, minmax(0,1fr));` with buttons ≥44px tall; selected item marked by `aria-pressed="true"` selector with a 3px underline/border in `--primary` plus heavier weight and `--state-selected` background; today uses the existing badge (`--primary`/`--on-primary`). If you add a colour pair not in the table at the top of styles.css (~:30–110), add a row with light and dark ratios (compute them; AA needs 4.5 for text, 3 for other). The existing `@media (max-width: 760px)` 7-column rule must still apply in week mode; make the `.day-mode` selector more specific so it wins.
8. Keep `HOUR_HEIGHT = 48` and the hint text.

Verify: `npm run typecheck -w @tokkl/web`; `npm run build`; desktop specs listed above pass unchanged (`npx playwright test <files>`).
</details>
