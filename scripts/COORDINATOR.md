# Ticket coordinator — operations notes

`coordinate-tickets.mjs` runs a queue of GitHub tickets through
implement → verify → review → accept, committing locally on the configured
branch. `coordinator-status.mjs` inspects a run; `coordinator-notify.sh`
(+ `coordinator-push.sh`) wake a conversation and push to the exe.dev mobile
app on blocked/done events.

## Review loop: ONE persistent reviewer per ticket

The reviewer is a `pi --mode rpc` session with a persistent `--session-dir`.
It is created ONCE per ticket (cycle 0) and **reused across every repair
cycle** so it remembers its own prior findings:

- Cycle 0 uses `buildReviewPrompt` (full two-axis review).
- Later cycles use `buildReReviewPrompt` (a *convergence* prompt): verify whether
  each previously-raised blocker is resolved; only raise a NEW blocker for a
  genuine regression or an unmet acceptance criterion of equal/greater severity
  — not incremental edge-case polish. When in doubt, accept.

Why: a fresh, memoryless reviewer each cycle keeps inventing new niches and
never converges (observed on #31 and #33). A persistent reviewer holds the line
on real defects and accepts once they're fixed. `stopReviewer()` tears the
session down at every ticket exit (accept/block/maxRepairCycles) and at the
start of the next ticket.

## Do NOT commit to the branch while a ticket is mid-run

The reviewer diffs `baseCommit...HEAD`. `baseCommit` is captured when the ticket
STARTS. If you commit unrelated work (tooling, config) while a ticket is
running, HEAD advances underneath it and the review diff shows YOUR commits —
the reviewer then reports "ticket not implemented" or "unrelated scope creep"
(this wasted two of #33's cycles). Only commit tooling/config **between**
tickets, when the coordinator process is stopped.

## e2e stability on this VM

This VM has 2 cores. `playwright.config.ts` pins `workers: 1` + `retries: 2`.
Full-parallel Chromium under the Vite server OOMs and crash-kills random
UNRELATED specs ("Page crashed"), which failed the whole verify gate and burned
repair cycles. Keep it serialized; the ~4-min suite is worth the reliability.

## Callbacks land in a pinned conversation

Notify precedence: `COORD_NOTIFY_CONVO_ID` env → run-dir pin file
`notify-convo.txt` → new conversation. The env var does NOT propagate through
tmux; rely on the pin file. Current pin is checked before every `--resume`.
