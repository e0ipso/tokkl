---
id: 5
group: "e2e"
dependencies: [4]
status: "completed"
created: 2026-10-18
skills:
  - playwright
  - typescript
complexity_score: 5
execution_profile: "standard-implementation"
---
# E2E: phone touch drags, scrolling and day-mode clamp

## Objective
Extend `e2e/history-calendar-drag.spec.ts` with phone-viewport touch cases that run with the New York browser and Madrid account set-up: long-press create and move, a plain vertical swipe that scrolls without creating anything, day-view resize, moves clamped to the selected day, and a single save per gesture.

## Skills Required
Playwright (CDP touch input) and TypeScript.

## Acceptance Criteria
- [x] New cases use `PHONE` (390×844, isMobile, hasTouch) and keep the spec's `timezoneId: 'America/New_York'` with the Madrid account; they call `expectBrowserTimeZone(page, 'America/New_York')`.
- [x] Long-press then drag on an empty slot creates an entry; saved start/stop (via `savedTimes`) match the expected Madrid wall-clock times.
- [x] Long-press then drag on a block moves it and keeps the duration, verified after reload; exactly one PUT is sent for the gesture (count requests with `page.on('request')`).
- [x] Long-press on the resize handle and drag changes the stop time in day mode.
- [x] A move past midnight is clamped: dragging a block down past the end of the day leaves it ending at or before 24:00 on the selected day; a block that started the previous day can't move earlier.
- [x] A plain vertical touch swipe on the grid changes `.calendar-body` `scrollTop` and creates no entry (no POST).
- [x] At least one phone drag case runs on a Madrid clock-change date (2026-03-29 or 2026-10-25), like the existing desktop cases.
- [x] Existing cases in the file are unchanged (`git diff` shows additions only). `npx playwright test e2e/history-calendar-drag.spec.ts` passes and `npx tsc -p e2e/tsconfig.json` exits 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Reuse the CDP helpers task 4 added to `e2e/history-calendar-tests-helpers.ts` (`touchLongPressDrag`, `touchSwipe`); add a small helper there only if needed.
- `HOUR = 48` px per hour; `scrollCalendarTo` positions the grid.

## Input Dependencies
Task 4 (CDP touch helpers), tasks 2–3 (implementation).

## Output Artifacts
New cases in `e2e/history-calendar-drag.spec.ts`.

## Implementation Notes
<details>
<summary>Detailed guidance</summary>

1. Read the existing three tests in `e2e/history-calendar-drag.spec.ts` for the clock set-up ("now" is late evening in New York, next day in Madrid), entry creation through `data`, and `savedTimes` assertions; mirror them with `test.describe('phone', () => { test.use(PHONE); ... })`. Check that `test.use(PHONE)` inside the describe keeps the file-level `timezoneId`.
2. Single-commit check: collect `request.method() === 'PUT'` (or POST for create) on `/api/v9/` time-entry URLs during the gesture, wait for the response, then assert the count is 1.
3. Vertical scroll: read `scrollTop` before, do `touchSwipe` vertically (or `Input.synthesizeScrollGesture` with `gestureSourceType: 'touch'`), assert `scrollTop` changed and no POST happened and no `.calendar-ghost` remains.
4. Clamp: create an entry 22:30–23:30 Madrid on the selected day, long-press drag it down 3 hours, reload, and assert stop ≤ 24:00 local and the duration is unchanged (so start moved to 23:00). For the clipped-top rule, create 23:00 previous day → 01:00 selected day, drag up, assert unchanged times.

Test philosophy (mandatory): "write a few tests, mostly integration".
- Write tests for: custom business logic and algorithms; critical user workflows and data transformations; edge cases and error conditions in core functionality; integration points between components; complex validation or calculation logic.
- Do not write tests for: third-party library and framework functionality; simple CRUD without custom logic; trivial getters/setters and static configuration; obvious functionality that would break immediately if incorrect.
- Combine related scenarios into one test where they share set-up, and favour critical-path coverage over per-method tests.
</details>
