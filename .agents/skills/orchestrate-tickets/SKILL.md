---
name: orchestrate-tickets
description: Run this repository's explicit GitHub ticket queue through the canonical coordinator, including bounded repair, review, resume, and optional publish checkpoints.
---

Use this skill only when the user explicitly asks to launch, resume, monitor,
or publish a ticket-coordinator run. The canonical implementation is
`scripts/coordinate-tickets.mjs`; the canonical policy is
`coordinator.config.json`; operational notes are in `scripts/COORDINATOR.md`.
Use the coordinator's `--help` and that operations document for current
behavior. Inspect the implementation only when those sources leave a behavior
ambiguous. Do not copy its stage logic or configuration into this skill.

The standing user scope for an invoked run is bounded to the named GitHub
tickets and this repository's configured branch. The coordinator may read the
ticket and comments, run the configured verification, use the configured agent
sessions, create the ticket commits, and write run artifacts under
`.coordinator/`. Closing issues and publishing are external mutations reserved
for the explicit `--push` path; use `--push` only when the user explicitly
includes publishing in the request.
The coordinator's notification command may run only as configured for the
run; do not add recipients or channels in the skill.

Invoke the canonical entry point for the requested operation:

```text
node scripts/coordinate-tickets.mjs --tickets 6,7
node scripts/coordinate-tickets.mjs --resume
node scripts/coordinate-tickets.mjs --resume --push
node scripts/coordinator-status.mjs --ticket 6
node scripts/coordinator-status.mjs --follow
```

Each fresh run uses the coordinator's detached run worktree under
`.coordinator/runs/<run-id>/worktree`. Preserve the run's identity snapshot,
single-run lock, configuration identity, event ledger, and session artifacts.
At integration time, the root checkout must be clean, on the configured branch,
and at the expected base; integrate only through the canonical checkpoint. A
changed root checkout or mismatched base is a block to surface, not a reason to
rewrite state or merge around the check.

A resume must match the recorded run identity and may continue only that run.
Inspect an existing lock with `coordinator-status.mjs`; recover it only after
verifying that its recorded PID and descendants are gone, preserving the lock
event in the run artifacts. Legacy run formats are unsupported. If the current
run is legacy or lacks a compatible identity
snapshot, preserve its artifacts and outstanding user work. Start an explicit
fresh `--tickets a,b` run only after a clean launch checkout is available.

The coordinator owns the sequence: implement, configured verification, review,
bounded repair, final verification, candidate commit, root integration,
optional push, and issue close. A repair loop stops at the configured limit. A
blocked or malformed stage persists its logs and ledger event, then reports the
exact ticket and artifact path for triage. Triage may inspect the latest issue,
verify, and review evidence and retry the current bounded operation; it must
leave the ticket blocked for the user when the configured limit or missing
decision is reached.

Use the read-only status command to monitor progress and inspect review or
verification evidence. Treat each event and ledger checkpoint as durable
state: a notification is not proof that a commit, issue close, or push
succeeded. Confirm the corresponding artifact and repository state before
reporting completion.

Completion means every requested ticket is accepted with its final verification
candidate commit and integration checkpoint recorded, or the run is explicitly
blocked with the failure evidence and next human decision named. A local run
does not close issues or claim publication. A `--push` run is complete only
after the canonical order—push, then issue close—succeeds; never claim either
from a local commit alone.
