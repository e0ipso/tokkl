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
- `FieldError.tsx`: `useFieldErrors<K>()` returns `validate`, `field`, `message`, `clear` and `id`. Spread `field(key)` on the input: it adds the ref, `id`, `aria-invalid` (the CSS turns that into a `--danger` border) and `aria-describedby` pointing at the `.field-error` message, which `message(key)` renders with `role=alert`. `validate` focuses the first invalid field, and typing in a field clears its error. Only errors that belong to no field, such as a failed request, go to a toast. A 400 that names a field goes to it: `ResetPasswordPage` sends the server's password errors through `fields.validate`. `useAction` (`components/useAction.ts`) shows a failure as a toast unless the caller passes `onError`, which the admin page uses for inline errors.

Replies are checked before views compute with them (`api/replies.ts`, built from `api/decode.ts`). The decoders use `@tokkl/common/validators`: `number` must be finite, `integer` (ids, revisions, counts, page numbers) a safe integer, and `instant` (entry, timer and report timestamps) an RFC 3339 date and time with a zone; calendar days (`YYYY-MM-DD`) stay `string`. A reply that does not fit fails its request with `api.unreadableReply`, which names the field, so the view shows its usual load error. Every request takes `decode` as a required option (`RequestOptions` in `api/client.ts`), reads and writes alike, `postCreate` included, so a request without a decoder does not compile, and every request returns `Checked<T>`. A write whose reply something reads (a toast, a navigation, a picker, a result panel or the cache) decodes it with a decoder from `api/replies.ts`, such as `timeEntryReply` for an entry create, `importResultReply` and `jsonRestoreResultReply` for imports, `bulkPatchResultReply`, `trashEmptiedReply`, `adminAccountReply`, `createdInviteReply` and `passwordResetLinkReply`. A write whose reply nothing reads passes `ignoreReply` (`api/decode.ts`) and returns nothing, so no caller can start reading an unchecked reply: deletes, archive and restore, login, setup and logout, the account saves (`accountRequests`, whose `stale` refetch shows the change), entry edits, entry restore, task creates and splits. Ignoring a reply nothing reads also keeps a reply the app does not need from failing a write that landed. Code that writes a write reply into the cache asks for `Checked<T>`: `SendPreferences` in `api/account.ts` (`preferencesReply`) and `adminRequests.saveSettings` with `InstanceSettingsSection` (`instanceSettingsReply`). Preferences check every key the app reads, favorites included; keys other clients saved pass through. The status reply (`appStatusReply`) keeps only the capability names the app knows (`knownNames` over `KNOWN_CAPABILITIES`, a `Record<ServerCapability, true>`, so a name added to the type must be added there too) and drops the rest, so a newer server that announces more still reads; a capabilities value that is not a list of strings still fails.

Actions that must not overlap share `useExclusive` (`components/useExclusive.ts`): `run` ignores a call while one is running (a ref, so a second click in the same frame is refused) and `busy` disables the other controls with the plain `disabled` attribute, so `.button:disabled` styles them. The entry editor's Save, Duplicate, Split and Delete share one, and so do the bulk bar's actions. The manual Add and the project and tag pickers' Create use one only as a guard. Menu items (`.menu button`) and picker items have no disabled style; a row menu closes on select, so its items need no guard.

Error toasts in `Toast.tsx` are `role=alert` as well. In e2e specs, scope `getByRole('alert')` to a region or filter it by text whenever a toast and a field or load error can be on screen together.

<!-- kk:related:start -->
# Related

- Related: [map-shared-list-controls-in-manage-ui](../../web-ui-styling-and-layout/shell-and-layout/map-shared-list-controls-in-manage-ui.md)
- Related: [practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard](../../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md)
<!-- kk:related:end -->
