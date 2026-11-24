---
type: map
title: 'Reports page query body, caching and cancellation'
description: >-
  reportQuery sends groupings only for the summary tab; useReport caches 60 s
  and forwards the abort signal to free report places.
tags:
  - web
  - reports
kk_schema_version: 3
kk_id: map-reports-page-query-body-caching-and-cancellation
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:6'
kk_relates_to:
  - map-web-app-report-routes-range-limits-and-rounding
  - map-report-route-admission-to-the-reportrunner-report-lane
kk_depends_on: []
kk_confidence: high
---
On the client, `reportQuery` in `packages/web/src/pages/reports/query.ts` builds the `POST /api/app/report` body for the active tab. Only the summary tab asks for its own grouping and sub-grouping. The detailed and weekly tabs need just the totals, so they send `grouping: 'projects'` and `sub_grouping: 'projects'`; the server reads a sub-grouping equal to the grouping as "none". `useReport` in `packages/web/src/api/reports.ts` sets a 60 s `staleTime`, so switching back to the summary tab reuses the cached result. Entry edits still invalidate `keys.report`. The report, detailed-entries and weekly queries forward TanStack Query's `signal`, so a report the filters replaced is aborted and gives its place back to the newer one instead of pushing it into a 503.

<!-- kk:related:start -->
# Related

- Related: [map-web-app-report-routes-range-limits-and-rounding](map-web-app-report-routes-range-limits-and-rounding.md)
- Related: [map-report-route-admission-to-the-reportrunner-report-lane](map-report-route-admission-to-the-reportrunner-report-lane.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:6
<!-- kk:citations:end -->
