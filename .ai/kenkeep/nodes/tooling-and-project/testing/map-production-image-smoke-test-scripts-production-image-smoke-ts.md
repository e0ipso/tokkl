---
type: map
title: 'Production image smoke test: scripts/production-image-smoke.ts'
description: >-
  npm run test:container smoke-tests a built production image per backend and
  asserts the exact count of applied storage migrations.
tags:
  - container
  - testing
  - migrations
  - ci
kk_schema_version: 3
kk_id: map-production-image-smoke-test-scripts-production-image-smoke-ts
kk_derived_from:
  - '9ac1e335-c9fa-41b0-baa6-7595ca4c245b:map:1'
kk_relates_to:
  - map-container-image-ghcr-io-e0ipso-tokkl
  - map-test-and-static-analysis-layout
  - practice-live-entry-indexes-back-project-and-task-totals
kk_depends_on: []
kk_confidence: medium
---
`scripts/production-image-smoke.ts` runs as `npm run test:container -- --image IMAGE [--backend sqlite|postgres|mysql|mariadb] [--hardened]`. It starts a built production image against one storage backend, optionally with the hardened container flags from the hosting guide, and checks the running server. Part of the check seeds history rows through `initializeDatabase` and reads the `storage_migrations` ledger.

The script asserts the exact number of applied migrations (`assert.equal(seeded.migrations.length, N)`). When changing this, verify: adding a migration in `packages/api/src/storage/migrations.ts` requires bumping that count, or the container job fails in CI.

<!-- kk:related:start -->
# Related

- Related: [map-container-image-ghcr-io-e0ipso-tokkl](../map-container-image-ghcr-io-e0ipso-tokkl.md)
- Related: [map-test-and-static-analysis-layout](map-test-and-static-analysis-layout.md)
- Related: [practice-live-entry-indexes-back-project-and-task-totals](../../api-and-data/reports-and-totals/practice-live-entry-indexes-back-project-and-task-totals.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 9ac1e335-c9fa-41b0-baa6-7595ca4c245b:map:1
<!-- kk:citations:end -->
