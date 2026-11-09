---
type: practice
title: The workspace task search keeps JavaScript's case folding and name order
description: >-
  GET /workspaces/{wid}/tasks filters in SQL, pages creation-time sorts in SQL,
  and sorts names with localeCompare in memory; test/fixtures/taskSearchGolden.ts
  pins the answer.
tags:
  - server
  - tasks
  - toggl
kk_schema_version: 3
kk_id: practice-workspace-task-search-keeps-javascript-order
kk_derived_from: []
kk_relates_to:
  - map-catalog-revision-and-latest-entry-endpoints
kk_depends_on: []
kk_confidence: high
---
`searchTasks` in `packages/api/src/domain/queries.ts` answers `GET /api/v9/workspaces/{wid}/tasks`. Its answer is the in-memory search it replaced, pinned by golden pages in `test/fixtures/taskSearchGolden.ts`: the search keeps names whose `toLowerCase()` contains the lower-cased search, and the name order is `toLowerCase().localeCompare`, then id, both reversed for `DESC`.

SQL applies the project, `active` and `since` filters (`searchScope` in `storage/repositories/tasks.ts`). With no search and `sort_field=created_at`, SQL also orders (`created_at`, then id), counts and pages (`count`, `listByCreation`); stored instants have one fixed-width form, so byte order is time order. Every other case reads only the sort keys of the matching tasks (`listSortKeys`) and sorts them in memory, because no engine repeats ICU's `localeCompare`. A search narrows that read in SQL: an ASCII name is kept only when its `name_key` contains the search (ASCII folding is JavaScript's lower-casing for ASCII), and every name with another character (more bytes than characters) is kept for the exact JavaScript test, since `K` (Kelvin sign) and `İ` lower-case to ASCII. Only the page's tasks are read with their totals. `test/taskSearch.test.ts` and the four-backend case in `test/storage/catalogs.test.ts` check those goldens; change them on purpose if the order ever changes.
