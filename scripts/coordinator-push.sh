#!/usr/bin/env bash
# Best-effort mobile push via the exe.dev `notify` integration. Invoked by
# coordinator-notify.sh at a terminal event (blocked | done). Never fails the
# caller: a push problem must not abort the rest of the notify hook.
#
# Reads the same COORD_* environment the coordinator exports. Override the
# endpoint with COORD_NOTIFY_PUSH_URL if the integration is named differently.
set -uo pipefail

NOTIFY_URL="${COORD_NOTIFY_PUSH_URL:-https://notify.int.exe.xyz/}"

if [ "${COORD_EVENT:-}" = "blocked" ]; then
  TITLE="Coordinator BLOCKED — #${COORD_BLOCKED_TICKET:-?}"
  BODY="Run ${COORD_RUN_ID:-?} needs a human on ticket #${COORD_BLOCKED_TICKET:-?}. Accepted: ${COORD_ACCEPTED:-none}."
else
  TITLE="Coordinator DONE"
  BODY="Run ${COORD_RUN_ID:-?} finished. Accepted: ${COORD_ACCEPTED:-none}."
fi

command -v curl >/dev/null 2>&1 || { echo "push: curl missing"; exit 0; }
command -v node >/dev/null 2>&1 || { echo "push: node missing"; exit 0; }

JSON="$(TITLE="${TITLE}" BODY="${BODY}" node -e 'process.stdout.write(JSON.stringify({title:process.env.TITLE,body:process.env.BODY}))' 2>/dev/null)"
[ -n "${JSON}" ] || { echo "push: could not build payload"; exit 0; }

if curl -s -X POST "${NOTIFY_URL}" -H 'Content-Type: application/json' -d "${JSON}" >/dev/null 2>&1; then
  echo "push: sent mobile notification (${COORD_EVENT:-?})"
else
  echo "push: mobile notification failed (non-fatal)"
fi
exit 0
