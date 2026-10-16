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
- After a row is removed, `focusPastRow` in `packages/web/src/pages/AdminPage.tsx` moves focus to the same `data-row-action` control in the next row, else the previous row, else a fallback: the section heading, which is focusable with `tabIndex={-1}` (`titleRef` on `SettingsCard`). It is local to `AdminPage` for now.

<!-- kk:related:start -->
# Related

- Related: [map-shared-list-controls-in-manage-ui](../web-ui-styling-and-layout/map-shared-list-controls-in-manage-ui.md)
<!-- kk:related:end -->
