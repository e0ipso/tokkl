---
type: practice
title: Toggl v9 DELETE routes answer an empty 200
description: >-
  Time entry, project, task, client and tag DELETEs send status 200 with no
  body; the web client maps that to null.
tags:
  - api
  - toggl-v9
kk_schema_version: 3
kk_id: practice-v9-deletes-answer-an-empty-200
kk_derived_from:
  - packages/api/src/routes/togglV9.ts
kk_relates_to:
  - practice-client-deletion-keeps-projects
kk_depends_on: []
kk_confidence: high
---
All five v9 DELETE routes in `packages/api/src/routes/togglV9.ts` (time entry, project, task, client, tag) end with `res.status(200).end()`. They send no body and no 204. `packages/web/src/api/client.ts` turns an empty response body into `null` instead of calling `JSON.parse`, so web callers of a delete get `null`. A new DELETE route should do the same.

<!-- kk:related:start -->
# Related

- Related: [practice-client-deletion-keeps-projects](../reports-and-totals/practice-client-deletion-keeps-projects.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [packages/api/src/routes/togglV9.ts](../../../../../packages/api/src/routes/togglV9.ts)
<!-- kk:citations:end -->
