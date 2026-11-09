---
type: practice
title: 'Signed-in operations bind the authenticated user at construction'
description: >-
  entriesFor, timersFor, catalogsFor, importsFor, preferencesFor and accountsFor
  take the Authentication once; routes never pass the user's id or the admin
  actor again.
tags:
  - server
  - auth
  - architecture
kk_schema_version: 3
kk_id: practice-signed-in-operations-bind-the-authenticated-user
kk_derived_from:
  - packages/api/src/services/application.ts
  - packages/api/src/routes/README.md
kk_relates_to:
  - practice-password-checks-go-through-failurelimiter-attempt
kk_depends_on: []
kk_confidence: high
---
The `…For(authentication)` factories in `packages/api/src/services/application.ts` build one request's operations over transactions that recheck that credential. The same call binds who acts: `createEntryOperations`, `createTimerOperations` and `createCatalogOperations` take the signed-in user, `createImportOperations(runner, userId, publish)` and `createPreferenceOperations(runner, userId)` take the user's id, and `accountsFor` wraps the domain account operations so that each passes `authentication.user.id` as the admin actor and `authentication.user`/`credential` to `updateProfile` and `rotateApiToken`. A route calls `deps.importsFor(res.locals.auth).importJsonExport(data, options)` or `deps.accountsFor(res.locals.auth).setAccess(id, change)` and never repeats `res.locals.auth.user.id`. Nothing checks that a separately passed id matches the credential, so adding such a parameter back would let the two disagree.

`accountsFor` exposes only the operations a signed-in user reaches (admin user management, invites, password reset links, settings, workspace edits, profile and API token). Setup, sign-in, invite acceptance and password resets run before a credential exists and use `createSessionAccountOperations`, which keeps the domain's explicit actor parameters.

Tests that drive one runner for several users use `importsById` in `packages/api/test/fixtures/imports.ts`, or `timersById`/`bodyTimers` in `test/fixtures/entryBodies.ts`, which build the bound operations per call.
