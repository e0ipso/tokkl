---
schema_version: 3
nodes_hash: 'sha256:25cdc6ddd9164eb9f48ff0f20c8379f0099af2f64d049e968803e5208125aeb3'
node_count: 13
---
# kenkeep

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

## Branches
_None._

## Conventions (how we build)
- Open [**Parse incoming timestamps with parseInstant**](nodes/practice-parse-api-timestamps-with-parseinstant.md) to learn about: Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)). #server #validation #time #api
- Open [**Running the Playwright e2e suite**](nodes/practice-e2e-test-workflow.md) to learn about: npm run test:e2e builds the UI first; each run gets its own data dir; an auto fixture wipes data around every test, so specs seed their own. #testing #e2e #playwright #workflow
- Open [**UI time math uses account-local wall-clock helpers**](nodes/practice-ui-time-math-uses-wall-clock-helpers.md) to learn about: Calendar positions and day/clock shifts use shared/time.ts helpers, never +86400000 ms or minutes*60000, so DST days work. #web #time #dst #calendar #shared
- Open [**Validate write-path references with getProjectRef and getTaskRef**](nodes/practice-write-paths-validate-refs-not-totals.md) to learn about: Entry and task writes check project/task references with the ref getters; getProject/getTask compute tracked totals. #server #models #performance #validation
- Open [**12-hour time entry: explicit AM/PM wins, ends follow the start**](nodes/practice-twelve-hour-time-entry-parsing-rules.md) to learn about: parseTimeOfDay never overrides a typed AM/PM; unsuffixed ends take the first occurrence after the start; starts guess near now. #web #shared #time #parsing
- Open [**Deleting a client detaches its projects and never merges them**](nodes/practice-client-deletion-keeps-projects.md) to learn about: deleteClient runs in one transaction; projects lose the client and colliding names become "Name (Client)", then "Name (Client) N". #server #clients #projects
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](nodes/practice-json-restore-rules.md) to learn about: importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import. #server #import #restore #backup
- Open [**Password checks go through FailureLimiter.attempt; writes need the CSRF header**](nodes/practice-password-checks-and-csrf-rules.md) to learn about: Login, Basic auth and password change share the per-address limiter; new passwords cap at 1024 chars; cookie writes need X-Timetrack-CSRF: 1. #server #auth #security #rate-limit #csrf
- Open [**Preferences: known keys validated, unknown keys stored verbatim**](nodes/practice-preferences-validated-by-known-key.md) to learn about: PREFERENCE_RULES in users.ts validates the keys the web app reads; other keys pass through; bad stored values read back as defaults. #server #preferences #validation
- Open [**Project and task totals rely on the live-entry partial indexes**](nodes/practice-live-entry-indexes-back-project-and-task-totals.md) to learn about: Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them. #server #database #migrations #performance
- Open [**Validate hourly rates with optionalRate and MAX_HOURLY_RATE**](nodes/practice-hourly-rates-go-through-optionalrate.md) to learn about: Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE (1e9); a finite check alone lets reports overflow. #server #validation #reports #money

## Components (what exists)
- Open [**Web app report endpoints under /api/app/report**](nodes/map-app-report-endpoints.md) to learn about: The web app's reports are aggregated server-side by /api/app/report/*; Toggl v3 report routes keep a 366-day cap. #server #reports #api #web
- Open [**What npm test and npm run typecheck cover**](nodes/map-test-and-static-analysis-layout.md) to learn about: npm test runs only server/test and shared tests; web/src logic is tested via shared helpers or e2e; no lint script; typecheck skips e2e. #testing #typecheck #tooling #workflow
