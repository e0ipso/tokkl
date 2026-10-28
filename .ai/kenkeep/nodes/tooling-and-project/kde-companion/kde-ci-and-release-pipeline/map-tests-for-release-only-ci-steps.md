---
type: map
title: Tests for release-only CI steps
description: >-
  release-publish.test.ts runs ci.yml's publish and version-check steps with a
  stub gh; other release-only KDE code has node:test files.
tags:
  - tooling
  - ci
  - release
  - testing
kk_schema_version: 3
kk_id: map-tests-for-release-only-ci-steps
kk_derived_from: []
kk_relates_to:
  - map-test-and-static-analysis-layout
  - map-kde-release-upgrade-check-from-the-published-predecessor
  - map-release-stages-kde-semantic-release-plugin-and-gnome-assets
kk_depends_on: []
kk_confidence: high
---
`scripts/release-publish.test.ts` (run by `npm test`) pulls the `gnome-publish` and `macos-publish` upload steps and the `gnome-release` and `macos-release` "Check the version" steps out of `ci.yml`, runs them with bash and a stub `gh`, and checks the exact upload arguments, a missing or duplicate asset, a version mismatch and a failed upload. These steps run only after a real release, so nothing else exercises them. The step is found by job and step name, so renaming either breaks the test on purpose. The same file runs the `kde-release` "Record the package" step. actionlint lints `run:` blocks with shellcheck but does not read composite actions. The other release-only KDE code has node:test files under `scripts/` too: `kde-semantic-release.test.ts` (the plugin's `prepare` and `verifyRelease`, and `next-release.js` against a throwaway repository with a local bare remote), `kde-previous-package.test.ts` (a stand-in `gh` on `PATH`) and `kde-image-id.test.ts` (a copy of the tracked `desktop/kde` files).

<!-- kk:related:start -->
# Related

- Related: [map-test-and-static-analysis-layout](../../testing/map-test-and-static-analysis-layout.md)
- Related: [map-kde-release-upgrade-check-from-the-published-predecessor](../map-kde-release-upgrade-check-from-the-published-predecessor.md)
- Related: [map-release-stages-kde-semantic-release-plugin-and-gnome-assets](map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md)
<!-- kk:related:end -->
