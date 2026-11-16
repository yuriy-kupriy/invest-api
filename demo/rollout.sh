#!/usr/bin/env bash
# HW #28 demo:rollout — a rolling update under load, measured.
# requests/ok/failed are COUNTED from the file the load generator writes (one
# status per response, 000 = no response). `failed` = every line that is not 200.
#
#   npm run demo:rollout                  # the graded, safe profile
#   PROFILE=broken npm run demo:rollout   # no readiness/drain, maxUnavailable 1
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROFILE="${PROFILE:-safe}"
NS=invest
DEPLOY=invest-api
URL="${URL:-http://127.0.0.1:30080/health}"
MIN_REQUESTS="${MIN_REQUESTS:-5000}"

pulumi_() { bash scripts/with-secrets.sh dev bash scripts/pulumi.sh "$@"; }

CODES=$(mktemp)
LOG=$(mktemp)
LOAD_PID=''
# On every exit, failures included: a broken run must never leave the stack on
# the broken profile, or the next plain `npm run up` deploys it.
cleanup() {
  local rc=$?
  [ -n "$LOAD_PID" ] && kill -TERM "$LOAD_PID" 2>/dev/null || true
  if [ "$PROFILE" != safe ]; then
    pulumi_ config set profile safe >/dev/null
    pulumi_ up --yes --skip-preview >"$LOG" 2>&1 || { cat "$LOG" >&2; rc=1; }
  fi
  rm -f "$CODES" "$LOG"
  exit "$rc"
}
trap cleanup EXIT

# Unmeasured: bring the cluster to the profile under test.
pulumi_ config set profile "$PROFILE" >/dev/null
pulumi_ up --yes --skip-preview >"$LOG" 2>&1 || { cat "$LOG" >&2; exit 1; }
kubectl -n "$NS" rollout status "deploy/$DEPLOY" --timeout=180s >/dev/null

node scripts/load.mjs "$URL" "$CODES" &
LOAD_PID=$!
sleep 1

# A new REV changes the pod template — the thing that actually starts a rollout
# (rebuilding the image under the same tag would not).
pulumi_ config set rev "$(date +%s)" >/dev/null
started=$(date +%s)
if ! pulumi_ up --yes --skip-preview >"$LOG" 2>&1; then cat "$LOG" >&2; exit 1; fi
kubectl -n "$NS" rollout status "deploy/$DEPLOY" --timeout=300s >/dev/null
rollout_seconds=$(( $(date +%s) - started ))

# A zero out of zero proves nothing: keep measuring the settled service until
# the sample reaches MIN_REQUESTS (bounded at 120 s).
for _ in $(seq 120); do
  [ "$(wc -l < "$CODES")" -ge "$MIN_REQUESTS" ] && break
  sleep 1
done

kill -TERM "$LOAD_PID"
wait "$LOAD_PID" || true
LOAD_PID=''

requests=$(wc -l < "$CODES" | tr -d ' ')
ok=$(grep -cx 200 "$CODES" || true)
failed=$(( requests - ok ))

echo "profile=$PROFILE"
echo "requests=$requests"
echo "ok=$ok"
echo "failed=$failed"
echo "rollout-seconds=$rollout_seconds"
# breakdown of the non-200s, informational
grep -vx 200 "$CODES" | sort | uniq -c | awk '{print "status-" $2 "=" $1}' || true

[ "$failed" -eq 0 ]
