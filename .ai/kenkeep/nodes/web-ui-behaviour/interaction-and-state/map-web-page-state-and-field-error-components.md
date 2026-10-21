---
type: map
title: 'Loading, error, empty and field-error states use the shared components'
description: >-
  PageState.tsx (Loading, LoadError, BusyRegion), EmptyState.tsx and
  FieldError.tsx with useFieldErrors; error toasts are role=alert too.
tags:
  - web
  - a11y
  - react
  - components
  - forms
  - e2e
kk_schema_version: 3
kk_id: map-web-page-state-and-field-error-components
kk_derived_from: []
kk_relates_to:
  - map-shared-list-controls-in-manage-ui
  - practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard
kk_depends_on: []
kk_confidence: high
---
Pages and panels render their non-data states through shared components in `packages/web/src/components/` instead of ad hoc markup:

- `PageState.tsx`: `Loading` is an `aria-busy` region with the label in a `role=status` span. `LoadError` is `role=alert`, says what failed, and shows a "Try again" button when the caller passes `onRetry` (usually the query's `refetch`). `BusyRegion` marks content that stays on screen while more of it loads, such as the entry list during "Show more days".
- `EmptyState.tsx`: inline-SVG wave, headline, body and actions; `compact` drops the wave for tight spots.
- `FieldError.tsx`: `useFieldErrors<K>()` returns `validate`, `field`, `message`, `clear` and `id`. Spread `field(key)` on the input: it adds the ref, `id`, `aria-invalid` (the CSS turns that into a `--danger` border) and `aria-describedby` pointing at the `.field-error` message, which `message(key)` renders with `role=alert`. `validate` focuses the first invalid field, and typing in a field clears its error. Only errors that belong to no field, such as a failed request, go to a toast. A 400 that names a field goes to it: `ResetPasswordPage` sends the server's password errors through `fields.validate`. `useAction` (`pages/manage/queries.ts`) shows a failure as a toast unless the caller passes `onError`, which the admin page uses for inline errors.

Error toasts in `Toast.tsx` are `role=alert` as well. In e2e specs, scope `getByRole('alert')` to a region or filter it by text whenever a toast and a field or load error can be on screen together.

<!-- kk:related:start -->
# Related

- Related: [map-shared-list-controls-in-manage-ui](../../web-ui-styling-and-layout/shell-and-layout/map-shared-list-controls-in-manage-ui.md)
- Related: [practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard](../../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md)
<!-- kk:related:end -->
