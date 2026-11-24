---
type: map
title: Reports page filter state in URL params
description: >-
  Report filters live in URL params as dot-separated ids with none and a not.
  prefix; a bare not. filters nothing.
tags:
  - web
  - reports
kk_schema_version: 3
kk_id: map-reports-page-filter-state-in-url-params
kk_derived_from:
  - 'd103ede7-f126-4851-968a-8b39f6b3f9b1:map:6'
kk_relates_to:
  - map-reports-page-query-body-caching-and-cancellation
kk_depends_on: []
kk_confidence: high
---
Report state lives in the URL (`packages/web/src/pages/reports/urlState.ts`). The `projects`, `clients` and `tags` params hold dot-separated ids (`none` for no project, client or tag), and a leading `not.` negates the filter, for example `projects=not.none.4`. Choosing "Is not" before picking any option is kept as a bare `<param>=not.`. It parses back as negated with no ids and filters nothing until an option is chosen. Choosing "Is" with no options removes the param.

<!-- kk:related:start -->
# Related

- Related: [map-reports-page-query-body-caching-and-cancellation](map-reports-page-query-body-caching-and-cancellation.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] d103ede7-f126-4851-968a-8b39f6b3f9b1:map:6
<!-- kk:citations:end -->
