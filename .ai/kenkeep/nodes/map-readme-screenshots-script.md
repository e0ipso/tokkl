---
type: map
title: 'README screenshots: npm run screenshots'
description: >-
  scripts/screenshots.ts rebuilds the nine docs/screenshots PNGs on a frozen
  clock; SQLite unixepoch('now') ignores it, so the timer stops.
tags:
  - tooling
  - docs
  - screenshots
  - playwright
kk_schema_version: 3
kk_id: map-readme-screenshots-script
kk_derived_from: []
kk_relates_to:
  - practice-e2e-test-workflow
  - map-test-and-static-analysis-layout
kk_depends_on: []
kk_confidence: high
---
`npm run screenshots` builds the web app and runs `scripts/screenshots.ts` under its own Playwright config, `scripts/screenshots.config.ts` (port `SCREENSHOTS_PORT`, default 8096, and a throwaway data directory). The config lives outside `e2e/`, so `npm run test:e2e` never runs it. It rewrites the nine images in `docs/screenshots/`. The README section "README screenshots" covers usage.

The data is `e2e/fixtures-data/transfer/restore-full.json` plus the extra records in `scripts/screenshots-data.ts`, which also exports `NOW` (`2026-07-16T13:20:00.000Z`, 15:20 in Europe/Madrid) and `TIME_ZONE`. The browser clock is fixed with `page.clock.setFixedTime(NOW)`, and the server starts with a `data:` URL `--import` that replaces `Date` with one that always reads `NOW`.

- That frozen `Date` does not reach SQLite. Project and task totals for a running entry use `unixepoch('now')` (`packages/api/src/models/projects.ts`), while `entryDurationSeconds` (`packages/api/src/models/timeEntries.ts`) uses JS time. The script therefore stops the running timer and takes the Projects capture last.
- The session cookie expires `TIMETRACK_SESSION_DAYS` after the frozen `NOW`. The config sets 36500, or the browser would drop the cookie as already expired once the real date passes `NOW` plus 30 days.

<!-- kk:related:start -->
# Related

- Related: [practice-e2e-test-workflow](practice-e2e-test-workflow.md)
- Related: [map-test-and-static-analysis-layout](map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
