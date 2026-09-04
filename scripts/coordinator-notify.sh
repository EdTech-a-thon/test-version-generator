#!/usr/bin/env bash
# Coordinator notify hook. Invoked ONCE by the coordinator at a terminal event
# (a ticket blocked, or the run finished). NOT a poller — it runs, does its
# thing, and exits. The coordinator passes context via environment variables:
#
#   COORD_EVENT           blocked | done
#   COORD_RUN_ID          run identifier
#   COORD_RUN_DIR         .coordinator/runs/<id>
#   COORD_SUMMARY_FILE    path to the plain-text summary
#   COORD_SUMMARY         the summary text itself
#   COORD_BLOCKED_TICKET  ticket number (blocked event only)
#   COORD_ACCEPTED        comma-separated accepted ticket numbers
#
# Behaviour:
#   1. Always mirror the summary into a known directory (.coordinator/inbox/)
#      so a notification is never lost, even if Shelley is unavailable.
#   2. Wake a SEPARATE, NEW Shelley conversation (never the launching thread).
#      The first event of a run creates the new conversation and pins its id in
#      the run dir; later events (e.g. `done`) reuse that same new thread.
#
# Pin the callback target at launch by exporting COORD_NOTIFY_CONVO_ID to an
# existing conversation id; otherwise a fresh conversation is created on the
# first event.

set -euo pipefail

# Repo root is the coordinator's cwd; keep the known inbox stable there.
INBOX="${COORD_INBOX_DIR:-.coordinator/inbox}"
mkdir -p "${INBOX}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
cp -f "${COORD_SUMMARY_FILE}" "${INBOX}/${STAMP}-${COORD_EVENT}.txt" 2>/dev/null || \
  printf '%s\n' "${COORD_SUMMARY}" > "${INBOX}/${STAMP}-${COORD_EVENT}.txt"
printf '%s\n' "${COORD_SUMMARY}" > "${INBOX}/latest.txt"

# Compose the wake message.
if [ "${COORD_EVENT}" = "blocked" ]; then
  MSG="The ticket coordinator (run ${COORD_RUN_ID}) is BLOCKED on ticket #${COORD_BLOCKED_TICKET} and needs a human. Read ${COORD_RUN_DIR} (state.json and tickets/${COORD_BLOCKED_TICKET}/, including any review response.txt), then in a few sentences tell me what got done, why it's blocked, and the single next action. Accepted so far: ${COORD_ACCEPTED:-none}. To continue after the fix: node scripts/coordinate-tickets.mjs --resume"
else
  MSG="The ticket coordinator (run ${COORD_RUN_ID}) FINISHED — all queued tickets accepted (${COORD_ACCEPTED:-none}). Read ${COORD_RUN_DIR} and give me a short wrap-up of what shipped."
fi

if ! command -v shelley >/dev/null 2>&1; then
  echo "shelley CLI not found; summary written to ${INBOX}/ (${COORD_EVENT})"
  exit 0
fi

# Resolve the target conversation. Precedence:
#   1. COORD_NOTIFY_CONVO_ID pinned at launch.
#   2. A conversation this run already created (run-dir pin file).
#   3. Create a NEW conversation now and pin it for the rest of the run.
PIN_FILE="${COORD_RUN_DIR}/notify-convo.txt"
CONV_ID="${COORD_NOTIFY_CONVO_ID:-}"
if [ -z "${CONV_ID}" ] && [ -f "${PIN_FILE}" ]; then
  CONV_ID="$(cat "${PIN_FILE}" 2>/dev/null || true)"
fi

if [ -n "${CONV_ID}" ]; then
  shelley client chat -c "${CONV_ID}" -p "${MSG}" >/dev/null 2>&1 || \
    echo "warn: could not reach conversation ${CONV_ID}; summary is in ${INBOX}/"
  echo "woke Shelley conversation ${CONV_ID} (${COORD_EVENT})"
else
  # Create a fresh, separate conversation and remember its id for this run.
  NEW_ID="$(shelley client chat -disable-notifications=false -p "${MSG}" 2>/dev/null | jq -r '.conversation_id // empty' || true)"
  if [ -n "${NEW_ID}" ]; then
    printf '%s' "${NEW_ID}" > "${PIN_FILE}"
    echo "opened new Shelley conversation ${NEW_ID} (${COORD_EVENT})"
  else
    echo "warn: failed to open a Shelley conversation; summary is in ${INBOX}/"
  fi
fi
