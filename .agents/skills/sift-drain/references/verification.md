# Wave verification and PR readiness

Read this after test authoring and capture commits land, and again after fixes change inputs.
Pins are checked by `tests/static/skill-prose-pins.test.sh`.

## Choose checks by stage

The e2e specialist owns reachable behaviour and scoped browser checks. Batch coverage owns
waived criteria and scoped checks. Keep both specialties. Land their commits and capture
durable knowledge while scoped checks are green. Assign one verification owner for the
integrated checks at each wave and the final PR readiness pass. The coordinator may carry
verification or delegate it. Return commands, statuses, available totals and absolute logs.

At the first gate, inventory required commands from project instructions, manifests and CI.
Keep the starting integration commit as the drain base. Classify checks by the assurance
they provide, rather than by duration alone. Refresh the plan when later waves change scope.
User directives and explicit project requirements take precedence over this default:

- Every ticket keeps reproduction, affected-file tests and affected lint/static analysis.
- Every wave verifies the affected tests together on the integrated tree, affected build
  paths, lint/static analysis and an integration smoke covering changed interfaces and
  reachable behaviour. Keep cheap repository-wide checks here. Exercise directly affected
  packaging, upgrade, security and data-integrity invariants now. Review and coverage
  authoring stay at the wave gate. If a reliable scoped selector or smoke does not exist,
  run the affected suite in full at this gate.
- The final PR pass runs full applicable tests, authoritative lint/static analysis, full
  e2e and required native/package checks across the accumulated drain changes. Broad browser,
  distro, version and install/upgrade matrices may wait here when the wave already exercises
  the changed behaviour and project policy permits it. Do not drop a format or version
  because a different one passed. Preserve the project's split between local and CI checks.

A wave closes only after its required integrated checks pass. Report it as wave checks
passed with PR checks pending. Deferred checks remain required; a wave close is not a claim
that the full verification passed. A missing affected check blocks the wave.

## Record obligations for resume

Use `drain-log.sh trace ... check DETAIL` to retain the verification plan in RUNLOG. Give
each check a stable token within the drain. Record its command, tier `wave` or `pr`, runner
`local` or `ci`, status, and a reason for deferral. Retain the original run token and drain
base after context loss. These diagnostic rows do not change ticket status.

```sh
"$SCRIPTS_DIR/drain-log.sh" trace "$CLOSE_ID" "$WAVE" close check \
  'check=browser-full tier=pr runner=local status=pending command=npm run test:e2e reason=affected specs and integration smoke run at wave close'
```

Append results under the same check token with command, exit status, checked commit/tree,
environment identity and absolute raw log. Use status pass, fail or unavailable, and retain
the reason for anything outstanding. `drain-log.sh report` displays these rows as recorded;
it does not certify their currency or compute a readiness verdict. After resume, read the
run's check rows and reconstruct obligations against project instructions, CI and the whole
drain diff. Never infer an empty pending list from a missing record or only the latest wave.

## Final PR readiness pass

Run this pass when no dispatchable work remains, before handing off for PR creation, even
if every wave closed. Use a new context with stage `pr-ready` and the last wave number.
Reconcile the recorded obligations with the accumulated diff from the original drain base.
Run all required local full checks on the final integrated code, tests and captured knowledge.
An earlier wave's full run can count only if its inputs still match the identical-tree rules
below. Never substitute scoped evidence for a required full check.

Group failures by root cause and land scoped fix commits through the normal ticket/review
path. Reconcile superseded knowledge before repeating verification. Any code, test, fixture,
build, lockfile or configuration change invalidates checks whose inputs changed. With no
established input map, invalidate all checks at that tier. Apply this rule at wave close too.
Keep per-ticket reproduction, scoped verification and one commit per ticket.

Required local failures or unavailable checks block local PR readiness. CI-only matrices
stay pending for the PR; do not replace them with local runs contrary to project policy.
Report local PR checks passed and required CI pending separately. Only claim full green
after all required local and CI checks pass on current inputs. A pause or blocked handoff
lists outstanding checks. This pass grants no permission to push, open a PR or merge.

## Identical-tree evidence

`scripts/verify-tree.sh RECEIPTS SUITE ENVIRONMENT NEW_LOG COMMAND...` either runs a command
or reports the preserved log of a successful identical invocation. Use an absolute receipt
directory made with `mktemp -d` outside the checkout, fresh for this drain. The key includes
the physical checkout, committed tree, suite, explicit environment identity and exact argv.
It refuses dirty tracked files, untracked files, changed trees, failures and missing or
modified evidence logs. Commit authoring before requesting a reusable full check. Do not
run other writers in that checkout while it checks. It never caches a failure.
Pass a blocking test runner, not a shell that merely launches it in the background.

The owner must establish the environment identity before enabling reuse. Include runtime
and tool versions, effective environment/configuration, ignored dependency and fixture
state, browser/container identities and external-service state relevant to that command.
Rotate it after any install, generated-input change or external-state change. The helper
cannot inspect every ignored input. If that identity cannot be established, run the command
normally with `drain-log.sh timed`; do not enable reuse. Live network, clock-sensitive and
mutable external-service checks run fresh unless the project establishes deterministic inputs.

Reuse is local to this checkout and drain. Cross-worktree reuse is deliberately excluded
because absolute paths and ignored setup may differ. Same commit is insufficient when the
worktree is dirty. An amend changing only commit metadata can reuse the same tree.

Blanket Markdown or `.ai/kenkeep` exclusions are unsafe: documentation can be a test input,
and validators may read the knowledge catalog. Run any invalidated checks for this stage
after capture too. A project-specific, reviewed input map could certify a narrower tree projection, but
this helper does not implement one. Never use profiler repetition candidates as certificates.
Tracker consistency/reference checks always run fresh against the live ignored tracker.

## Resource ownership

Keep full verification in one resource lane. Do not have e2e, coverage and close start the
same full suite concurrently. Within workers, start at most one heavy browser suite or
container build per sitting. Follow run-management.md's dispatch budget and project-owned
image reuse rules; a cached dependency image never substitutes for building and testing code.

```text
@PIN: src/skills/sift-drain/scripts/verify-tree.sh clean_tree() {
@PIN: src/skills/sift-drain/scripts/drain-log.sh trace_row() {
```
