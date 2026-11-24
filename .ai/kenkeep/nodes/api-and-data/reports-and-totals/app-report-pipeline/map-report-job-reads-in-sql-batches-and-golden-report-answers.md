---
type: map
title: Report job reads in SQL batches and golden report answers
description: >-
  runReportJob reads in one snapshot, pages and sorts in SQL, aggregates in
  500-entry batches; goldens pin output on every backend.
tags:
  - server
  - reports
  - storage
kk_schema_version: 3
kk_id: map-report-job-reads-in-sql-batches-and-golden-report-answers
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:6'
kk_relates_to:
  - map-reportrunner-lanes-worker-placement-and-crash-handling
  - map-download-lane-for-account-exports-and-detailed-csvs
kk_depends_on: []
kk_confidence: high
---
`runReportJob` in `reportJobs.ts` reads and formats a job inside one read snapshot through `readReport` (`services/reports.ts`), so the snapshot stays open while it formats. No job loads the whole selection:

- Detailed pages (`v3-search`, `app-entries`) count in SQL and read only their window. Date, user and last-update orders sort on `e.start`/`e.updated_at` in SQL; duration sorts on `reportRoundedSeconds` (`storage/repositories/report-sql.ts`), which computes the rounded seconds the report shows in all four dialects. Ties go to the id, in the same direction.
- Description order cannot be collated in SQL the way `localeCompare` does, so it reads every selected id and description, sorts them with `Intl.Collator`, and reads full rows only for the ids it needs.
- Aggregates (totals, series, groupings, weekly grids) and the detailed CSVs take entries in batches of `REPORT_BATCH_SIZE` (500): aggregates by start/id keyset, CSVs in report order by id lists. The aggregates in `reportAggregates.ts` keep sums and first-seen labels, never entries.

`test/storage/reports.test.ts` holds every job kind on every backend to the golden answers in `test/storage/support/report-expected.json`, and checks paging, totals and the streamed CSV against fixed answers over a history larger than a read batch with tied starts. A change to report output must change the goldens on purpose.

<!-- kk:related:start -->
# Related

- Related: [map-reportrunner-lanes-worker-placement-and-crash-handling](map-reportrunner-lanes-worker-placement-and-crash-handling.md)
- Related: [map-download-lane-for-account-exports-and-detailed-csvs](map-download-lane-for-account-exports-and-detailed-csvs.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:6
<!-- kk:citations:end -->
