---
schema_version: 3
nodes_hash: 'sha256:a759ee300c49c6ef8c8227a33a662aa759fbb1d337aec0ffb6ae215e4ac77635'
node_count: 13
---
# kenkeep Graph

Total nodes: 13

## map-app-report-endpoints

- **kind:** map
- **title:** Web app report endpoints under /api/app/report
- **path:** map-app-report-endpoints.md
- **tags:** server, reports, api, web

## map-test-and-static-analysis-layout

- **kind:** map
- **title:** What npm test and npm run typecheck cover
- **path:** map-test-and-static-analysis-layout.md
- **tags:** testing, typecheck, tooling, workflow
- **relates_to:** practice-e2e-test-workflow

## practice-client-deletion-keeps-projects

- **kind:** practice
- **title:** Deleting a client detaches its projects and never merges them
- **path:** practice-client-deletion-keeps-projects.md
- **tags:** server, clients, projects

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

## practice-preferences-validated-by-known-key

- **kind:** practice
- **title:** Preferences: known keys validated, unknown keys stored verbatim
- **path:** practice-preferences-validated-by-known-key.md
- **tags:** server, preferences, validation

## practice-twelve-hour-time-entry-parsing-rules

- **kind:** practice
- **title:** 12-hour time entry: explicit AM/PM wins, ends follow the start
- **path:** practice-twelve-hour-time-entry-parsing-rules.md
- **tags:** web, shared, time, parsing
- **relates_to:** practice-ui-time-math-uses-wall-clock-helpers

## practice-ui-time-math-uses-wall-clock-helpers

- **kind:** practice
- **title:** UI time math uses account-local wall-clock helpers
- **path:** practice-ui-time-math-uses-wall-clock-helpers.md
- **tags:** web, time, dst, calendar, shared

## practice-write-paths-validate-refs-not-totals

- **kind:** practice
- **title:** Validate write-path references with getProjectRef and getTaskRef
- **path:** practice-write-paths-validate-refs-not-totals.md
- **tags:** server, models, performance, validation
