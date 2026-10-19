---
type: practice
title: 'Visual baselines: e2e/visual.spec.ts and how to refresh them'
description: >-
  24 toHaveScreenshot baselines tied to the default headless shell; refresh with
  --update-snapshots=all; tiny elements need their own check.
tags:
  - testing
  - e2e
  - playwright
  - visual
kk_schema_version: 3
kk_id: practice-visual-screenshot-baselines
kk_derived_from: []
kk_relates_to:
  - practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory
  - map-app-icons-script
  - map-readme-screenshots-script
kk_depends_on: []
kk_confidence: high
---
`e2e/visual.spec.ts` holds 24 `toHaveScreenshot` baselines in `e2e/visual.spec.ts-snapshots/`: Timer list, Timer calendar, Reports summary for 13-19 July 2026, Projects, Settings and Admin, each in light and dark on desktop and on the `PHONE` device. Every page is shot as the setup admin except Settings, which runs as a regular account made through the `users` fixture (`regularUser` in the capture table). Desktop shots taken as the admin therefore include the Admin nav entry. Each test restores `e2e/fixtures-data/transfer/restore-full.json` through the page's session, which leaves no running entry. It freezes the browser clock with `page.clock.setFixedTime`, awaits `document.fonts.ready` and network idle, turns animations off and takes a full-page shot with `maxDiffPixelRatio: 0.002`. The Admin page's created and expiry dates follow the server's real clock, which the fixed browser clock does not touch, so that capture masks `.admin-date`. The API token card prints the server origin, so the spec rewrites it to a fixed `http://127.0.0.1:8095` and the baselines do not depend on `E2E_PORT`.

A baseline's file name comes from the explicit argument to `toHaveScreenshot` (`${capture.name}-${device}-${colorScheme}.png`, expanded through `snapshotPathTemplate` in `playwright.config.ts`), not from the test title. Renaming a test title therefore neither moves nor regenerates a baseline; to rename one, change the argument and `git mv` the PNG.

The baselines are rendered by the default Playwright headless shell (revision 1248 for Playwright 1.64.1). Do not set `CHROMIUM_PATH` to the older 1223 build when running them; its output differs. Refresh after an intended change with `npx playwright test visual --update-snapshots=all`. A plain `--update-snapshots` means `changed`, and it can leave a baseline that differs by less than the threshold untouched, so the committed set drifts. `=all` rewrites every baseline it runs, the passing ones too, so after a refresh compare the diff against the change and restore (`git restore`) any baseline the change does not explain.

Because the threshold is a ratio of the whole page, a small element can break without failing a baseline. An extra small image in the brand is one: `e2e/typography.spec.ts` checks with `expectWordmarkAlone` that every `.brand` holds exactly one img, named Tokkl, and decodes the wordmark. The same spec checks the wordmark's drawn proportions at each size at 1x and 2x and its dark halo, since a slightly squashed wordmark or a missing 1px halo can change fewer pixels than the threshold allows. Give any small asset its own check, and decode it, since the static server answers a missing path with the HTML shell and status 200.

<!-- Verified against the current code on 2026-10-19. -->

<!-- kk:related:start -->
# Related

- Related: [practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory](e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md)
- Related: [map-app-icons-script](../repo-and-scripts/map-app-icons-script.md)
- Related: [map-readme-screenshots-script](../repo-and-scripts/map-readme-screenshots-script.md)
<!-- kk:related:end -->
