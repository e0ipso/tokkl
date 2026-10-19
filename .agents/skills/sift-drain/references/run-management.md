# Running the drain

Use this guidance for decisions within `SKILL.md`'s orchestration loop. The worker contract
and report schema live in `ticket-agent-prompt.md`. Fresh handoffs keep its fixed contract
first and all changing values in the trailing named Assignment fields. Retained handoffs
append only a complete new Assignment block; preserve its field order and contract wording.

Pins: `tests/static/skill-prose-pins.test.sh`.

```text
@PIN: src/skills/sift-drain/SKILL.md ## Wave graph
@PIN: src/skills/sift-drain/SKILL.md ## Consume worker reports
@PIN: src/skills/sift-drain/SKILL.md ## Wave gate
@PIN: src/skills/sift-drain/references/ticket-agent-prompt.md This file is the sole full worker contract.
```

## Ticket intake

Prioritize ready tickets. Pull new p1 work forward immediately, especially broken test
infrastructure. Put p2 crash and data-integrity fixes ahead of p3/p4 work. Dependencies and
write-scope edges still take precedence.

Check integration history and branch names for prior work on proposed tickets. Pass the
checked base commit and matches, including an explicit no-match result, to the worker for
live verification; status alone cannot establish whether work is missing.

### Write scope is an edge, not a hope

Map ticket citations to files. Sequence sittings that touch the same product file; dispatch
the later one after the earlier commit lands. Add `depends_on` edges. Treat directories,
generated assets and shared templates as overlapping until tickets narrow their scope.

Use `cluster` for shared orientation, never as proof of disjoint writes or permission to
bypass priority. Consult `next-ticket.sh --group` for cluster membership and size bounds.
Assign wave-less tickets a wave before dispatch. Every sitting stays within one live wave
and starts only after its incoming edges clear.

Include documentation made inaccurate by a ticket's change in that ticket's scope and
commit. For separate follow-ups, reuse a worker with relevant context or batch small
maintenance items, subject to priority and dependencies.

Prepare branches and worktrees centrally with `prepare-worktree.sh`. Exit 3 means the
worktree exists but the project's setup hook failed. Do not dispatch into it. Report its
path, branch and the hook status from stderr, and keep it for inspection. Never reset, clean
or reuse it; a retry prepares a fresh path and branch. Exit 1 or a git error means nothing
was created. Pass the worktree and shared `SIFT_ROOT` to workers. On reuse, wait for the
worker to stop, land completed work, then prepare a new branch/worktree from current
integration state for its next assignment. Keep the old worktree if it holds unfinished
work. Never reset or clean a tree holding live tickets. Workers never check out the
integration branch.

## The tree moves underneath you

Users and parallel sessions can change ignored tracker files without git history. Keep a
disposable ticket snapshot outside the tracker. `ticket-snapshot.sh` prints sorted `cksum`
records with absolute paths for both buckets; it never writes tracker state. Its `changes`
command returns only changed IDs as TSV: event, ID, old path, new path. Events are `added`,
`changed`, `moved`, `moved+changed` and `deleted`. A hyphen represents an absent path.
Identical snapshots return no records. Duplicate IDs or malformed input fail the comparison.

```sh
# Once per drain session; SCRIPTS_DIR is the resolved drain scripts directory.
SIFT_REFRESH_DIR=$(mktemp -d) &&
  : > "$SIFT_REFRESH_DIR/previous"

# Before each dispatch, alongside wave-status.sh:
"$SCRIPTS_DIR/ticket-snapshot.sh" > "$SIFT_REFRESH_DIR/current" &&
  "$SCRIPTS_DIR/ticket-snapshot.sh" changes "$SIFT_REFRESH_DIR/previous" \
    "$SIFT_REFRESH_DIR/current" > "$SIFT_REFRESH_DIR/changes"
# Page changes and relevant ticket bodies with read-context.sh; never cat a whole wave.
```

Stop on setup, scan or comparison errors and discard partial output. On first load, read
every remaining current-wave ticket, one bounded page at a time. Thereafter read only added
or content-changed tickets in that wave and changed dependency targets needed by its graph.
A pure move updates the path without rereading unchanged content. A deleted or archived
ticket leaves pending work; do not silently release its in-flight worker ownership. Resolve
that assignment before a conflicting dispatch. Later-wave changes need no body read until
they affect this wave. A wave change requires loading that wave even when its files are
unchanged relative to the previous snapshot.

Retain each read ticket's ID, path, priority/status/wave, dependencies, cited write scope
and fingerprint. Rebuild the graph from all retained records reconciled with the current
snapshot, not only delta records. A missing dependency is a blocker to resolve, never proof
that it landed. Preserve priority, overlap edges and separate commits.

After every required page is consumed, copy `current` to `previous` and scan again before
dispatch. If that check produces more changes, consume them before advancing. This detects
edits during intake without assuming git history or dates changed. It is not a tracker lock;
worker tamper checks still apply. Never acknowledge unread pages after truncated output.

After context loss, discard the old comparison baseline, run live wave status and reconstruct
the current wave's ticket records, dependency targets and in-flight assignments explicitly
from the tree and worker reports. Old fingerprints do not prove old reads remain known.
Remove this session's temporary directory when the drain ends.

Use content checksums rather than `updated`, mtimes or git diffs: edits may preserve dates,
and the tracker is usually ignored. Check integration history when an unexpected tracker
change needs explanation. Accept the live tree and mention a reshuffle in the next update.

## Trace each sitting and gate

