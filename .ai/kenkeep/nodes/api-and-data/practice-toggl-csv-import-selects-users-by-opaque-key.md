---
type: practice
title: 'Toggl CSV import: choose team-export users by opaque key'
description: >-
  Team CSVs list users by JSON key; send one user=<key> query param per user; a
  real multi-user import without one is a 400.
tags:
  - server
  - api
  - import
  - validation
kk_schema_version: 3
kk_id: practice-toggl-csv-import-selects-users-by-opaque-key
kk_derived_from: []
kk_relates_to:
  - practice-json-restore-rules
kk_depends_on: []
kk_confidence: high
---
`importTogglCsv` in `packages/api/src/services/importCsv.ts` maps the Toggl `User` and `Email` columns. When either column is present, every row belongs to an `ImportUser` (`packages/types/index.ts`): `key`, `user`, `email` and `rows`. `ImportResult` returns those in `users`, and the rows it did not import in `skipped` as `{ rows, reason }`.

`key` is `JSON.stringify([name, email])`, so User "Alice" with Email "a@x" and User "Alice <a@x>" with no Email stay two users. Treat it as opaque. Pass it back unchanged, and show people `user` and `email` instead.

`POST /api/app/import/toggl-csv` takes the selection as repeated `user=<key>` query parameters, one per user (`DataSection.tsx` uses `params.append('user', key)`). Never join keys with commas, since keys can contain them. A key that matches no row, or an empty selection, is a 400. A dry run (`dry_run=true`) without a selection succeeds and lists the users; a real import of a file with more than one user and no selection is a 400.

`e2e/fixtures-data/transfer/toggl-team.csv` is the multi-user fixture.

<!-- kk:related:start -->
# Related

- Related: [practice-json-restore-rules](practice-json-restore-rules.md)
<!-- kk:related:end -->
