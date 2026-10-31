---
type: map
title: 'History-scale bench: npm run bench:history'
description: >-
  bench/history.ts times reports, lists, writes and the timer on throwaway year
  (3k) and decade (30k) fixtures; wrong answers fail it.
tags:
  - performance
  - bench
  - tooling
  - reports
kk_schema_version: 3
kk_id: map-history-scale-bench
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:0'
kk_relates_to:
  - map-app-report-endpoints
  - practice-live-entry-indexes-back-project-and-task-totals
kk_depends_on: []
kk_confidence: high
---
`npm run bench:history` builds the UI and runs `bench/history.ts` (`-- --help` lists the options). For each fixture it starts the real server on disposable storage selected by `--backend sqlite|postgres|mysql|mariadb`, never an operator database, on port 8190 by default. It loads a generated history through the JSON import, then times imports, lists, reports, CSV exports, writes and timer requests, both alone and while a heavy report runs.

Fixtures: `year` (3,000 entries over 365 days) and `decade` (30,000 entries over 3,650 days, 30 projects with a task each). Every measured response is also checked for correctness (totals, paging, counts, payload growth), and a wrong answer exits 1. Timings are recorded, never asserted, together with the host, CPU and load average, because they describe this machine rather than the low-power targets in `docs/PRD.md`. `--out <file>` writes the full results as JSON; `CHROMIUM_PATH` applies to the browser timings as in the e2e suite.

`bench/tsconfig.json` covers `bench/**/*.ts`, and `npm run typecheck` runs it.

The server-engine fixtures use the digest-pinned disposable backend helper. Operator URL variables are refused. Results retain raw timing samples, actual engine versions, query counts and native plans. Bounded small PostgreSQL catalog scans are reported honestly as unindexed; entry-history totals must use selected live-entry indexes. All application and fixture cleanup is awaited. Run measured workloads separately from other heavy suites.

<!-- kk:related:start -->
# Related

- Related: [map-app-report-endpoints](../../api-and-data/reports-and-totals/map-app-report-endpoints.md)
- Related: [practice-live-entry-indexes-back-project-and-task-totals](../../api-and-data/reports-and-totals/practice-live-entry-indexes-back-project-and-task-totals.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:0
<!-- kk:citations:end -->
