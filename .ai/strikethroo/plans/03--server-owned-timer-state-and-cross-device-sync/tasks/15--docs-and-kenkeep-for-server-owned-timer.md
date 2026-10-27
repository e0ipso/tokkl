---
id: 15
group: "docs"
dependencies: [3, 6, 10, 11, 13, 14]
status: "pending"
created: 2026-10-27
skills:
  - technical-writing
  - markdown
complexity_score: 4
execution_profile: "docs-and-config"
---
# Docs and kenkeep nodes for the server-owned timer

## Objective
Update the PRD, the fixtures README, the desktop READMEs, the deployment notes and the kenkeep nodes so they describe the server-owned session, pause chain and SSE stream, and stop describing the removed client code.

## Skills Required
Technical writing in Markdown.

## Acceptance Criteria
- [ ] `docs/PRD.md`:
  - T13 says the server owns the session and the pause chain. The sentence "The session lives on the device. The server stores only the saved entries and the four defaults." is gone, and so are the status notes about save retries, the unsaved count and signout saves;
  - the API table lists `GET /api/app/timer`, the three `/api/app/timer/*` actions, the three `/api/app/pomodoro*` actions and `GET /api/app/timer/events`, with the `TimerState` fields as built (including `pause` existing for the whole chain and the top-level `discarded_pomodoro`);
  - C6, C7 and C8 say sessions and pauses are shared across devices and need a connection;
  - the note on client-specific preferences is updated if it changed.
- [ ] `packages/common/fixtures/README.md` says the server runs `pomodoroSession.json` and that a client reading the server state needs no port.
- [ ] `desktop/kde/README.md`, `desktop/gnome/README.md` and `desktop/macos/README.md` say sessions and pauses are shared across devices and need a connection, and drop mentions of removed files.
- [ ] `README.md` (or the deployment section it points to) gives reverse proxy settings for `/api/app/timer/events`: no buffering, and a read timeout well above 25 s. Include an nginx example (`proxy_buffering off; proxy_read_timeout 1h;`).
- [ ] Kenkeep:
  - nodes that describe removed code are rewritten or deleted. These are the web Pomodoro provider, controller and account-state maps, the Web Lock save claim, the hand-over-at-one-instant practice, the web timer bar pause-chain rules, end-sessions-through-lib-session, the KDE timer controller rules, the macOS menu bar map and the desktop core CMake map;
  - new nodes describe the timer state service with its settlement and revision, and the SSE stream with its keep-alive, auth rechecks and cap;
  - branch `index.md` files list the nodes that exist.
- [ ] `grep -rnE "pomodoroSessionLock|pomodoroSessionRetry|tabChain|ChainStore|PomodoroQueue|pomodorocycle" docs README.md desktop/*/README.md .ai/kenkeep/nodes` prints nothing, unless a match describes the change itself.
- [ ] No plan or ticket references in the docs.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Describe what was built, not what the plan proposed. Read the final routes, the `TimerState` type in `packages/types/index.ts` and the core headers before writing.
- Keep each document's existing voice and table formats.
- New kenkeep nodes: use the `kk-add` skill, which writes nodes in the right place and format. Edit or delete existing nodes directly.

## Input Dependencies
- Task 3: the final API.
- Task 6: the final web behaviour.
- Tasks 10, 11, 13 and 14: the final desktop behaviour.

## Output Artifacts
Docs and kenkeep nodes that match the code.

## Implementation Notes
<details>
<summary>Step-by-step guidance</summary>

1. Find every stale passage: `grep -rniE "pause chain|chainstore|pomodoro session|web lock|unsaved|lives on the device" docs README.md desktop/*/README.md packages/common/fixtures/README.md .ai/kenkeep/nodes`.
2. PRD API table: find the existing `/api/app` rows and add the new ones in the same format.
3. Kenkeep: read `.ai/kenkeep/README.md` for the node format. Check each listed node's `relates_to` and `depends_on` edges, so no edge points at a deleted node.
4. Keep sentences short and plain. Use the `unslop` skill on the final text.
</details>