Use a run token plus a monotonic dispatch number for SITTING_ID, for example
`drain-20261019-a-s17`. Never derive membership from a timestamp. Assign a new context for
retries and retained assignments. Gate and review contexts use the same protocol with stage
e2e, coverage, review, fix, capture, close or pr-ready. Substitute SITTING_ID and SCRIPTS_DIR in every
gate fence. The coordinator stamps dispatch before launch, reported immediately on report
receipt, landed after integration, and return with outcomes. Gate agents do not write
tracker state; their trace appends through drain-log.sh are the sole exception.

```sh
"$SCRIPTS_DIR/drain-log.sh" trace "$SITTING_ID" "$WAVE" worker dispatch "tickets=$GROUP_TICKETS"
"$SCRIPTS_DIR/drain-log.sh" trace "$SITTING_ID" "$WAVE" worker reported 'status=done'
"$SCRIPTS_DIR/drain-log.sh" trace "$SITTING_ID" "$WAVE" worker landed 'commit=<integrated-hash>'
"$SCRIPTS_DIR/drain-log.sh" trace "$SITTING_ID" "$WAVE" worker return 'tickets=<ID:status,...>'
```

Use phase stamps for orient, implement, verify and bookkeep. First-edit records the first
product mutation and self-reported prior tool-call count as `tools=N` or `tools=unknown`.
No edit means no first-edit row. Record skipped stages explicitly with event skipped.
Use `timed CONTEXT WAVE STAGE KIND SPAN ABSOLUTE_LOG COMMAND...` for measured commands;
it preserves the command's status and never overwrites a log. SPAN is unique within its
context. It records the observed clean tree or unknown, commit, argv checksum and optional
SIFT_LOG_ENV identity. Split compound suites into separate commands for useful attribution. Measure worktree
preparation under a separate context derived from SITTING_ID, such as its .setup suffix,
with stage setup and kind setup. Stamp dispatch/return around preparation. Keep wave and
stage constant within each context; the worker gets its own dispatch only after setup
succeeds. If the project hook installs dependencies, its own timed span or a verified nested
metric is needed to attribute npm_ci within setup. A setup failure stays in the setup
context and never dispatches a worker.
Image-build time inside a project container wrapper requires that wrapper's own timing
stamps. After reading one, append event metric with kind=image_build, seconds=N and
source=<log:line>. Do the same for nested ctest or other command durations. Keep these
reported nested metrics separate from enclosing command spans. Without such evidence,
time is included in the container span, never guessed separately.

For asynchronous work, the timed wrapper stays with the job until it ends. Also stamp
wait-start/wait-end with `span=<unique-token> kind=wait` around agent-tool waits. Interrupted
or missing end stamps remain unknown. Spans may overlap; do not add them as elapsed time.
Use first-edit and command trace stamps in capture agents too, even when they change only
knowledge files. Read-only review has no first edit. Stamp review commands outside the
before/after tamper-snapshot interval as code-review.md specifies.

The six-column log is append-only. Legacy rows remain readable and unattributable parallel
legacy rows remain unknown. `drain-log.sh report` reads new contexts without epoch grouping.
The optional offline profiler in the Sift source repository reconstructs the same trace from
RUNLOG alone; see docs/drain-profiling.md there. Trace detail is bounded, single-line and
pipe-free. Keep long commands and outputs in the named absolute log.

Record verification obligations/results with event check as verification.md describes.
Keep stable check tokens and the original run token across resume. The report displays
these records without deciding readiness. Wave summaries distinguish passed wave checks
from pending PR checks; the final handoff reconciles all required local and CI obligations.

## Resource budget

Before dispatch, inspect the available CPU count and current load with read-only host tools
when available. Classify browser suites and native/container builds as heavy. Allow at most
two heavy sittings in flight, each with one heavy command at a time. If load is at least the
CPU count, reduce the budget to one. When load or CPU count is unavailable, use one heavy
sitting. Do not cancel existing work to meet a lower budget. Non-heavy, disjoint work may
fill other harness slots. User resource limits take precedence.

When over budget, wait for a completion signal from this run and reassess; do not ask the
user to manage load. If this run has no active heavy work, allow one ready heavy sitting to
make progress even when another session keeps host load high. Never stop another session's
processes or containers. Record the budget, sampled load and reason in a resource trace row.
Treat this default as a conservative starting point; the profiler measures whether it helps.

Reuse project dependency images only through their verified identity protocol. Prefer
identity-specific tags or a project-owned cache hook that coordinates concurrent builders.
A label mismatch must rebuild. Never retag, replace or remove images owned by another run.
Do not invent private image tags as a substitute for understanding the cache, or bypass its
identity checks. Project-specific cache changes require their own product work.

## Worker check-back

- For ordinary judgment calls, resume the same worker with the canonical resume template.
- For tamper or overlap, identify the files and sittings. Wait for the earlier owner, land
  its work, then resume or redispatch the later sitting from current integration state.
  Never instruct either worker to overwrite the other's edits.
- For questions only the user can answer, accept a blocked report and apply the skill's
  failure policy.

Rebuild the graph after check-back. Check remaining citations for any newly discovered
shared path before dispatching again.

## Reporting to the user

Report one line per landed or blocked ticket: ID, outcome, verification headline and wave
position. Surface every self-filed ID even if previously mentioned.

Report the raw completion percentage with its limits. Later waves may contain heavier work;
`superseded` archives count as bookkeeping, not completed implementation.

Return incomplete reports to their author for missing landing or verification evidence.
Keep raw logs on disk; reports name commands, exit codes, available counts, failures and
absolute log paths. A runner's unavailable counter is `not reported`, never guessed or a
reason alone to repeat a successful check. Request bounded excerpts for unresolved failures.
Do not inspect implementation files to fill reports in.
