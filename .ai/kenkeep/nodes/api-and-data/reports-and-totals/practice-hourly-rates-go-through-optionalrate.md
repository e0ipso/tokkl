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
Every hourly rate input goes through `optionalRate` in `packages/api/src/lib/values.ts`: a finite, non-negative number up to `MAX_HOURLY_RATE` (1,000,000,000), or null. The workspace `default_hourly_rate` (`packages/api/src/routes/togglV9.ts`) and project `rate` (`packages/api/src/domain/catalogs.ts`) both use it. Use it for any new rate field.

Checking for a finite number is not enough. Reports multiply the rate by 100 and by tracked time, so a large but finite rate still overflows the billed amount. The cap keeps those numbers finite. JSON overflow such as `1e400` parses to `Infinity` and is rejected too.

<!-- kk:related:start -->
# Related

- Related: [map-app-report-endpoints](map-app-report-endpoints.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [packages/api/src/lib/values.ts](../../../../../packages/api/src/lib/values.ts)
[2] d103ede7-f126-4851-968a-8b39f6b3f9b1:practice:3
<!-- kk:citations:end -->
