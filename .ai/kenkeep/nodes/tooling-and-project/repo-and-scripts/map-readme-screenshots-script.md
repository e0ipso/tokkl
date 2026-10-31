---
type: map
title: 'README screenshots: npm run screenshots'
description: >-
  scripts/screenshots.ts rebuilds the ten docs/screenshots PNGs on a frozen
  clock; SQLite unixepoch('now') ignores it, so the timer stops.
tags:
  - tooling
  - docs
  - screenshots
  - playwright
kk_schema_version: 3
kk_id: map-readme-screenshots-script
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:1'
kk_relates_to:
  - practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory
  - map-test-and-static-analysis-layout
kk_depends_on: []
kk_confidence: high
---
`npm run screenshots` builds the web app and runs `scripts/screenshots.ts` under its own Playwright config, `scripts/screenshots.config.ts` (port `SCREENSHOTS_PORT`, default 8096, and a throwaway data directory). The config lives outside `e2e/`, so `npm run test:e2e` never runs it. It rewrites the ten images in `docs/screenshots/`. The README previews `desktop-timer.png` and `mobile-calendar.png`; the full gallery stays in `docs/screenshots/`.

The data is `e2e/fixtures-data/transfer/restore-full.json` plus the extra records in `scripts/screenshots-data.ts`, which also exports `NOW` (`2026-07-16T13:20:00.000Z`, 15:20 in Europe/Madrid) and `TIME_ZONE`. The browser clock is fixed with `page.clock.setFixedTime(NOW)`, and the server starts with a `data:` URL `--import` that replaces `Date` with one that always reads `NOW`.

- That frozen `Date` does not reach SQLite. Project and task totals for a running entry use `unixepoch('now')` (`packages/api/src/domain/catalogs.ts`), while `entryDurationSeconds` (`packages/api/src/domain/timeEntries.ts`) uses JS time. The script therefore stops the running timer and takes the Projects capture last.
- The session cookie expires `TOKKL_SESSION_DAYS` after the frozen `NOW`, because the throwaway instance has no stored `session_days` setting. The config sets 36500, or the browser would drop the cookie as already expired once the real date passes `NOW` plus 30 days.

- The config's `globalSetup` is only `e2e/chromium-check.ts`. The script creates its own demo admin through setup, so it must not go through `e2e/global-setup.ts`, which also creates the e2e setup admin and deletes leftover e2e worker accounts.
- `desktop-admin.png` needs more than one account on the Admin page. After the restore, `inviteUsers` invites Marta Puig (admin) and Joan Serra (user) through the invite API, accepting each from a separate request context so the demo session cookie is untouched. The one-time invite link never reaches a page or an image.

<!-- kk:related:start -->
# Related

- Related: [practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory](../testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md)
- Related: [map-test-and-static-analysis-layout](../testing/map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:1
<!-- kk:citations:end -->
