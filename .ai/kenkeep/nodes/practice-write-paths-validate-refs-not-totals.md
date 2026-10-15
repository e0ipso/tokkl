---
type: practice
title: Validate write-path references with getProjectRef and getTaskRef
description: >-
  Entry and task writes check project/task references with the ref getters;
  getProject/getTask compute tracked totals.
tags:
  - server
  - models
  - performance
  - validation
kk_schema_version: 3
kk_id: practice-write-paths-validate-refs-not-totals
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
When a write needs to check that a project or task exists, belongs to the workspace, links to the right project, is active or is billable, use `getProjectRef` (`packages/api/src/models/projects.ts`) and `getTaskRef` (`packages/api/src/models/tasks.ts`). They select only `id`, `workspace_id`, `active`, `billable` (and `project_id` for tasks).

`getProject` and `getTask` run the tracked-time aggregate over the whole entry history. Calling them on write paths made every create and update slower as history grew; on a 30k-entry fixture the median entry create dropped from 5.37 ms to 0.19 ms after switching. Keep the totals getters for responses that need the totals.

Current behaviour worth knowing: time entries may point at an archived project (entry writes do not check `active`), while `createTask` rejects archived projects. Whether entries on archived projects should be refused is an open product question, not a bug.
