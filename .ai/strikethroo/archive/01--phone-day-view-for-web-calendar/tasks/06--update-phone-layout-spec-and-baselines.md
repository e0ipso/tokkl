---
id: 6
group: "e2e"
dependencies: [2, 3]
status: "completed"
created: 2026-10-18
skills:
  - playwright
complexity_score: 3
execution_profile: "standard-implementation"
---
# Update the phone calendar layout spec and visual baselines

## Objective
Update `e2e/mobile-timer.spec.ts` ("the week calendar fits a phone screen with long block and favourite names", ~:85–113), which assumes seven columns, for the one-column day view, and regenerate the two phone calendar visual baselines.

## Skills Required
Playwright.

## Acceptance Criteria
- [ ] The test asserts the day view on a phone: one `.calendar-column`, the toolbar, strip and scrolling body fit the screen (`expectFits`), no page overflow, and both blocks for today are visible and fit. Replace `.calendar-day-head` references with the strip where they no longer apply; rename the test if "week calendar" is now wrong.
- [ ] `e2e/visual.spec.ts-snapshots/timer-calendar-phone-light-desktop-linux.png` and `timer-calendar-phone-dark-desktop-linux.png` are regenerated with the default headless shell; no other baseline changes (`git status e2e/visual.spec.ts-snapshots` lists only those two).
- [ ] The regenerated images were opened and checked: one day column, the strip with seven days and a visible selected-day mark in both themes.
- [ ] `npx playwright test e2e/mobile-timer.spec.ts e2e/visual.spec.ts` passes.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Regenerate with `npm run build && npx playwright test visual --update-snapshots=all`, then revert any baseline other than the two phone calendar files (`git checkout -- <file>`) and investigate if others changed.
- Do not regenerate `docs/screenshots/mobile-calendar.png` (out of scope).

## Input Dependencies
Tasks 2 and 3.

## Output Artifacts
Updated `e2e/mobile-timer.spec.ts` and two PNG baselines.

## Implementation Notes
<details>
<summary>Detailed guidance</summary>

1. Read `e2e/mobile-timer.spec.ts` around lines 85–113 and the strip markup in `packages/web/src/components/WeekCalendar.tsx`. Swap `expectFits(page.locator('.calendar-day-head').last())` for the last strip button, and keep the block assertions (`.calendar-column.today` group locator).
2. If the visual run reports diffs in other screenshots, they're regressions or flakes: don't commit them; report them.

Test philosophy (mandatory): "write a few tests, mostly integration".
- Write tests for: custom business logic and algorithms; critical user workflows and data transformations; edge cases and error conditions in core functionality; integration points between components; complex validation or calculation logic.
- Do not write tests for: third-party library and framework functionality; simple CRUD without custom logic; trivial getters/setters and static configuration; obvious functionality that would break immediately if incorrect.
- Combine related scenarios into one test where they share set-up, and favour critical-path coverage over per-method tests.
</details>
