---
type: practice
title: 'Arrow keys: arrowTarget for roving tabindex; global shortcuts yield'
description: >-
  Option groups move focus with arrowTarget and one tab stop; global arrow
  shortcuts skip defaultPrevented events and [data-own-arrows] targets.
tags:
  - web
  - a11y
  - keyboard
  - react
  - reports
kk_schema_version: 3
kk_id: practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows
kk_derived_from: []
kk_relates_to:
  - map-shared-list-controls-in-manage-ui
kk_depends_on: []
kk_confidence: high
---
`arrowTarget(key, index, count, vertical)` in `packages/web/src/components/arrowKeys.ts` maps an arrow key, Home or End to the next option index, wrapping at the ends, and returns `null` for other keys. A vertical list ignores Left and Right so the caret keeps them. Use it for any group of options instead of writing new key handling:

- Radio-style groups (the colour radiogroup in `pages/manage/ColorField.tsx`, the range presets in `pages/reports/RangeControl.tsx`) use roving tabindex: only the current option has `tabIndex=0`, the rest `-1`, and arrows move focus.
- Pickers whose focus must stay in a search field (the project picker in `components/Pickers.tsx`) are a `role=combobox` that points at the active option with `aria-activedescendant`; Enter picks it.

Page-level arrow shortcuts, such as Left/Right shifting the report range in `RangeControl.tsx`, must yield to widgets that use the arrows themselves. The handler returns early when `event.defaultPrevented` is set (a widget already handled the key) or when the target is inside `[data-own-arrows]` (the report chart in `SeriesChart.tsx` sets it), as well as for text fields and open modals or popovers. Test the target with `instanceof Element` and `closest()`, not `instanceof HTMLElement`. Chart targets are SVG elements, which are not HTMLElements, so an HTMLElement check lets their keys through.

Focus must not fall to the page body when something the user was on goes away:

- `Modal` in `packages/web/src/components/Overlay.tsx` remembers `document.activeElement` on its first render and refocuses it on unmount, but only when focus is then on the body or inside the modal and the element is still connected. A caller that moved focus elsewhere first (for example to the next row) keeps control. Backdrop presses call `preventDefault` so the browser does not drop focus when the backdrop goes.
- `RowMenu` in `packages/web/src/pages/manage/ui.tsx` focuses its button before it runs an item, so a modal opened from a menu returns focus to "More actions" instead of to an item that has just unmounted.
- After a row leaves a list (archive or restore under a status filter, delete, revoke), `packages/web/src/pages/manage/rowFocus.ts` moves focus so the keyboard user keeps their place. `focusPastRow(container, id, action, fallback)` works on any element whose direct children are the rows (a `tbody` or the task `ul`), and focuses the enabled `data-row-action="<action>"` control in the next row, else the previous row, else `fallback`, a heading that is focusable with `tabIndex={-1}` (the `h1` on Projects, Clients and Tags, a section heading on the Admin page; `manage.css` gives these a focus ring). Rows carry `data-id`, and `RowMenu` buttons carry `data-row-action="menu"`; other controls name their own action (`delete`, `reset`, `revoke`). `rowAction` finds one such control by row id.
- `keepFocusPastRow` is `focusPastRow` guarded: it moves focus only when it would be lost, that is when focus is on the body or inside the removed row. Use it where the row leaves after a request or refetch and the user may have moved on (a restore or an invite revoke); focus they put elsewhere stays. Call `focusPastRow` itself after a dialog-confirmed action, because the dialog held focus and `Modal` would otherwise return it to a button that is about to unmount. Used on the admin users and invites tables and on the Projects, Clients and Tags pages. The task list in the project editor (`ProjectTasks.tsx`) uses it with `delete` as the action: the inline confirm focuses Keep when it opens, and Keep returns focus to that task's Delete task. After a delete, focus goes to the next task's Delete task, else the previous one's, else the new task field, else (archived project, no new task field) the `h3` "Tasks", which has `tabIndex={-1}` and a `:focus-visible` ring in `manage.css`.

<!-- kk:related:start -->
# Related

- Related: [map-shared-list-controls-in-manage-ui](../web-ui-styling-and-layout/map-shared-list-controls-in-manage-ui.md)
<!-- kk:related:end -->
