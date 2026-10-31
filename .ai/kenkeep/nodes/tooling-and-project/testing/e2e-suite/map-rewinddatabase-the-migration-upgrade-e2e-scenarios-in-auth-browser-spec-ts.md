---
type: map
title: Browser storage restart and migration isolation
description: >-
  Browser restart tests preserve real accounts/preferences; explicit storage
  fixtures own migration and legacy refusal checks.
tags:
  - testing
  - e2e
  - migrations
kk_schema_version: 3
kk_id: map-rewinddatabase-the-migration-upgrade-e2e-scenarios-in-auth-browser-spec-ts
kk_derived_from:
  - '7ae0d82c-071d-4a10-822a-6d9631cf5b15:map:1'
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:4'
kk_relates_to:
  - practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts
  - practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory
kk_depends_on: []
kk_confidence: medium
---
`e2e/auth-browser.spec.ts` verifies canonical timezone, account preferences and setup state across a real server restart. It uses `servers.start({ slot, dataDir })` on the same owned storage identity. Ordinary browser scenarios run on every selected backend without driver methods on the fixture handle.

Migration upgrade, interruption, ledger checks and legacy refusal use explicit physical fixtures in `packages/api/test/storage`. Do not fabricate a current database by changing `PRAGMA user_version`: startup validates the recognized storage ledger and schema fingerprint. A legacy SQLite fixture belongs in an explicitly SQLite-specific case.

<!-- kk:related:start -->
# Related

- Related: [practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts](practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md)
- Related: [practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory](practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 7ae0d82c-071d-4a10-822a-6d9631cf5b15:map:1
[2] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:4
<!-- kk:citations:end -->
