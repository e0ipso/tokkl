---
type: practice
title: Validate hourly rates with optionalRate and MAX_HOURLY_RATE
description: >-
  Workspace and project rates share optionalRate, capped at MAX_HOURLY_RATE
  (1e9); a finite check alone lets reports overflow.
tags:
  - server
  - validation
  - reports
  - money
kk_schema_version: 3
kk_id: practice-hourly-rates-go-through-optionalrate
kk_derived_from:
  - packages/api/src/lib/values.ts
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:practice:3'
kk_relates_to:
  - map-app-report-endpoints
kk_depends_on: []
kk_confidence: high
---
Every hourly rate input goes through `optionalRate` in `packages/api/src/lib/values.ts`: a finite, non-negative number up to `MAX_HOURLY_RATE` (1,000,000,000), or null. The workspace `default_hourly_rate` (`parseWorkspaceChanges` in `packages/api/src/commands/accounts.ts`) and project `rate` (`packages/api/src/commands/catalogs.ts`) both use it. Use it for any new rate field.

Checking for a finite number is not enough. Reports multiply the rate by 100 and by tracked time, so a large but finite rate still overflows the billed amount. The cap keeps those numbers finite. JSON overflow such as `1e400` parses to `Infinity` and is rejected too.

<!-- kk:related:start -->
# Related

- Related: [map-app-report-endpoints → map-download-lane-for-account-exports-and-detailed-csvs](app-report-pipeline/map-download-lane-for-account-exports-and-detailed-csvs.md)
- Related: [map-app-report-endpoints → map-report-job-reads-in-sql-batches-and-golden-report-answers](app-report-pipeline/map-report-job-reads-in-sql-batches-and-golden-report-answers.md)
- Related: [map-app-report-endpoints → map-report-route-admission-to-the-reportrunner-report-lane](app-report-pipeline/map-report-route-admission-to-the-reportrunner-report-lane.md)
- Related: [map-app-report-endpoints → map-reportrunner-lanes-worker-placement-and-crash-handling](app-report-pipeline/map-reportrunner-lanes-worker-placement-and-crash-handling.md)
- Related: [map-app-report-endpoints → map-reports-page-filter-state-in-url-params](app-report-pipeline/map-reports-page-filter-state-in-url-params.md)
- Related: [map-app-report-endpoints → map-reports-page-query-body-caching-and-cancellation](app-report-pipeline/map-reports-page-query-body-caching-and-cancellation.md)
- Related: [map-app-report-endpoints → map-web-app-report-routes-range-limits-and-rounding](app-report-pipeline/map-web-app-report-routes-range-limits-and-rounding.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [packages/api/src/lib/values.ts](../../../../../packages/api/src/lib/values.ts)
[2] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:3
<!-- kk:citations:end -->
