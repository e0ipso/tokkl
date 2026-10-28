---
type: map
title: 'rewindDatabase: the migration-upgrade e2e scenarios in auth-browser.spec.ts'
description: >-
  rewindDatabase makes a current DB look pre-migration N; upgrade scenarios
  restart on it and assert the latest user_version.
tags:
  - testing
  - e2e
  - migrations
kk_schema_version: 3
kk_id: map-rewinddatabase-the-migration-upgrade-e2e-scenarios-in-auth-browser-spec-ts
kk_derived_from:
  - '7ae0d82c-071d-4a10-822a-6d9631cf5b15:map:1'
kk_relates_to:
  - practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts
  - practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory
kk_depends_on: []
kk_confidence: medium
---
`e2e/auth-browser.spec.ts` tests the server's startup migration path on older data. `rewindDatabase(db, version)` takes a database the current server created and makes it look like one from before migration `version`: it drops every table and column that later migrations create (currently `pomodoro_sessions`, `pause_chains`, `timer_states` and `time_entries.all_day`) and sets `PRAGMA user_version`. The scenarios then restart a disposable server on that data directory, so the real migrations run again, and one asserts the final `user_version` against a hard-coded latest schema version.

When changing this, verify: a new migration that adds a table or column must also be dropped in `rewindDatabase`, and the asserted `user_version` must be bumped. Otherwise the restarted server fails with `duplicate column name` (or an existing table) and never starts, and these e2e scenarios fail in CI.

<!-- kk:related:start -->
# Related

- Related: [practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts](practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md)
- Related: [practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory](practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 7ae0d82c-071d-4a10-822a-6d9631cf5b15:map:1
<!-- kk:citations:end -->
