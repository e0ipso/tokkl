# Wave gate

Run the gate between waves in this order: code review when the run's choice is on (see
code-review.md), e2e authoring, batch coverage authoring, knowledge capture, integrated verification,
root-cause fixes and any knowledge reconciliation, then close. The e2e specialist runs alone
after any code review. One owner runs the required integrated wave checks after all
authoring commits land. Read verification.md then; its final full pass runs at PR readiness.

Prepare each agent's branch/worktree with prepare-worktree.sh; on exit 3, do not dispatch
that agent, report it and keep the worktree (see run-management.md). Substitute
placeholders and dispatch the selected fence verbatim. Each fence contains its agent's full
ownership rules. Read only the numbered section for the stage now beginning. Do not preload
later prompts.

## 1. E2E specialist agent

Use a strong model. Skip authoring if no e2e layer exists or it cannot reach this wave's
behaviour; record why. An existing e2e suite still runs in full at PR readiness.

```
You are the e2e specialist closing Wave {{WAVE}} of the sift roadmap in {{PROJECT_ROOT}}.

Trace context {{SITTING_ID}}, wave {{WAVE}}, stage e2e. Helper: {{SCRIPTS_DIR}}/drain-log.sh.
Set SIFT_ROOT to {{SIFT_ROOT}} and export it before using either subcommand.
Use trace for phase and first-edit stamps, including tools=N before the first product edit or
tools=unknown. Use its timed command for verification, with unique span tokens and new
absolute logs outside the checkout. Use wait-start/wait-end around asynchronous tool waits.
Logging CLI: trace CONTEXT WAVE STAGE EVENT DETAIL; timed CONTEXT WAVE STAGE KIND SPAN LOG
COMMAND... . Record verified nested command durations as metric with kind=, seconds= and
source= naming the verified log and line. Leave full-suite scheduling to the verification owner.

Read project agent instructions, relevant knowledge entries and e2e conventions. Consult
manifests and CI config for missing commands. Verify every named path against the live tree.
Reuse unchanged instructions already available in this context; read new applicable scope
instructions and reload after context loss. Bound aggregate tool output to 8000 content bytes.
Keep raw verification logs outside the checkout; preserve exit codes and return commands,
available counts, failures and absolute log paths. Read logs in bounded pages or excerpts.

WAVE {{WAVE}} SHIPPED:
{{PER_TICKET_ONE_LINE_SUMMARIES}}

TASK
Check which shipped behaviours the existing browser, API, CLI or lifecycle tests can reach.
Report each as covered or skipped, with a reason for every skip. Leave unreachable behaviour
to batch coverage.

Reuse helpers and fixtures, follow suite conventions and avoid duplicate assertions. Update
fixture setup for changed interfaces. Iterate on one test file and run the affected e2e
specs. Report the full e2e obligation for the verification owner to schedule under
verification.md's wave/PR policy.

Fix test-side failures. Report product defects with reproduction evidence and proposed scope.
The orchestrator creates tickets before dispatching annotations that need their IDs.

Do not capture durable knowledge. Do not edit the sift-drain skill. Never file, comment on, or
patch an external tracker. Report upstream proposals as type: dx defects for the orchestrator.

Use the prepared worktree at {{PROJECT_ROOT}} and its checked-out branch. Commit your scoped
changes and report the commit for integration into {{BASE_BRANCH}}. Do not create a branch
or check out the integration branch. Do not merge. Never `git push`. Do not write tracker
state, including ticket files, archive moves or wave keys. Trace appends through
drain-log.sh are the only exception.

REPORT (only this):
  status: done | blocked
  commit: <hash>
  summary: <one paragraph>
  verification: commands, exit codes, log paths; e2e <N passed / M failed / K skipped>
                across <e2e test files>; unavailable counters: not reported
  behaviours covered: <one line each>
  behaviours skipped (no e2e surface): <one line each, with the reason>
  ticket-worthy defects: <one line each with evidence and proposed scope> | none
```

## 2. Batch coverage agent

Use a strong model. Populate {{WAIVED_CRITERIA}} from archived resolutions and reported
unsafe sequences. Do not add a fresh coverage audit.

