---
type: practice
title: Keep Sift ticket IDs and Strikethroo plans out of code and public docs
description: >-
  TT-NNNN IDs and plan references stay in .ai/sift and .ai/strikethroo; code,
  comments, tests, docs and commit subjects state the fact. CI enforces it.
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

CI enforces this: `npm run check:tracker-refs` (`scripts/check-tracker-refs.ts`) scans every file in `git ls-files` for `/\bTT-\d+\b/` or the strikethroo plans directory path, prints each hit as `file:line` and exits 1. CI runs it after `typecheck` and before `npm test`. The one `EXCLUDED` list at the top of the script skips `.ai/`, `.agents/`, `.claude/`, `.cursor/`, `.codex/`, `skills-lock.json` and `.kkignore`; add a path there only for agent tooling, never for published content. It skips binary files, symlinks and tracked files deleted from the working tree, and reads the working-tree content, not the staged blob. The script avoids matching itself by writing `\d` in the regex and joining the path from parts, so do not spell either out literally in it. Its tests (`scripts/check-tracker-refs.test.ts`) copy the script into throwaway git repos, so the real checkout is never scanned or modified.

<!-- kk:related:start -->
# Related

- Related: [practice-commit-messages-pass-commitlint-no-ai-generated](practice-commit-messages-pass-commitlint-no-ai-generated.md)
<!-- kk:related:end -->
