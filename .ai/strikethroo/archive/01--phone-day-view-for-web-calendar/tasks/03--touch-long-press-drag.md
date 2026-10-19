---
id: 3
group: "calendar-touch"
dependencies: [2]
status: "completed"
created: 2026-10-18
skills:
  - react
  - pointer-events
complexity_score: 6
complexity_notes: "Subtle browser gesture semantics (pan-y, pointercancel, implicit capture, non-passive touchmove), but confined to WeekCalendar and one CSS rule."
execution_profile: "complex-architecture"
---
# Touch long-press drag, vertical panning and single-commit finish

## Objective
Let touch users scroll the calendar grid vertically and start create/move/resize drags only after a 500 ms long press, in both day and week mode, while mouse and pen dragging stay immediate. Make sure a gesture commits at most once and that pointer cancel drops a drag without saving.

## Skills Required
React (refs, effects, native listeners) and pointer/touch event semantics.

## Acceptance Criteria
- [ ] `.calendar-column` uses `touch-action: pan-y` (not `none`) and `-webkit-touch-callout: none`; `contextmenu` is suppressed on the grid.
- [ ] For `event.pointerType === 'touch'`, pointer down on a column or block arms a 500 ms timer; movement over 10 px, pointer up or pointer cancel before it fires disarms it and no drag starts. When it fires, the same `Drag` state the mouse path uses becomes active.
- [ ] While a touch drag is active, a native non-passive `touchmove` listener (`{ passive: false }`) on the calendar calls `preventDefault()`, so the grid doesn't scroll; it's removed or inert when no drag is active.
- [ ] Mouse and pen (`pointerType !== 'touch'`) start drags immediately exactly as before.
- [ ] Finishing is single-shot: pointer up followed by pointer leave (or any repeat) sends at most one POST/PUT. `pointercancel` during an active drag clears it without saving.
- [ ] The day-mode swipe from task 2 doesn't fire when a long press activated a drag.
- [ ] `npm run typecheck -w @tokkl/web` and `npm run build` exit 0; desktop `npx playwright test e2e/calendar.spec.ts e2e/history-calendar-drag.spec.ts` passes unchanged.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- File: `packages/web/src/components/WeekCalendar.tsx`; CSS rule `.calendar-column` in `packages/web/src/styles.css` (~:949).
- No `setPointerCapture`. React touch handlers are passive, and changing `touch-action` mid-gesture has no effect, so blocking scroll must use `addEventListener('touchmove', fn, { passive: false })` on a ref'd element.
- Constants: `LONG_PRESS_MS = 500`, `LONG_PRESS_TOLERANCE_PX = 10`.
- `page.clock.setFixedTime` in e2e leaves real timers running, so a `setTimeout` is fine.

## Input Dependencies
Task 2: day-mode `WeekCalendar` with swipe handling and the drag code.

## Output Artifacts
Touch-ready `WeekCalendar.tsx` and updated `.calendar-column` CSS, consumed by e2e tasks 4 and 5.

## Implementation Notes
<details>
<summary>Detailed guidance</summary>

1. Refactor the two `onPointerDown` handlers so they compute the would-be `Drag` value (create on column, move/resize on block) and pass it to `beginDrag(event, next)`:
   - if `event.pointerType !== 'touch'`: `setDrag(next)` immediately (current behaviour).
   - else: store `{ next, x: event.clientX, y: event.clientY, pointerId }` in a `pending` ref and `setTimeout(() => { activate pending }, LONG_PRESS_MS)`. On activation set the drag. For move/resize, `originY` must be the original press Y; for create, the minute at the press point.
2. On pointer move: if a pending long press exists and `Math.hypot(dx, dy) > LONG_PRESS_TOLERANCE_PX`, clear the timer and the pending ref. With `pan-y`, the browser may send `pointercancel` when it starts scrolling; handle `onPointerCancel` on `.calendar` by clearing the pending timer and dropping any active drag (`setDrag(null)` without saving).
3. Guard against double finish: keep a `dragRef` mirroring `drag` (or a `finishing` ref). `finishDrag` reads and clears the ref synchronously at the top (`const current = dragRef.current; dragRef.current = null; if (!current) return;`). This fixes pointer up then pointer leave on touch, because state from the closure can be stale between the two events. Also clear any pending long-press timer on pointer up.
4. Non-passive listener: `useEffect` on the `.calendar` root ref adding `touchmove` with `{ passive: false }` that calls `event.preventDefault()` when `dragRef.current` is set (touch drag active). Remove it on cleanup.
5. `onContextMenu={(e) => e.preventDefault()}` on `.calendar-grid` (long press on Android Chrome opens a context menu otherwise).
6. CSS: `.calendar-column { touch-action: pan-y; -webkit-touch-callout: none; ... }` — keep `user-select: none`.
7. Swipe interplay: when the long press activated, mark the gesture so the swipe handler from task 2 ignores its end.
8. Clear the timer on unmount.

Verify: typecheck, build, and the existing desktop calendar specs pass unchanged. Touch behaviour is proven by tasks 4 and 5.
</details>
