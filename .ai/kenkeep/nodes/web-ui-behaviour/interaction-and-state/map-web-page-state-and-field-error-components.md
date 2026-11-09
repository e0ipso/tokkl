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
- Footnotes under a list are `<p className="hint manage-footnote">`. The Trash page shows one only when `GET /api/app/trash` left entries out: `GET /api/app/trash/total` answers `{ total, limit }` (`TrashTotal`, decoded by `trashTotalReply`; `useTrashTotal` in `api/entries.ts`, key `[...keys.trash, 'total']`, so `stale.trash` and every entry change refresh it), and `trashLimitNotice` (`pages/trashLimit.ts`) gives `manage.trashLimit` when `total > limit`. Do not go back to guessing from the list length.
- `FieldError.tsx`: `useFieldErrors<K>()` returns `validate`, `field`, `message`, `clear` and `id`. Spread `field(key)` on the input: it adds the ref, `id`, `aria-invalid` (the CSS turns that into a `--danger` border) and `aria-describedby` pointing at the `.field-error` message, which `message(key)` renders with `role=alert`. `validate` focuses the first invalid field, and typing in a field clears its error. Only errors that belong to no field, such as a failed request, go to a toast. A 400 that names a field goes to it: `ResetPasswordPage` sends the server's password errors through `fields.validate`. `useAction` (`components/useAction.ts`) shows a failure as a toast unless the caller passes `onError`, which the admin page uses for inline errors.

Replies get one top-level check (`object` or `list` in `api/decode.ts`): a read passes `decode` and is typed by the call (`api.get<Me>(…, { decode: object })`), and a reply of the wrong kind fails its request with the generic `api.unreadableReply`, so the view shows its usual load error. Fields are trusted: the server is the app's own same-origin API and both sides compile against `@tokkl/types`. `decode` is optional; a write whose reply nothing reads passes none. Only the timer state is checked field by field (`isTimerState` in `api/timerState.ts`). The status reply's capabilities are not filtered; nothing in the web app reads them.

Actions that must not overlap share `useExclusive` (`components/useExclusive.ts`): `run` ignores a call while one is running (a ref, so a second click in the same frame is refused) and `busy` disables the other controls with the plain `disabled` attribute, so `.button:disabled` styles them. The entry editor's Save, Duplicate, Split and Delete share one, and so do the bulk bar's actions. The manual Add and the project and tag pickers' Create use one only as a guard. Menu items (`.menu button`) and picker items have no disabled style; a row menu closes on select, so its items need no guard.

Error toasts in `Toast.tsx` are `role=alert` as well. In e2e specs, scope `getByRole('alert')` to a region or filter it by text whenever a toast and a field or load error can be on screen together.

<!-- kk:related:start -->
# Related

- Related: [map-shared-list-controls-in-manage-ui](../../web-ui-styling-and-layout/shell-and-layout/map-shared-list-controls-in-manage-ui.md)
- Related: [practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard](../../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md)
<!-- kk:related:end -->
