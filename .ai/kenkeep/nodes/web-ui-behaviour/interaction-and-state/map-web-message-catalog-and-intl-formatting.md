---
type: map
title: 'UI text: the typed message catalog, t() and tx(), and Intl formatting'
description: >-
  Every user-facing string is a key in packages/web/src/i18n/en/<feature>.ts,
  read with t or tx; dates use Intl pinned to en, numbers the browser locale.
tags:
  - web
  - i18n
  - a11y
  - react
  - e2e
kk_schema_version: 3
kk_id: map-web-message-catalog-and-intl-formatting
kk_derived_from: []
kk_relates_to:
  - map-web-page-state-and-field-error-components
  - map-shared-list-controls-in-manage-ui
kk_depends_on: []
kk_confidence: high
---
User-facing text in `packages/web/src` lives in one English catalog, one module per feature under `packages/web/src/i18n/en/` (`common`, `dates`, `shell`, `timer`, `entries`, `calendar`, `pomodoro`, `reports`, `manage`, `settings`, `admin`, `auth`, `api`). `i18n/messages.ts` assembles them as `en` and exports `t(key, params)`. A key is `feature.message`, such as `t('manage.deleteNamed', { name })`. Keys and parameters are typed from the catalog: a misspelt key, a missing placeholder value or a missing `count` fails `tsc`. `Translation` is the type another language's catalog would have.

- Messages use named placeholders in braces. Numbers fill them as written, without grouping; pass `formatCount(n)` from `lib/format.ts` where the old code used `toLocaleString()`.
- A message that depends on a count is a plural object (`{ one, other }`, any `Intl.LDMLPluralRule` allowed). `t` picks the form with `Intl.PluralRules(LOCALE)` from `params.count`. Where English said "entries" even for one (bulk failures, "First n problems", the chart descriptions), both forms keep that wording so the text did not change.
- `tx(key, params)` in `i18n/rich.ts` fills placeholders with React nodes, for sentences that hold `<code>` or `<strong>` (the API base URL hint, the browser time zone notice, the delete confirmation label). Keep such a sentence whole in the catalog rather than splitting it around the markup.
- Label tables (`NAV`, `ROLES`, `LENGTH_FIELDS`, `POMODORO_NUMBERS`, `THEMES`, report presets and groupings, colour names) hold catalog keys and render them with `t` at use, not strings computed at import.

`i18n/locale.ts` has `LOCALE = 'en'`, the language of the catalog and of the `Intl` names in `lib/format.ts`: `weekdayName`, `dayOfWeekName`, `monthName`, `shortDate`, the AM/PM in `formatTime` and the Today/Yesterday of `dayLabel` (`Intl.RelativeTimeFormat` with `numeric: 'auto'`, first letter upper-cased). The `dates` group holds the patterns that order the parts, such as `{day} {month}`, so the output matched the old English tables byte for byte; `lib/format.test.ts` compares them over every day of 2023 to 2028 and every minute of a day in six time zones. `NUMBER_LOCALE` is `undefined`: numbers, percentages and money follow the browser's locale, as before.

e2e specs and the visual baselines match visible text and accessible names, so a catalog edit changes what they find. `i18n/messages.test.ts` checks key shapes and plural forms; developer-only errors such as "useToast must be used inside ToastProvider" stay inline.

<!-- Verified against the current code on 2026-11-07. -->
