---
type: practice
title: Contrast tables in styles.css; project colours never paint text
description: >-
  Colour pairs get a computed row in the styles.css table; text uses
  --primary-text, not --primary; a project hex only sets --project-color.
tags:
  - web
  - css
  - accessibility
  - contrast
  - projects
  - tokens
kk_schema_version: 3
kk_id: practice-contrast-tables-and-project-colours
kk_derived_from: []
kk_relates_to:
  - practice-theme-tokens-data-theme-and-cached-theme
kk_depends_on: []
kk_confidence: high
---
The comment at the top of `packages/web/src/styles.css` lists every token text/background pair with its WCAG 2 ratio in both themes. AA needs 4.5:1 for text and 3:1 for non-text parts such as borders, icons and focus rings. When a colour changes or a new pair appears, compute the ratios with a script (rounded down) and update the table. Do not fade text with `opacity`: the rendered ratio then no longer matches the table. The entry-row Project placeholder and the empty-tags icon use `--muted` at full opacity for this reason.

A second table, next to `.project-dot`, gives the contrast of the 14 palette colours and of `--muted` (no project) against surface, surface-2, state-selected and the calendar tint. Components set only `--project-color`, through `projectColorStyle()` in `packages/web/src/components/Pickers.tsx`. The CSS derives the dot and border (the hex mixed 60% with `--project-mix`, the ink `#08061f` in light and white in dark) and the 18% calendar tint with `color-mix()`. Text never takes the project colour; it stays `--text`.

Projects can store any `#rrggbb` (`packages/api/src/models/projects.ts`), and `PROJECT_COLORS` in `packages/common/colors.ts` is Toggl Track's default palette. Stored colours are user data, so contrast is fixed in the CSS mix, not by editing the palette.

A custom property derived from `var(--project-color)` must be declared on the rule that uses it. Declared on `:root`, its `var()` resolves once at the root, where `--project-color` is unset, and every element inherits that result.

Colour literals in CSS live only in the token block on `:root` at the top of `styles.css`; rules elsewhere (including `manage.css` and `reports.css`) use tokens, and hex values outside it appear only in comments and contrast tables. Mixes that used to be inline are tokens: `--project-mix` (what a project colour is mixed with for its dot and border), `--chart-other-wash` (the wash behind non-billable stripes), `--chart-band` (the band behind the hovered or focused chart column) and `--swatch-check-light` / `--swatch-check-dark`.

The check mark on a chosen colour swatch sits on the raw hex in both themes, so it cannot follow the theme. `checkColor` in `packages/web/src/pages/manage/swatchCheck.ts` picks whichever check token has the higher WCAG ratio against that hex, and `ColorField.tsx` sets it per swatch as `--swatch-check`. The worst palette case is 4.68:1 (the dark check, the ink `#08061f`, on `#9e5bd9`), which passes the 3:1 non-text bar; `swatchCheck.test.ts` pins it and the table in `manage.css` records it. When a token change moves that figure, update the test and the table together.

The palette is the owner's Spectrum table, taken from the wordmark's hues. A token the owner did not set carries a comment naming the wordmark hue it comes from, and a value moved for AA keeps its reason beside it (light `--surface-2` is `#f3f1ea`, not `#f1eee6`, because primary on `#f1eee6` was 2.94:1). Two token pairs look alike and have separate jobs:

- `--primary` is for fills (buttons, the active nav link, the today badge), bars, borders, rings and icons. Text in the primary colour uses `--primary-text` (`#b23c00` light, `#ff8a3d` dark), because light `--primary` is 3.40:1 on surface, enough for a fill but not for text. Links, link buttons and other primary-coloured text take `--primary-text`.
- `--selected` with `--on-selected` content fills the active segmented and mode-switch buttons. `--state-selected` is the tint behind selected rows, picker items and the chosen calendar strip day (`--calendar-today` mixes it with surface), and it carries text in both themes. Do not swap one for the other.

The dark chart pair (`--chart-billable` `#00b9fa`, `--chart-other` `#ff9500`) passes WCAG but sits above the dataviz palette check's lightness band (OKLCH L 0.74 and 0.77). The owner agreed to it, and the comment in the contrast table says so, so a failing lightness check on the dark pair is expected.

<!-- Verified against the current code on 2026-10-19. -->

<!-- kk:related:start -->
# Related

- Related: [practice-theme-tokens-data-theme-and-cached-theme](practice-theme-tokens-data-theme-and-cached-theme.md)
<!-- kk:related:end -->
