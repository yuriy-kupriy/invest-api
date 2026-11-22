#!/usr/bin/env bash
# HW #28 demo:pdb — two evictions in a row through the Eviction API (the only
# path a PDB guards; plain `kubectl delete pod` bypasses it by definition).
# evict-* are the HTTP status codes the API server returned.
set -euo pipefail

NS=invest
DEPLOY=invest-api
PDB=invest-api

kubectl -n "$NS" rollout status "deploy/$DEPLOY" --timeout=180s >/dev/null

pdb() { kubectl -n "$NS" get pdb "$PDB" -o jsonpath="{$1}"; }
echo "healthy=$(pdb .status.currentHealthy)"
echo "minAvailable=$(pdb .spec.minAvailable)"
echo "disruptionsAllowed-before=$(pdb .status.disruptionsAllowed)"

read -r -a PODS <<<"$(kubectl -n "$NS" get pods -l app=invest-api --field-selector=status.phase=Running \
  -o jsonpath='{.items[*].metadata.name}')"
[ "${#PODS[@]}" -ge 2 ] || { echo "need at least 2 running pods, have ${#PODS[@]}" >&2; exit 1; }

# kubectl --raw cannot show the status code; a proxy + curl can.
PROXY_LOG=$(mktemp)
kubectl proxy --port=0 >"$PROXY_LOG" 2>&1 &
PROXY_PID=$!
disown "$PROXY_PID"
trap 'kill "$PROXY_PID" 2>/dev/null || true; rm -f "$PROXY_LOG"' EXIT
for _ in $(seq 50); do grep -q 'Starting to serve' "$PROXY_LOG" && break; sleep 0.1; done
PORT=$(sed -nE 's/.*127\.0\.0\.1:([0-9]+).*/\1/p' "$PROXY_LOG" | head -1)
[ -n "$PORT" ] || { cat "$PROXY_LOG" >&2; exit 1; }

evict() {
  curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    "http://127.0.0.1:$PORT/api/v1/namespaces/$NS/pods/$1/eviction" \
    -d "{\"apiVersion\":\"policy/v1\",\"kind\":\"Eviction\",\"metadata\":{\"name\":\"$1\",\"namespace\":\"$NS\"}}"
}
echo "evict-1=$(evict "${PODS[0]}")"
echo "evict-2=$(evict "${PODS[1]}")"

# Leave the cluster as found: the evicted pod gone (a terminating pod still has
# phase Running, and evicting it does not consume budget) and the budget back.
kubectl -n "$NS" wait --for=delete "pod/${PODS[0]}" --timeout=60s >/dev/null
for _ in $(seq 120); do
  [ "$(pdb .status.disruptionsAllowed)" -ge 1 ] 2>/dev/null && break
  sleep 1
done
echo "disruptionsAllowed-after=$(pdb .status.disruptionsAllowed)"