```
You are the batch coverage agent closing Wave {{WAVE}} of the sift roadmap in
{{PROJECT_ROOT}}.

Trace context {{SITTING_ID}}, wave {{WAVE}}, stage coverage. Helper: {{SCRIPTS_DIR}}/drain-log.sh.
Set SIFT_ROOT to {{SIFT_ROOT}} and export it before using either subcommand.
Use trace for phase and first-edit stamps, including tools=N before the first product edit or
tools=unknown. Use its timed command for verification, with unique span tokens and new
absolute logs outside the checkout. Use wait-start/wait-end around asynchronous tool waits.
Logging CLI: trace CONTEXT WAVE STAGE EVENT DETAIL; timed CONTEXT WAVE STAGE KIND SPAN LOG
COMMAND... . Record verified nested command durations as metric with kind=, seconds= and
source= naming the verified log and line. Leave full-suite scheduling to the verification owner.

Read project agent instructions and relevant knowledge entries for test conventions and
verification commands. Consult manifests and CI config for missing details. Verify every
named path against the live tree.
Reuse unchanged instructions already available in this context; read new applicable scope
instructions and reload after context loss. Bound aggregate tool output to 8000 content bytes.
Keep raw verification logs outside the checkout; preserve exit codes and return commands,
available counts, failures and absolute log paths. Read logs in bounded pages or excerpts.

WAVE {{WAVE}} SHIPPED:
{{PER_TICKET_ONE_LINE_SUMMARIES}}
{{WAIVED_CRITERIA}}

TASK
Cover the deferred criteria above. Prefer integration tests, unit tests for pure logic and
heavy e2e tests sparingly. Extend existing classes unless the subject is new. Test unsafe
sequences in disposable integration fixtures. Report each criterion covered or skipped with
a reason. Do not chase coverage percentages.

Run scoped tests and lint/static analysis while authoring. Report exact results and any
existing e2e layer. One verification owner runs the required integrated wave checks after
these commits land and full suites at PR readiness. Your scoped results do not replace
integrated checks. Report the outstanding full-suite obligation.

Fix test-side failures. Report product defects with evidence and proposed scope; do not fix
product code here. The orchestrator creates tickets before dispatching fixes or annotations
that need their IDs.

Do not capture durable knowledge. Do not edit the sift-drain skill. Never file, comment on, or
patch an external tracker. Report upstream proposals as type: dx defects for the orchestrator.

Use the prepared worktree at {{PROJECT_ROOT}} and its checked-out branch. Commit your scoped
changes and report the commit for integration into {{BASE_BRANCH}}. Do not create a branch
or check out the integration branch. Do not merge. Never `git push`. Do not write tracker
state, including ticket files, archive moves or wave keys. Trace appends through
drain-log.sh are the only exception.

REPORT (only this):
  status: done | blocked
  commit: <hash>
  summary: <one paragraph: what is now covered>
  verification: commands, exit codes, log paths; tests <N tests, M assertions> scoped; full-suite obligations for verification owner;
                unavailable counters: not reported; lint <result>; static analysis
                <result>; e2e <N passed / M failed / K skipped> | no e2e layer; tests
                added: <count and class names>
  deferred criteria: covered <list> | not covered <list and why>
  failures needing a fix agent: <root-cause list> | none
  ticket-worthy defects: <one line each with evidence and proposed scope> | none
```

## 3. Root-cause fixes

Assign one agent per root cause.

```
Fix one root cause of Wave {{WAVE}} gate fallout in {{PROJECT_ROOT}}.

Trace context {{SITTING_ID}}, wave {{WAVE}}, stage fix. Helper: {{SCRIPTS_DIR}}/drain-log.sh.
Set SIFT_ROOT to {{SIFT_ROOT}} and export it before using either subcommand.
Use trace for phase and first-edit stamps, including tools=N before the first product edit or
tools=unknown. Use its timed command for verification, with unique span tokens and new
absolute logs outside the checkout. Use wait-start/wait-end around asynchronous tool waits.
Logging CLI: trace CONTEXT WAVE STAGE EVENT DETAIL; timed CONTEXT WAVE STAGE KIND SPAN LOG
COMMAND... . Record verified nested command durations as metric with kind=, seconds= and
source= naming the verified log and line. Leave full-suite scheduling to the verification owner.

ROOT CAUSE: {{ROOT_CAUSE_DESCRIPTION}}
FAILING: {{FAILING_TESTS_OR_SPECS}}

Read project agent instructions and relevant knowledge entries. Consult manifests and CI
config for missing verification commands. Verify every named path against the live tree.
Reuse unchanged instructions already available in this context; read new applicable scope
instructions and reload after context loss. Bound aggregate tool output to 8000 content bytes.
Keep raw verification logs outside the checkout; preserve exit codes and return commands,
available counts, failures and absolute log paths. Read logs in bounded pages or excerpts.

Fix the root cause. Never weaken or delete assertions to pass tests. Explain and justify
corrections to wrong expectations. Extend existing tests without duplicating coverage.

Run scoped checks and affected lint. The verification owner repeats invalidated checks at
the current wave or PR stage after all fixes land. Report
required checks that could not run and why. Report separate defects with evidence and scope
for the orchestrator to file and dispatch.

Do not capture durable knowledge. Do not edit the sift-drain skill. Never file, comment on, or
patch an external tracker. Report upstream proposals as type: dx defects for the orchestrator.

Use the prepared worktree at {{PROJECT_ROOT}} and its checked-out branch. Commit your scoped
changes and report the commit for integration into {{BASE_BRANCH}}. Do not create a branch
or check out the integration branch. Do not merge. Never `git push`. Do not write tracker
state, including ticket files, archive moves or wave keys. Trace appends through
drain-log.sh are the only exception.

REPORT (only this):
  status: done | blocked
  commit: <hash>
  summary: <one paragraph: the root cause and the fix>
  verification: commands, exit codes, log paths; <exact suite results>; unavailable counters: not reported
  ticket-worthy defects: <one line each with evidence and proposed scope> | none
```

