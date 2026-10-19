---
id: 7
group: "docs"
dependencies: []
status: "completed"
created: 2026-10-18
skills:
  - technical-writing
complexity_score: 2
execution_profile: "docs-and-config"
---
# Update PRD L10 and the README calendar paragraph

## Objective
Describe the responsive calendar in `docs/PRD.md` row L10 (line ~120) and `README.md` line ~28.

## Skills Required
Technical writing in Markdown.

## Acceptance Criteria
- [ ] PRD L10 says: week view at 760px and wider; below 760px a day view with a strip of the week's days and their totals; arrows and horizontal swipes move one day and cross weeks; touch drags start after a long press (both views), mouse drags are immediate; `T` jumps to today in the day view and this week in the week view. Priority and status columns stay `SHOULD` / `Done`; the table stays valid (one row, pipes intact).
- [ ] README's **Calendar.** paragraph describes the same behaviour in user terms and keeps the existing drag instructions.
- [ ] `grep -n 'L10' docs/PRD.md` and `sed -n 28p README.md` show the new text. `npm run check:tracker-refs` exits 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
Markdown only. Plain, short sentences; match the surrounding tone. No issue numbers or tracker references in the prose unless the repo convention allows them (`check:tracker-refs` enforces this).

## Input Dependencies
None (behaviour is fixed by the plan).

## Output Artifacts
Updated `docs/PRD.md` and `README.md`.

## Implementation Notes
<details>
<summary>Detailed guidance</summary>

Current L10: `| L10 | Calendar (week) view with drag to create, move and resize; `T` jumps to this week. | SHOULD | Done |`.
Current README: `**Calendar.** A week view in the account's timezone. Drag on an empty slot to add an entry, drag a block to move it, or drag its bottom edge to change the end.`
Suggested README: `**Calendar.** A week view in the account's timezone; on screens narrower than 760px it shows one day, with the week's days and totals in a strip above. Arrows or a sideways swipe move one day. Drag on an empty slot to add an entry, drag a block to move it, or drag its bottom edge to change the end. On a touchscreen, press and hold before dragging. T jumps to today, or to this week in the week view.`
</details>
