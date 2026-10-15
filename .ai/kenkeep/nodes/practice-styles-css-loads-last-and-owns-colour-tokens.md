---
type: practice
title: "styles.css loads last and owns the colour tokens"
description: "styles.css wins equal-specificity ties with page CSS, which uses its tokens and no colour literals."
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
The page stylesheets (`pages/manage/manage.css`, `pages/reports/reports.css`) are imported by the page components, which `App.tsx` pulls in before `packages/web/src/main.tsx` imports `./styles.css`. So `styles.css` comes later in the bundle and wins every tie of equal specificity. A page rule that overrides a `styles.css` class adds a second class to win, for example `.hint.manage-intro`. Reordering the imports in `main.tsx` changes which rules win across the app.

Colours belong in the token block of `styles.css`, where each pair gets a row in the contrast table. The page stylesheets only reference tokens and contain no colour literals. The report table tokens live there too: `--report-zebra` (an alias of `--chart-band`), `--report-head-bg` and `--report-head-text`.

<!-- kk:related:start -->
# Related

- Related: [practice-contrast-tables-and-project-colours](practice-contrast-tables-and-project-colours.md)
- Related: [map-shared-list-controls-in-manage-ui](map-shared-list-controls-in-manage-ui.md)
- Related: [practice-theme-tokens-data-theme-and-cached-theme](practice-theme-tokens-data-theme-and-cached-theme.md)
<!-- kk:related:end -->
