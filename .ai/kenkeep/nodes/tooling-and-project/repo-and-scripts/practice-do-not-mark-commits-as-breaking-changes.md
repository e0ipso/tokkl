---
type: practice
title: Do not mark commits as breaking changes
description: >-
  Commits and PR titles carry no `!` or `BREAKING CHANGE:` footer, so
  semantic-release never cuts a major release, even for behavior changes.
tags:
  - release
  - git
  - semantic-release
  - workflow
kk_schema_version: 3
kk_id: practice-do-not-mark-commits-as-breaking-changes
kk_derived_from:
  - '3731445d-fa4c-416e-b2d2-8c35d32bc1e1:practice:0'
kk_relates_to:
  - practice-commit-messages-pass-commitlint-no-ai-generated
kk_depends_on: []
kk_confidence: medium
---
semantic-release (`.releaserc.json`, conventionalcommits preset) reads the commit messages, including the merge commit built from the PR title, to pick the next version. A `!` after the type or a `BREAKING CHANGE:` footer makes it cut a major release. The project avoids major releases, so commits and PR titles never carry either marker, even when a change alters behaviour that clients rely on. Ship such a change as a plain `fix` or `feat` and describe the behaviour change in the commit body and the PR description.

Before merging, check that no commit since the last release tag carries a breaking marker.

<!-- kk:related:start -->
# Related

- Related: [practice-commit-messages-pass-commitlint-no-ai-generated](practice-commit-messages-pass-commitlint-no-ai-generated.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 3731445d-fa4c-416e-b2d2-8c35d32bc1e1:practice:0
<!-- kk:citations:end -->
