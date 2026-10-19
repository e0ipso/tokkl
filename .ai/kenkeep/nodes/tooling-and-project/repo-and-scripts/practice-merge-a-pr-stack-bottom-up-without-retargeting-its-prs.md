---
type: practice
title: Merge a PR stack bottom-up without retargeting its PRs
description: >-
  Merge stacked PRs bottom-up, starting with the one based on main. Don't
  repoint upper PR bases or close and reopen PRs.
tags:
  - git
  - github
  - pull-requests
  - workflow
kk_schema_version: 3
kk_id: practice-merge-a-pr-stack-bottom-up-without-retargeting-its-prs
kk_derived_from:
  - 'c5794749-15f1-47f9-9e40-e8840a0a83e2:practice:0'
kk_relates_to:
  - practice-commit-messages-pass-commitlint-no-ai-generated
kk_depends_on: []
kk_confidence: medium
---
When asked to merge a stack of pull requests, merge it bottom-up: first the PR whose base is `main`, then the next one up, and so on. PRs merge with merge commits, and each PR's head already contains every PR below it, so after a merge the next PR's diff shrinks to its own changes. No base changes are needed.

Do not repoint the upper PRs' bases at `main`, and do not close and reopen PRs to trigger CI. Those are GitHub state changes nobody asked for.

<!-- kk:related:start -->
# Related

- Related: [practice-commit-messages-pass-commitlint-no-ai-generated](practice-commit-messages-pass-commitlint-no-ai-generated.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] c5794749-15f1-47f9-9e40-e8840a0a83e2:practice:0
<!-- kk:citations:end -->
