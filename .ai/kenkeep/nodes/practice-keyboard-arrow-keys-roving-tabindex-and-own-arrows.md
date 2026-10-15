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

<!-- kk:related:start -->
# Related

- Related: [map-shared-list-controls-in-manage-ui](map-shared-list-controls-in-manage-ui.md)
<!-- kk:related:end -->
