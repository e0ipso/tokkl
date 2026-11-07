---
type: practice
title: "styles.css orders the cascade and owns the colour tokens"
description: "styles.css imports every sheet in cascade order, page sheets first; page CSS uses its tokens and no colour literals."
tags:
  - web
  - css
  - cascade
  - tokens
  - reports
kk_schema_version: 3
kk_id: practice-styles-css-loads-last-and-owns-colour-tokens
kk_derived_from: []
kk_relates_to:
  - practice-contrast-tables-and-project-colours
  - map-shared-list-controls-in-manage-ui
  - practice-theme-tokens-data-theme-and-cached-theme
kk_depends_on: []
kk_confidence: high
---
`packages/web/src/styles.css` is the only stylesheet a module imports (`main.tsx` imports it once), and its `@import` list is the cascade. The page sheets (`pages/manage/manage.css`, `pages/reports/reports.css`, `pages/PomodoroPage.css`) come first and the app-wide sheets under `styles/` after them, so the app-wide rules win every tie of equal specificity whatever order the modules load in. A page rule that overrides an app-wide class adds a second class to win, for example `.hint.manage-intro`. Pages and components do not import CSS; a new sheet goes into that list, and its position decides which rules win. The built CSS was byte-identical before and after the sheets moved into the list.

Colours belong in the token block of `styles.css` (`styles/tokens.css`), where each pair gets a row in the contrast table. The page stylesheets only reference tokens and contain no colour literals. The report table tokens live there too: `--report-zebra` (an alias of `--chart-band`), `--report-head-bg` and `--report-head-text`.

<!-- kk:related:start -->
# Related

- Related: [practice-contrast-tables-and-project-colours](practice-contrast-tables-and-project-colours.md)
- Related: [map-shared-list-controls-in-manage-ui](../shell-and-layout/map-shared-list-controls-in-manage-ui.md)
- Related: [practice-theme-tokens-data-theme-and-cached-theme](practice-theme-tokens-data-theme-and-cached-theme.md)
<!-- kk:related:end -->
