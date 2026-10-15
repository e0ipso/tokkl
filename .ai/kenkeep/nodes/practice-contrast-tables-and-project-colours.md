---
type: practice
title: Contrast tables in styles.css; project colours never paint text
description: >-
  New colour pairs get a computed row in the styles.css contrast table. No
  opacity on text. A project hex only sets --project-color.
tags:
  - web
  - css
  - accessibility
  - contrast
  - projects
kk_schema_version: 3
kk_id: practice-contrast-tables-and-project-colours
kk_derived_from: []
kk_relates_to:
  - practice-theme-tokens-data-theme-and-cached-theme
kk_depends_on: []
kk_confidence: high
---
The comment at the top of `web/src/styles.css` lists every token text/background pair with its WCAG 2 ratio in both themes. AA needs 4.5:1 for text and 3:1 for non-text parts such as borders, icons and focus rings. When a colour changes or a new pair appears, compute the ratios with a script (rounded down) and update the table. Do not fade text with `opacity`: the rendered ratio then no longer matches the table. The entry-row Project placeholder and the empty-tags icon use `--muted` at full opacity for this reason.

A second table, next to `.project-dot`, gives the contrast of the 14 palette colours and of `--muted` (no project) against surface, surface-2, state-selected and the calendar tint. Components set only `--project-color`, through `projectColorStyle()` in `web/src/components/Pickers.tsx`. The CSS derives the dot and border (the hex mixed 60% with black in light, white in dark) and the 18% calendar tint with `color-mix()`. Text never takes the project colour; it stays `--text`.

Projects can store any `#rrggbb` (`server/src/models/projects.ts`), and `PROJECT_COLORS` in `shared/colors.ts` is Toggl Track's default palette. Stored colours are user data, so contrast is fixed in the CSS mix, not by editing the palette.

A custom property derived from `var(--project-color)` must be declared on the rule that uses it. Declared on `:root`, its `var()` resolves once at the root, where `--project-color` is unset, and every element inherits that result.

<!-- kk:related:start -->
# Related

- Related: [practice-theme-tokens-data-theme-and-cached-theme](practice-theme-tokens-data-theme-and-cached-theme.md)
<!-- kk:related:end -->
