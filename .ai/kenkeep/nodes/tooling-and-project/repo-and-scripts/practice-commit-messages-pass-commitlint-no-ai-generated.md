---
type: practice
title: 'Commit messages: Conventional Commits, no co-author or AI trailers'
description: >-
  commitlint rejects Co-authored-by and AI trailers, ticket IDs in headers and
  subjects over 72 chars; worktrees without npm ci skip the hook.
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

A second custom rule, `no-ticket-id-in-header` (also an error), rejects a header that matches `/\bTT-\d+\b/`. semantic-release copies headers into `CHANGELOG.md` and the release notes, so a ticket ID belongs in a `Refs: TT-NNNN` trailer in the body; bodies and trailers are not checked.

The local rules also cap the subject (the text after `type(scope): `) at 72 characters with `subject-max-length`, an error. The whole header and every body and footer line are capped at 100. The preset also warns, without failing, when the body or the footer does not start after a blank line, so put an empty line before trailers such as `Refs:`. The parser also starts the footer at the first body line shaped like a trailer (a word, a colon and text, such as `cases: ...`): that line and every line after it count as footer, and the preset warns that the footer has no leading blank line. Reword such body lines so the colon does not follow the first word.

commitlint normally skips every rule for messages that match its default ignore list (merges, `Revert "..."`, `fixup!`/`squash!`, bare versions), and its merge pattern matches a "Merge branch" line anywhere in the message. The config therefore sets `defaultIgnores: false` and supplies one `ignores` function that applies the default list to the first line only, and only when the whole message also passes both custom rules. Reverts, fixups, squashes, amends and merges get no bypass from the two custom rules, and a non-Conventional subject with a "Merge branch" line in its body fails the format rules. `scripts/commitlint.test.ts` loads the config with `@commitlint/load` and lints with `@commitlint/lint`.

`.husky/commit-msg` runs `npx --no -- commitlint --edit "$1"`. Husky installs through the root `prepare` script, which sets `core.hooksPath` to the relative `.husky/_` in the shared git config. A git worktree that has not run `npm ci` has no `.husky/_`, so git runs no hooks there. A commit with a forbidden trailer succeeds in the worktree and is rejected later, when it is replayed in a checkout that has the hooks. Check messages by hand when committing from such a worktree.

`scripts/commitlint.test.ts` (run by `npm test`) commits in a `mkdtemp` repository with the real `.husky/commit-msg` hook. The fixture needs four things to be hermetic. Husky reads `$XDG_CONFIG_HOME/husky/init.sh` before it checks `HUSKY`, so `XDG_CONFIG_HOME` points at an empty directory. Every `GIT_*` and `HUSKY*` variable is stripped from the environment, so a run from inside a git hook cannot reach the real checkout and a `HUSKY=0` cannot disable the hook. `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` ignore user and system git config. The `node_modules` symlink is unlinked before `rmSync`, so the recursive delete cannot follow it into the real one. `git merge --log` lists the merged commits newest first.

<!-- kk:related:start -->
# Related

- Related: [map-test-and-static-analysis-layout](../testing/map-test-and-static-analysis-layout.md)
<!-- kk:related:end -->
