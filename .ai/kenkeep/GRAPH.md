---
schema_version: 3
nodes_hash: 'sha256:d08235feffd4c2bfc0f2607e870fb610c3edc313ba62be0d70a76a02d3bbb3e3'
node_count: 26
---
# kenkeep Graph

Total nodes: 26

## map-app-icons-script

- **kind:** map
- **title:** App icons: npm run icons renders the PNGs from icon.svg
- **path:** map-app-icons-script.md
- **tags:** tooling, pwa, icons, playwright, web
- **relates_to:** map-readme-screenshots-script, practice-e2e-test-workflow

## map-app-report-endpoints

- **kind:** map
- **title:** Web app report endpoints under /api/app/report
- **path:** map-app-report-endpoints.md
- **tags:** server, reports, api, web

## map-history-scale-bench

- **kind:** map
- **title:** History-scale bench: npm run bench:history
- **path:** map-history-scale-bench.md
- **tags:** performance, bench, tooling, reports
- **relates_to:** map-app-report-endpoints, practice-live-entry-indexes-back-project-and-task-totals

## map-npm-workspaces-package-layout

- **kind:** map
- **title:** npm workspaces: packages/common, packages/api, packages/web
- **path:** map-npm-workspaces-package-layout.md
- **tags:** monorepo, workspaces, layout, tooling, common, api, web
- **relates_to:** map-test-and-static-analysis-layout

## map-readme-screenshots-script

- **kind:** map
- **title:** README screenshots: npm run screenshots
- **path:** map-readme-screenshots-script.md
- **tags:** tooling, docs, screenshots, playwright
- **relates_to:** practice-e2e-test-workflow, map-test-and-static-analysis-layout

## map-shared-list-controls-in-manage-ui

- **kind:** map
- **title:** Shared list controls live in packages/web/src/pages/manage/ui.tsx
- **path:** map-shared-list-controls-in-manage-ui.md
- **tags:** web, components, css, reuse
- **relates_to:** practice-phone-layout-css-gotchas

## map-test-and-static-analysis-layout

- **kind:** map
- **title:** What npm test and npm run typecheck cover
- **path:** map-test-and-static-analysis-layout.md
- **tags:** testing, typecheck, tooling, workflow
- **relates_to:** practice-e2e-test-workflow, map-npm-workspaces-package-layout

## map-web-page-state-and-field-error-components

- **kind:** map
- **title:** Loading, error, empty and field-error states use the shared components
- **path:** map-web-page-state-and-field-error-components.md
- **tags:** web, a11y, react, components, forms, e2e
- **relates_to:** map-shared-list-controls-in-manage-ui, practice-e2e-test-workflow

## practice-client-deletion-keeps-projects

- **kind:** practice
- **title:** Deleting a client detaches its projects and never merges them
- **path:** practice-client-deletion-keeps-projects.md
- **tags:** server, clients, projects

## practice-clipboard-copy-needs-http-fallback

- **kind:** practice
- **title:** Clipboard copy needs a fallback on plain HTTP
- **path:** practice-clipboard-copy-needs-http-fallback.md
- **tags:** web, clipboard, self-hosting

## practice-contrast-tables-and-project-colours

- **kind:** practice
- **title:** Contrast tables in styles.css; project colours never paint text
- **path:** practice-contrast-tables-and-project-colours.md
- **tags:** web, css, accessibility, contrast, projects
- **relates_to:** practice-theme-tokens-data-theme-and-cached-theme

## practice-display-font-and-reduced-motion

- **kind:** practice
- **title:** Display font is the bundled Anybody; one reduced-motion block ends styles.css
- **path:** practice-display-font-and-reduced-motion.md
- **tags:** web, css, fonts, motion, accessibility
- **relates_to:** practice-contrast-tables-and-project-colours

## practice-e2e-test-workflow

- **kind:** practice
- **title:** Running the Playwright e2e suite
- **path:** practice-e2e-test-workflow.md
- **tags:** testing, e2e, playwright, workflow

## practice-hourly-rates-go-through-optionalrate

- **kind:** practice
- **title:** Validate hourly rates with optionalRate and MAX_HOURLY_RATE
- **path:** practice-hourly-rates-go-through-optionalrate.md
- **tags:** server, validation, reports, money

## practice-json-restore-rules

- **kind:** practice
- **title:** JSON restore: idempotent, skips with reasons, keeps archive state
- **path:** practice-json-restore-rules.md
- **tags:** server, import, restore, backup
- **relates_to:** practice-write-paths-validate-refs-not-totals, practice-parse-api-timestamps-with-parseinstant

## practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows

- **kind:** practice
- **title:** Arrow keys: arrowTarget for roving tabindex; global shortcuts yield
- **path:** practice-keyboard-arrow-keys-roving-tabindex-and-own-arrows.md
- **tags:** web, a11y, keyboard, react, reports
- **relates_to:** map-shared-list-controls-in-manage-ui

## practice-live-entry-indexes-back-project-and-task-totals

- **kind:** practice
- **title:** Project and task totals rely on the live-entry partial indexes
- **path:** practice-live-entry-indexes-back-project-and-task-totals.md
- **tags:** server, database, migrations, performance

## practice-parse-api-timestamps-with-parseinstant

- **kind:** practice
- **title:** Parse incoming timestamps with parseInstant
- **path:** practice-parse-api-timestamps-with-parseinstant.md
- **tags:** server, validation, time, api

## practice-password-checks-and-csrf-rules

- **kind:** practice
- **title:** Password checks go through FailureLimiter.attempt; writes need the CSRF header
- **path:** practice-password-checks-and-csrf-rules.md
- **tags:** server, auth, security, rate-limit, csrf

## practice-phone-layout-css-gotchas

- **kind:** practice
- **title:** Phone layout CSS: position scroll wrappers, min-width: 0 on grid/flex items
- **path:** practice-phone-layout-css-gotchas.md
- **tags:** web, css, mobile, layout
- **relates_to:** practice-e2e-test-workflow

## practice-preferences-validated-by-known-key

- **kind:** practice
- **title:** Preferences: known keys validated, unknown keys stored verbatim
- **path:** practice-preferences-validated-by-known-key.md
- **tags:** server, preferences, validation

## practice-theme-tokens-data-theme-and-cached-theme

- **kind:** practice
- **title:** Theme: light-dark() tokens, data-theme and the cached theme
- **path:** practice-theme-tokens-data-theme-and-cached-theme.md
- **tags:** web, css, theme, dark-mode, e2e
- **relates_to:** practice-contrast-tables-and-project-colours, practice-e2e-test-workflow

## practice-twelve-hour-time-entry-parsing-rules

- **kind:** practice
- **title:** 12-hour time entry: explicit AM/PM wins, ends follow the start
- **path:** practice-twelve-hour-time-entry-parsing-rules.md
- **tags:** web, time, parsing
- **relates_to:** practice-ui-time-math-uses-wall-clock-helpers

## practice-ui-time-math-uses-wall-clock-helpers

- **kind:** practice
- **title:** UI time math uses account-local wall-clock helpers
- **path:** practice-ui-time-math-uses-wall-clock-helpers.md
- **tags:** web, time, dst, calendar, common

## practice-web-ui-survives-background-refetches

- **kind:** practice
- **title:** Web UI state must survive background refetches
- **path:** practice-web-ui-survives-background-refetches.md
- **tags:** web, react-query, timer, entry-list

## practice-write-paths-validate-refs-not-totals

- **kind:** practice
- **title:** Validate write-path references with getProjectRef and getTaskRef
- **path:** practice-write-paths-validate-refs-not-totals.md
- **tags:** server, models, performance, validation
