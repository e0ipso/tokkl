---
id: 1
group: "calendar-helpers"
dependencies: []
status: "completed"
created: 2026-10-18
skills:
  - typescript
  - node-test
complexity_score: 4
execution_profile: "standard-implementation"
---
# Calendar pure helpers, unit tests and shared useMediaQuery

## Objective
Add the pure, DOM-free helpers the day view needs (swipe classification, day-mode move clamp, day stepping), cover them with node unit tests, and move `useMediaQuery` out of `App.tsx` into `packages/web/src/lib/` so the calendar can reuse it.

## Skills Required
TypeScript for the helpers and the hook move; node's built-in test runner (`node:test`) for unit tests.

## Acceptance Criteria
- [x] `packages/web/src/lib/useMediaQuery.ts` exports `useMediaQuery(query: string): boolean` (same `useSyncExternalStore` + `matchMedia` body as today); `App.tsx` imports it and no longer defines it; `PHONE_QUERY` is unchanged.
- [x] `packages/web/src/lib/calendarDay.ts` exports:
  - `DAY_MODE_QUERY` (a query true below 760px and false at exactly 760px, e.g. `'(max-width: 759.98px)'`),
  - `classifySwipe(dx, dy)` returning `'next' | 'previous' | null` (swipe left = `'next'`, swipe right = `'previous'`, vertical or short gestures = `null`),
  - `clampDayMove(delta, top, bottom, clippedTop, clippedBottom)` (or equivalent signature) returning the clamped move delta in minutes,
  - `stepDay(day, step)` returning the new selected date key using `addDays` only.
- [x] `packages/web/src/lib/calendarDay.test.ts` covers: swipe thresholds and angle (horizontal left/right, vertical scroll, diagonal, too short); clamp keeps top >= 0 and bottom <= 1440, a block clipped at the top can't move earlier, a block clipped at the bottom can't move later, the other direction still works; day stepping across a week boundary (with `startOfWeek` for beginning-of-week 0 and 1) and across the Madrid clock changes (2026-03-29, 2026-10-25).
- [x] `npm test -w @tokkl/web` exits 0 and lists the new tests as passing.
- [x] `npm run typecheck -w @tokkl/web` exits 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Wall-clock rule: day steps go through `addDays` from `@tokkl/common/time`; never add ±86400000 ms or minutes×60000.
- Helpers must be pure (no React, no DOM) so `node --test` can import them directly. Follow the existing test style in `packages/web/src/lib/timeOfDay.test.ts` / `components/arrowKeys.test.ts` (imports with `.ts` extensions).
- Swipe thresholds: pick constants (e.g. at least 50px horizontal and |dx| at least 1.5×|dy|) and export them if the component needs them.

## Input Dependencies
None.

## Output Artifacts
- `packages/web/src/lib/useMediaQuery.ts`
- `packages/web/src/lib/calendarDay.ts` and `calendarDay.test.ts`
- Updated `packages/web/src/App.tsx`

## Implementation Notes
<details>
<summary>Detailed guidance</summary>

1. Cut the `useMediaQuery` function from `packages/web/src/App.tsx` (around line 47) into `packages/web/src/lib/useMediaQuery.ts`, add `import { useSyncExternalStore } from 'react';`, export it, and import it in `App.tsx`. Remove `useSyncExternalStore` from App's react import if it becomes unused. Keep the `PHONE_QUERY` constant and its comment in `App.tsx`.
2. Create `packages/web/src/lib/calendarDay.ts`:
   - `export const DAY_MODE_QUERY = '(max-width: 759.98px)';` with a comment saying exactly 760px stays in week mode while `PHONE_QUERY` (`max-width: 760px`) still includes 760.
   - `classifySwipe(dx: number, dy: number): 'next' | 'previous' | null` — return null when `Math.abs(dx) < SWIPE_MIN_PX` or `Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)`; otherwise `dx < 0 ? 'next' : 'previous'`.
   - `clampDayMove(...)`: inputs are the snapped delta, the block's visible `top` and `bottom` in minutes on the selected day (0–1440), and whether the block is clipped at the top (entry started before the day) or the bottom (entry continues past the day's end). Rules: if clippedTop, `delta = Math.max(delta, 0)`; else `delta = Math.max(delta, -top)`. If clippedBottom, `delta = Math.min(delta, 0)`; else `delta = Math.min(delta, 1440 - bottom)`. A running entry whose block reaches "now" is not clipped at the bottom unless its span reached the day end. Document the rule in a short comment.
   - `stepDay(day: string, step: number): string` → `addDays(day, step)` (import from `@tokkl/common/time`). Week mode will call it with ±7, day mode with ±1.
3. Tests in `calendarDay.test.ts` use `import { test } from 'node:test'; import assert from 'node:assert/strict';`. Combine scenarios into a few `test()` blocks per helper; don't test `useMediaQuery` (it's a thin wrapper over the browser API).

Test philosophy (mandatory): "write a few tests, mostly integration".
- Write tests for: custom business logic and algorithms; critical user workflows and data transformations; edge cases and error conditions in core functionality; integration points between components; complex validation or calculation logic.
- Do not write tests for: third-party library and framework functionality; simple CRUD without custom logic; trivial getters/setters and static configuration; obvious functionality that would break immediately if incorrect.
- Combine related scenarios into one task and favour critical-path coverage over per-method unit tests.

Verify: `npm test -w @tokkl/web` and `npm run typecheck -w @tokkl/web`, both exit 0.
</details>
