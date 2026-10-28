---
type: map
title: KDE real-server test
description: >-
  realservertest.cpp, driven by realserver.test.ts, runs the companion against
  fixture Tokkl servers behind proxies and checks the data.
tags:
  - tooling
  - kde
  - ci
  - testing
kk_schema_version: 3
kk_id: map-kde-real-server-test
kk_derived_from: []
kk_relates_to:
  - map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes
  - map-kde-and-core-ci-jobs
kk_depends_on: []
kk_confidence: high
---
The real-server test is `desktop/kde/tests/realservertest.cpp` (QtTest, built by the CMake `tests` directory but not a CTest test) driven by `desktop/kde/tests/realserver.test.ts`. The script starts Tokkl servers with the API's test fixtures (`packages/api/test/helpers.ts`) behind proxies that can hold replies back, runs the binary in the `<image>:<format>-test` container, then checks that the server data changed only where the companion may change it, including that the stopped entry sits on the instance's 5-minute time resolution grid (`assertSnapped`). It needs Node.js 24 and `npm ci` on the host.

No API removes a workspace member, so the membership-loss scenario has the script delete the `workspace_users` row directly (`/remove-membership` in `realserver.test.ts`).

<!-- kk:related:start -->
# Related

- Related: [map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes](../plasma-companion/map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md)
- Related: [map-kde-and-core-ci-jobs](map-kde-and-core-ci-jobs.md)
<!-- kk:related:end -->
