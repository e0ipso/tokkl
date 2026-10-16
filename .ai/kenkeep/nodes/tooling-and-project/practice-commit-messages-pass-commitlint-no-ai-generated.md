---
type: practice
title: 'Commit messages: Conventional Commits, no co-author or AI trailers'
description: >-
  commitlint's no-ai-generated rule rejects any Co-authored-by and AI tool
  trailers; worktrees without npm ci skip the hook.
tags:
  - tooling
  - workflow
  - git
kk_schema_version: 3
kk_id: practice-commit-messages-pass-commitlint-no-ai-generated
kk_derived_from: []
kk_relates_to:
  - map-test-and-static-analysis-layout
kk_depends_on: []
kk_confidence: high
---
`commitlint.config.js` extends `@commitlint/config-conventional`, limits `type-enum` to its own list, and adds a custom `no-ai-generated` rule (enabled as an error). The rule rejects any `Co-authored-by:` trailer, human or not, plus `Assisted-by`/`Generated-by`/`Made-with`/`Signed-off-by` trailers that name an AI tool, tool-specific trailers such as `Copilot-Session:`, and "Generated with ... Claude Code" style lines. Write plain Conventional Commits with no attribution trailers.

`.husky/commit-msg` runs `npx --no -- commitlint --edit "$1"`. Husky installs through the root `prepare` script, which sets `core.hooksPath` to the relative `.husky/_` in the shared git config. A git worktree that has not run `npm ci` has no `.husky/_`, so git runs no hooks there. A commit with a forbidden trailer succeeds in the worktree and is rejected later, when it is replayed in a checkout that has the hooks. Check messages by hand when committing from such a worktree.

<!-- kk:related:start -->
# Related

- Related: [map-test-and-static-analysis-layout](map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