## 4. Wave knowledge capture

Run once after known fixes land and scoped checks are green, before integrated wave
verification. Reconcile facts superseded by later fixes before repeating final verification.
Supply only durable candidates from the reports, with their ticket IDs, supporting citations and relevant decisions. Exclude test
totals, commit lists and resolved status chatter. Skip if no durable candidates or capture
skill exists; record why.

```
You are the knowledge-capture pass closing Wave {{WAVE}} of the sift roadmap in
{{PROJECT_ROOT}}. Every ticket of this wave has merged and scoped checks passed.
Authoritative integrated verification remains outstanding.

Trace context {{SITTING_ID}}, wave {{WAVE}}, stage capture. Helper: {{SCRIPTS_DIR}}/drain-log.sh.
Set SIFT_ROOT to {{SIFT_ROOT}} and export it before using either subcommand.
Use trace for phase and first-edit stamps, including tools=N before the first product edit or
tools=unknown. Use its timed command for verification, with unique span tokens and new
absolute logs outside the checkout. Use wait-start/wait-end around asynchronous tool waits.
Logging CLI: trace CONTEXT WAVE STAGE EVENT DETAIL; timed CONTEXT WAVE STAGE KIND SPAN LOG
COMMAND... . Record verified nested command durations as metric with kind=, seconds= and
source= naming the verified log and line. Leave full-suite scheduling to the verification owner.

WAVE {{WAVE}} KNOWLEDGE CANDIDATES (selected report excerpts with supporting evidence):
{{COLLECTED_SUB_AGENT_REPORTS}}

TASK
Read project agent instructions, the knowledge-base index and the capture skill in full.
Verify every named path, command and interface against the live tree before writing.
Reuse unchanged instructions already available in this context; read new applicable scope
instructions and reload after context loss. Bound aggregate tool output to 8000 content bytes.
Keep any raw verification logs outside the checkout and report commands, exit codes,
available counts, failures and absolute log paths with the summary.

Capture durable conventions, gotchas and named things from the whole wave in one pass.
Omit ticket narration and facts superseded later in the wave. Resolve curation conflicts
conservatively using the live tree and newest user directives. Do not pause for user input.
Zero candidates is valid.

Never edit the sift-drain skill. Do not file, comment on, or patch an external tracker.
Report upstream proposals as type: dx candidates for the orchestrator.

Use the prepared worktree at {{PROJECT_ROOT}} and its checked-out branch. Commit your scoped
changes and report the commit for integration into {{BASE_BRANCH}}. Do not create a branch
or check out the integration branch. Do not merge. Never `git push`. Do not write tracker
state, including ticket files, archive moves or wave keys. Trace appends through
drain-log.sh are the only exception.

REPORT (only this):
  status: done | blocked
  commit: <hash>
  summary: <one paragraph: what the wave taught that outlives it>
  entries captured: <one line each> | none
  conflicts resolved: <older claim -> what the live tree says> | none
```

## 5. Closing the wave

After the last fix lands, use verification.md to run all required wave checks together
on the integrated tree. Record permitted PR deferrals through drain-log.sh check rows.
Require passing wave results and available totals. Apply the skill's p1/p2 and closed-wave
tail rules before closing. A wave close does not certify the final PR checks.

Run `ticket-check.sh` (must exit 0), then post:

```
Wave {{WAVE}} closed.
  tickets done:    <IDs>
  tickets blocked: <IDs and one-line reasons> | none
  tickets filed:   <IDs and titles> | none
  code review: <command or model: N findings, M tickets filed> | skipped: <reason> | off
  tests added:     <classes/counts; e2e test files/counts>
  wave checks:     <commands, exits, available totals and logs>; affected e2e/smoke <result> | no e2e layer; lint <result>
  PR checks:       pending <check tokens and reasons> | none recorded; final reconciliation still required
  waves:           <wave-status.sh, summarised in one line>
```
