---
type: practice
title: Keep Sift ticket IDs and Strikethroo plans out of code and public docs
description: >-
  TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code,
  comments, tests, docs and commit subjects state the fact.
tags:
  - tooling
  - docs
  - comments
  - commits
  - sift
  - strikethroo
kk_schema_version: 3
kk_id: >-
  practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs
kk_derived_from: []
kk_relates_to:
  - practice-commit-messages-pass-commitlint-no-ai-generated
kk_depends_on: []
kk_confidence: high
---
Sift tickets and Strikethroo plans are internal. Tickets and plans may cite each other, but no ticket ID (`TT-NNNN`) or plan reference goes into source, code comments, test titles, the PRD, the README, `CHANGELOG.md` or commit subjects.

This repo is public and its readers cannot open the tracker, so a bare ID tells them nothing. Write the reason itself: "the bar must mirror edits that land in the same second as the previous write", not "see TT-0061".

A commit names its ticket in a `Refs: TT-NNNN` body trailer, never in the subject. semantic-release copies subjects into `CHANGELOG.md` and the GitHub release notes, so an ID in a subject gets published with every release. commitlint's `no-ticket-id-in-header` rule rejects such a header.

<!-- kk:related:start -->
# Related

- Related: [practice-commit-messages-pass-commitlint-no-ai-generated](practice-commit-messages-pass-commitlint-no-ai-generated.md)
<!-- kk:related:end -->
