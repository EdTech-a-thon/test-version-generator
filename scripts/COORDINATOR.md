# Ticket coordinator

From the repository root:

```sh
node scripts/coordinate-tickets.mjs --tickets 6,7
node scripts/coordinator-status.mjs
node scripts/coordinator-status.mjs --ticket 6
node scripts/coordinate-tickets.mjs --resume
```

`--push` additionally pushes each accepted commit and closes its GitHub issue.
It can be supplied at launch or resume; that choice persists for the run.
Without it, accepted commits are integrated locally and issues remain open.
The script does not launch other tickets merely because they are available.

The skill at `.agents/skills/orchestrate-tickets/SKILL.md` guides launching,
inspection and recovery. Modules and prompts under `scripts/` are the single
executable implementation; the skill does not duplicate them.

## Ownership and verification

A fresh run requires a clean checkout, including untracked files, on the
configured branch. It acquires `.coordinator/run.lock`, creates a detached
worktree under `.coordinator/runs/<run-id>/worktree`, and runs configured setup
there. Dependencies belong to that worktree. Preserve it until the run is
finished or its outstanding work has been recovered.

The worker's Git tree, including new files, deleted files and modes, is the
candidate identity. An alternate index captures it without staging in the
launch checkout. Review receives the captured diff, file manifest, prior
verification evidence and finding ledger. It never depends on an uncommitted
ticket appearing in `base...HEAD`.

Each ticket follows:

```text
implementation → cheap/affected checks → review
       ↑                                  │ reject
       └──────── specific repair ─────────┘
                          accept → full checks → commit → local integration
                                                        → optional push/close
```

The coordinator owns full-suite execution. Worker agents use targeted checks.
`verification.quick` always runs; `affected` rules select additional commands.
Changed browser test files can use `browserCommand`. An unknown changed path
or an explicit `full` rule falls back to the full suite. `required` rules add
checks such as the repository's export diagnostic. Final verification always
runs the full gate on the reviewed candidate, even when conservative selection
already ran it earlier. This avoids caching across uncertain environment
changes. Dependency manifest/lockfile changes rerun setup first.

Keep browser execution serial on this VM. Retry-passes are recorded as flaky
in command events, even when the command succeeds. Browser assertion quality
is covered in `docs/browser-assertions.md`.

Only a candidate with matching review and final-verification identities may
be committed. The script uses `git commit-tree` with a message file, bypassing
commit hooks to prevent post-verification rewrites. Required hook checks must
be configured as verification commands. Local integration is a fast-forward
with hooks disabled, and requires the launch checkout to remain clean on the
configured branch at the ticket's base (or already at its committed result).
If you work in the launch checkout concurrently, the run may block at this
integration step; your changes are preserved.

## Recovery and bounded triage

Schema-version-2 runs persist their configuration, exact Pi session paths,
original ticket base, current phase, budgets, candidate identities and finding
ledger. `--resume` restores that information. A process interruption during an
agent turn repeats the unfinished phase using the same session file; an
already-recorded completed phase is not repeated. Repair and agent-turn
budgets do not reset on restart. Changing `coordinator.config.json` affects
new runs, not the frozen policy of an existing run.

Commit, local integration, push and issue close have separate checkpoints.
A failed push or close resumes publication of the recorded commit. It does
not ask an implementer to redo the ticket. Commits are retained by
`refs/coordinator/<run-id>/<ticket>` so interrupted work remains reachable.

Legacy runs cannot be safely resumed under this schema. Inspect and preserve
their artifacts and outstanding work, then explicitly start a new queue from
a clean checkout. There is no automatic conversion, reset, or deletion.

Blocked results include a failure kind:

- `environment`: command/process failure, exhausted bounded infrastructure
  retries, or dependency setup failure. Inspect the log and environment before
  resuming. Generic assertion failures are not classified as infrastructure.
- Agent-reported `test-conflict` and `spec` blockers need a decision about
  the conflicting acceptance contract. Ordinary failed verification goes to
  the implementer within its repair budget.
- `protocol`: invalid current-turn JSON or inconsistent finding IDs. A small
  format-only retry budget runs in the same session without rerunning tests.
- `budget` or `no-progress`: stop and inspect repeated findings/repairs.
  Resume does not replenish budgets. Do not reset counters merely to bypass
  the stop; a deliberate policy change requires the user's direction.
- `integrity`, `integration`, or `publication`: inspect the preserved
  candidate/commit and relevant checkout or remote state. Resume retries the
  recorded phase, not an alternate merge or force-push.

An operator or Shelley may inspect artifacts and retry within the already
authorized task. Product/spec changes, expanded ticket scope and new external
actions require the user's direction. A notification alone does not authorize
those changes.

The run lock is exclusive and ownership-checked on release. Normal exit
releases it; interruption deliberately leaves it for inspection. Before
removing a stale lock, inspect its PID, heartbeat, and surviving Pi/browser/
verification descendants and confirm they have stopped. Do not delete a lock
solely because its timestamp is old. Then remove only that verified stale
lock and use `--resume`. Agent/command deadlines terminate their process
groups; a heartbeat is written while asynchronous work is running.

## Evidence and notifications

Each run retains `state.json`, `events.jsonl`, `heartbeat.json`, and its worktree.
Ticket directories contain the issue snapshot, numbered `attempts/` with
prompts/responses, exact session files, candidate manifests/diffs, verification
logs/receipts, `findings.json`, and the commit message. Attempts are numbered
across resumes, so prior reports are not overwritten. `findings.json` is the
latest ledger snapshot; finding transitions remain in append-only events.

Events record stage transitions, candidate IDs, agent/command durations,
command exits/flakes, completed-message token usage, verdicts and publication
checkpoints. Usage is taken from completed assistant messages, not streaming
duplicates. Cached input and output remain distinct; absent or zero cost
metadata is not evidence of free execution. Human attention and escaped
defects still need outcome annotations or issue follow-up; they cannot be
inferred from agent agreement or passing tests.

Blocked/done summaries include the worktree, session paths and outstanding
findings. Existing notification hooks retain an inbox copy and use their
configured Shelley conversation/mobile integration. Notification failures
are recorded and do not undo accepted work. Delivery is best-effort, not an
exactly-once message queue.

## Offline validation

```sh
node --test scripts/coordinate-tickets.test.mjs scripts/coordinator-*.test.mjs
```

Tests use temporary real Git repositories plus injected GitHub/model replies;
they do not spend model tokens, push branches or close issues. The browser
suite and export comparison are not needed for coordinator-only changes.
