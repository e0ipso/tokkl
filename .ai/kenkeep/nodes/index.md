---
okf_version: '0.1'
---
# kenkeep Index

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) to learn about: Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)). #server #validation #time #api
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) to learn about: npm run test:e2e builds the UI first; each run gets its own data dir; an auto fixture wipes data around every test, so specs seed their own. #testing #e2e #playwright #workflow
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) to learn about: Calendar positions and day/clock shifts use shared/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work. #web #time #dst #calendar #shared
- Open [**Validate write-path references with getProjectRef and getTaskRef**](practice-write-paths-validate-refs-not-totals.md) to learn about: Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals. #server #models #performance #validation
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) to learn about: parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now. #web #shared #time #parsing
- Open [**Deleting a client detaches its projects and never merges them**](practice-client-deletion-keeps-projects.md) to learn about: deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N". #server #clients #projects
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) to learn about: importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import. #server #import #restore #backup
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) to learn about: Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Timetrack-CSRF: 1. #server #auth #security #rate-limit #csrf
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) to learn about: PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults. #server #preferences #validation
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) to learn about: Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them. #server #database #migrations #performance
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) to learn about: Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow. #server #validation #reports #money

## Components (what exists)
- Open [**Web app report endpoints under /api/app/report**](map-app-report-endpoints.md) to learn about: The web app's reports are aggregated server-side by /api/app/report/*; Toggl v3 report routes keep a 366-day cap. #server #reports #api #web
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) to learn about: npm test runs only server/test and shared tests; web/src logic is tested via shared helpers or e2e; no lint script; typecheck skips e2e. #testing #typecheck #tooling #workflow

## By topic

### #server
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults.
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) — Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow.
### #validation
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults.
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Validate write-path references with getProjectRef and getTaskRef**](practice-write-paths-validate-refs-not-totals.md) — Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals.
### #time
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use shared/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
### #web
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use shared/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**Web app report endpoints under /api/app/report**](map-app-report-endpoints.md) — The web app's reports are aggregated server-side by /api/app/report/*; Toggl v3 report routes keep a 366-day cap.
### #api
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Web app report endpoints under /api/app/report**](map-app-report-endpoints.md) — The web app's reports are aggregated server-side by /api/app/report/*; Toggl v3 report routes keep a 366-day cap.
### #performance
- Open [**Validate write-path references with getProjectRef and getTaskRef**](practice-write-paths-validate-refs-not-totals.md) — Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals.
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
### #reports
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) — Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow.
- Open [**Web app report endpoints under /api/app/report**](map-app-report-endpoints.md) — The web app's reports are aggregated server-side by /api/app/report/*; Toggl v3 report routes keep a 366-day cap.
### #shared
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use shared/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
### #testing
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — npm run test:e2e builds the UI first; each run gets its own data dir; an auto fixture wipes data around every test, so specs seed their own.
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs only server/test and shared tests; web/src logic is tested via shared helpers or e2e; no lint script; typecheck skips e2e.
### #workflow
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — npm run test:e2e builds the UI first; each run gets its own data dir; an auto fixture wipes data around every test, so specs seed their own.
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs only server/test and shared tests; web/src logic is tested via shared helpers or e2e; no lint script; typecheck skips e2e.
### #auth
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) — Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Timetrack-CSRF: 1.
### #backup
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
### #calendar
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use shared/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
### #clients
- Open [**Deleting a client detaches its projects and never merges them**](practice-client-deletion-keeps-projects.md) — deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N".
### #csrf
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) — Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Timetrack-CSRF: 1.
### #database
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
### #dst
- Open [**UI time math uses account-local wall-clock helpers**](practice-ui-time-math-uses-wall-clock-helpers.md) — Calendar positions and day/clock shifts use shared/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work.
### #e2e
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — npm run test:e2e builds the UI first; each run gets its own data dir; an auto fixture wipes data around every test, so specs seed their own.
### #import
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
### #migrations
- Open [**Project and task totals rely on the live-entry partial indexes**](practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
### #models
- Open [**Validate write-path references with getProjectRef and getTaskRef**](practice-write-paths-validate-refs-not-totals.md) — Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals.
### #money
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](practice-hourly-rates-go-through-optionalrate.md) — Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow.
### #parsing
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](practice-twelve-hour-time-entry-parsing-rules.md) — parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now.
### #playwright
- Open [**Running the Playwright e2e suite**](practice-e2e-test-workflow.md) — npm run test:e2e builds the UI first; each run gets its own data dir; an auto fixture wipes data around every test, so specs seed their own.
### #preferences
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](practice-preferences-validated-by-known-key.md) — PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults.
### #projects
- Open [**Deleting a client detaches its projects and never merges them**](practice-client-deletion-keeps-projects.md) — deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N".
### #rate-limit
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) — Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Timetrack-CSRF: 1.
### #restore
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
### #security
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](practice-password-checks-and-csrf-rules.md) — Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Timetrack-CSRF: 1.
### #tooling
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs only server/test and shared tests; web/src logic is tested via shared helpers or e2e; no lint script; typecheck skips e2e.
### #typecheck
- Open [**What npm test and npm run typecheck cover**](map-test-and-static-analysis-layout.md) — npm test runs only server/test and shared tests; web/src logic is tested via shared helpers or e2e; no lint script; typecheck skips e2e.
