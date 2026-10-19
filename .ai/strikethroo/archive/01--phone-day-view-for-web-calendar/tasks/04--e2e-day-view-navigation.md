---
id: 4
group: "e2e"
dependencies: [2, 3]
status: "completed"
created: 2026-10-18
skills:
  - playwright
  - typescript
complexity_score: 5
execution_profile: "standard-implementation"
---
# E2E: CDP touch helper and day-view navigation cases

## Objective
Add a CDP touch helper to `e2e/history-calendar-tests-helpers.ts` and extend `e2e/calendar.spec.ts` with phone-viewport cases for the day view: initial state, strip, swipes and arrows across a week boundary, `T` in both modes, and week mode at exactly 760px and at 1024px.

## Skills Required
Playwright (including CDP sessions) and TypeScript.

## Acceptance Criteria
- [x] `history-calendar-tests-helpers.ts` exports CDP helpers built on `page.context().newCDPSession(page)` and `Input.dispatchTouchEvent`: at least `touchSwipe(page, from, to, opts)` (horizontal or vertical, with intermediate moves) and `touchLongPressDrag(page, from, to, holdMs = 600)`. A vertical scroll may use `Input.synthesizeScrollGesture` if dispatchTouchEvent doesn't scroll.
- [x] New `calendar.spec.ts` cases with `test.use(PHONE)` (from `e2e/mobile-tests-helpers.ts`), in a `test.describe` block so desktop cases keep their settings:
  - one `.calendar-column` shown at first, and the strip item for today has `aria-pressed="true"`;
  - the strip has seven days with correct totals, starts on the account's `beginning_of_week` (set with `ReportApi.setWeekStart` from `e2e/report-tests-helpers.ts`, testing a non-default value), and tapping a day selects it and shows its entries;
  - swipe left/right and the previous/next arrows change the day, including across a week boundary (range text and strip move to the adjacent week);
  - `T` returns to today in day mode;
- [x] Week-mode cases at 760×900 and 1024×768: seven `.calendar-column` elements, buttons "Previous week", "Next week", "This week", no strip, and `T` returns to this week after navigating away.
- [x] Existing desktop cases in `calendar.spec.ts` are unchanged (`git diff e2e/calendar.spec.ts` shows only additions).
- [x] `npx playwright test e2e/calendar.spec.ts` passes (run `npm run build` first if the server serves `dist/web`). `npx tsc -p e2e/tsconfig.json` exits 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Playwright 1.64.1: `page.touchscreen` only taps. Synthetic DOM events don't scroll or respect `touch-action`, so use CDP.
- Fixed clock: use `page.clock.setFixedTime` (real timers still run, so the 500 ms long press fires).
- Accessible names set by task 2: read `packages/web/src/components/WeekCalendar.tsx` for the exact day-mode button names and strip group label before writing locators.

## Input Dependencies
Tasks 2 and 3 (day mode and touch handling in `WeekCalendar.tsx`).

## Output Artifacts
CDP touch helpers in `e2e/history-calendar-tests-helpers.ts` (task 5 reuses them) and new cases in `e2e/calendar.spec.ts`.

## Implementation Notes
<details>
<summary>Detailed guidance</summary>

1. Helper sketch:
```ts
async function touch(page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) {
  const cdp = await page.context().newCDPSession(page); // cache per page in a WeakMap
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}
```
   `touchEnd` takes `touchPoints: []`. Swipe: start, ~10 moves with small waits, end. Long-press drag: start, wait `holdMs` (`page.waitForTimeout` is acceptable here because the app uses a real timer), then moves in steps to the target, then end.
2. Read `e2e/mobile-timer.spec.ts` and `e2e/calendar.spec.ts` for login, `TimerApi`, and `openCalendar`/`tap` patterns. `openCalendar` waits for `.calendar-column.today`, which still exists in day mode when today is selected.
3. Week boundary: fix the clock on the last day of the week, press next (or swipe left) and assert the range text and the strip show the next week, and that the strip item for the new day is pressed. Then go back.
4. Totals: create entries via the API on two days of the week and assert the strip items' text/names contain the formatted durations.
5. For 760px: `test.use({ viewport: { width: 760, height: 900 } })` in its own describe (not `PHONE`), and a separate 1024×768 describe.

Test philosophy (mandatory): "write a few tests, mostly integration".
- Write tests for: custom business logic and algorithms; critical user workflows and data transformations; edge cases and error conditions in core functionality; integration points between components; complex validation or calculation logic.
- Do not write tests for: third-party library and framework functionality; simple CRUD without custom logic; trivial getters/setters and static configuration; obvious functionality that would break immediately if incorrect.
- Combine related scenarios into one test where they share set-up, and favour critical-path coverage over per-method tests.
</details>
