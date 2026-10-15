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
The comment at the top of `packages/web/src/styles.css` lists every token text/background pair with its WCAG 2 ratio in both themes. AA needs 4.5:1 for text and 3:1 for non-text parts such as borders, icons and focus rings. When a colour changes or a new pair appears, compute the ratios with a script (rounded down) and update the table. Do not fade text with `opacity`: the rendered ratio then no longer matches the table. The entry-row Project placeholder and the empty-tags icon use `--muted` at full opacity for this reason.

A second table, next to `.project-dot`, gives the contrast of the 14 palette colours and of `--muted` (no project) against surface, surface-2, state-selected and the calendar tint. Components set only `--project-color`, through `projectColorStyle()` in `packages/web/src/components/Pickers.tsx`. The CSS derives the dot and border (the hex mixed 60% with black in light, white in dark) and the 18% calendar tint with `color-mix()`. Text never takes the project colour; it stays `--text`.

Projects can store any `#rrggbb` (`packages/api/src/models/projects.ts`), and `PROJECT_COLORS` in `packages/common/colors.ts` is Toggl Track's default palette. Stored colours are user data, so contrast is fixed in the CSS mix, not by editing the palette.

A custom property derived from `var(--project-color)` must be declared on the rule that uses it. Declared on `:root`, its `var()` resolves once at the root, where `--project-color` is unset, and every element inherits that result.

Colour literals in CSS live only in the token block on `:root` at the top of `styles.css`; rules elsewhere (including `manage.css` and `reports.css`) use tokens, and hex values outside it appear only in comments and contrast tables. Mixes that used to be inline are tokens: `--project-mix` (what a project colour is mixed with for its dot and border), `--chart-other-wash` (the wash behind non-billable stripes), `--chart-band` (the band behind the hovered or focused chart column) and `--swatch-check-light` / `--swatch-check-dark`.

The check mark on a chosen colour swatch sits on the raw hex in both themes, so it cannot follow the theme. `checkColor` in `packages/web/src/pages/manage/swatchCheck.ts` picks whichever check token has the higher WCAG ratio against that hex, and `ColorField.tsx` sets it per swatch as `--swatch-check`. The worst palette case is 4.43:1 (the dark check on `#9e5bd9`), which passes the 3:1 non-text bar; `swatchCheck.test.ts` pins it and the table in `manage.css` records it.

<!-- kk:related:start -->
# Related

- Related: [practice-theme-tokens-data-theme-and-cached-theme](practice-theme-tokens-data-theme-and-cached-theme.md)
<!-- kk:related:end -->
